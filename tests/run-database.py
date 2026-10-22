"""Test solo locale: crea e distrugge un cluster dedicato, senza URL remoti."""
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
import os
import shutil
import socket
import subprocess
import tempfile
import uuid
import re
import sys
sys.dont_write_bytecode = True
from concurrency import run_lifecycle_races

ROOT = Path(__file__).resolve().parents[1]
BIN = Path(shutil.which('pg_ctl') or '/opt/homebrew/bin/pg_ctl').parent

with tempfile.TemporaryDirectory(prefix='casetta-m0b-') as directory:
    data = Path(directory) / 'data'
    with socket.socket() as sock:
        sock.bind(('127.0.0.1', 0))
        port = sock.getsockname()[1]
    subprocess.run([str(BIN / 'initdb'), '-D', str(data), '-A', 'trust', '--no-locale', '-E', 'UTF8'], check=True, capture_output=True)
    subprocess.run([str(BIN / 'pg_ctl'), '-D', str(data), '-l', str(Path(directory) / 'server.log'), '-o', f'-k {directory} -p {port} -h 127.0.0.1', 'start'], check=True, capture_output=True)
    command = [str(BIN / 'psql'), '-X', '-h', '127.0.0.1', '-p', str(port), '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-Atq']
    # Non eredita variabili libpq che potrebbero indirizzare a servizi remoti.
    env = {key: value for key, value in os.environ.items() if not key.startswith('PG')}

    def sql(statement, check=True):
        result = subprocess.run(command, input=statement, text=True, capture_output=True, env=env, timeout=20)
        if check and result.returncode:
            raise RuntimeError(result.stderr)
        return result

    try:
        print('PostgreSQL ' + sql('show server_version;').stdout.strip(), flush=True)
        total_checks = 0
        sql((ROOT / 'tests/local-auth-shim.sql').read_text())
        for migration in sorted((ROOT / 'supabase/migrations').glob('*.sql')):
            sql(migration.read_text())
        for test_file in ['database.sql', 'lifecycle.sql']:
            result = sql((ROOT / 'tests' / test_file).read_text())
            total_checks += result.stderr.count('PASS:')
            print(result.stderr.strip(), flush=True)
        print(f'SUMMARY: {total_checks} controlli SQL PostgreSQL superati', flush=True)
        actor, second = str(uuid.uuid4()), str(uuid.uuid4())
        key = str(uuid.uuid4())
        sql(f"insert into auth.users values ('{actor}'), ('{second}');")

        def create(creation_key):
            return sql(f"begin; set local role authenticated; select set_config('request.jwt.claim.sub','{actor}',true); select public.create_home('Casa concorrente','{creation_key}'); select pg_sleep(0.1); commit;").stdout.splitlines()[1]

        with ThreadPoolExecutor(max_workers=8) as pool:
            ids = list(pool.map(create, [key] * 8))
        assert len(set(ids)) == 1, ids
        print('PASS: 8 creazioni concorrenti con stessa chiave = una casa e un owner')
        with ThreadPoolExecutor(max_workers=8) as pool:
            separate = list(pool.map(create, [str(uuid.uuid4()) for _ in range(8)]))
        assert len(set(separate)) == 8
        assert sql('select count(*) from public.homes;').stdout.strip() == '9'
        assert sql("select count(*) from public.home_members where role = 'owner';").stdout.strip() == '9'
        print('PASS: 8 creazioni concorrenti indipendenti = 8 case con owner')
        home = ids[0]
        sql(f"insert into public.home_members(home_id,user_id,role) values ('{home}','{second}','owner');")

        def demote(user):
            return sql(f"\\set VERBOSITY sqlstate\nbegin; set local role authenticated; select set_config('request.jwt.claim.sub','{actor}',true); select public.manage_home_member('{home}','{user}','viewer'); select pg_sleep(0.2); commit;", check=False)

        with ThreadPoolExecutor(max_workers=2) as pool:
            attempts = list(pool.map(demote, [actor, second]))
        assert sorted(result.returncode == 0 for result in attempts) == [False, True]
        for attempt in attempts:
            if attempt.returncode:
                state = re.search(r'ERROR:\s+([0-9A-Z]{5})', attempt.stderr)
                assert state and state.group(1) in {'23514', '42501'}, attempt.stderr
        assert sql(f"select count(*) from public.home_members where home_id = '{home}' and role = 'owner' and revoked_at is null;").stdout.strip() == '1'
        print('PASS: demozioni concorrenti preservano almeno un owner')
        lifecycle_races = run_lifecycle_races(sql, command, env)
        print(f'SUMMARY: {lifecycle_races + 3} scenari concorrenti PostgreSQL superati')
    finally:
        subprocess.run([str(BIN / 'pg_ctl'), '-D', str(data), '-m', 'immediate', 'stop'], check=True, capture_output=True)
