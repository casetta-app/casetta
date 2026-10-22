"""Corse reali fra connessioni PostgreSQL, con snapshot sincronizzati via advisory lock."""
from concurrent.futures import ThreadPoolExecutor
import secrets
import subprocess
import time
import uuid
import re


def run_lifecycle_races(sql, command, env):
    def shared(second_role='owner'):
        actor, second = str(uuid.uuid4()), str(uuid.uuid4())
        sql(f"insert into auth.users values ('{actor}'), ('{second}');")
        home = sql(f"begin; set local role authenticated; select set_config('request.jwt.claim.sub','{actor}',true); select public.create_home('Concorrenza lifecycle',gen_random_uuid()); commit;").stdout.splitlines()[1]
        sql(f"insert into public.home_members(home_id,user_id,role) values ('{home}','{second}','{second_role}');")
        return actor, second, home

    def as_user(user, action):
        return f"set local role authenticated; select set_config('request.jwt.claim.sub','{user}',true); {action}"

    def race(actions, isolation):
        # Il keeper detiene il lock esclusivo; ogni concorrente acquisisce PRIMA
        # lo snapshot, poi attende un lock condiviso. Si rilascia solo quando
        # PostgreSQL conferma che ENTRAMBI sono in attesa, senza affidarsi a sleep.
        gate = secrets.randbelow(1_000_000_000) + 1
        keeper = subprocess.Popen(command, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                                  stderr=subprocess.PIPE, text=True, env=env)
        try:
            keeper.stdin.write(f"select 'ready' from pg_advisory_lock({gate});\n")
            keeper.stdin.flush()
            assert keeper.stdout.readline().strip() == 'ready'
            with ThreadPoolExecutor(max_workers=len(actions)) as pool:
                futures = [pool.submit(sql, f"\\set VERBOSITY sqlstate\nbegin isolation level {isolation}; set local statement_timeout = '8s'; select count(*) from public.homes; select pg_advisory_xact_lock_shared({gate}); {action} commit;", False) for action in actions]
                deadline = time.monotonic() + 5
                while True:
                    waiting = int(sql(f"select count(*) from pg_locks where locktype = 'advisory' and objid = {gate} and not granted;").stdout.strip())
                    if waiting == len(actions):
                        break
                    if time.monotonic() > deadline or any(f.done() for f in futures):
                        raise AssertionError('I concorrenti non hanno raggiunto la barriera snapshot')
                    time.sleep(0.01)
                keeper.communicate(f"select pg_advisory_unlock({gate});\n\\q\n", timeout=5)
                results = [f.result() for f in futures]
            return results
        finally:
            if keeper.poll() is None:
                keeper.kill()
                keeper.communicate(timeout=5)

    def assert_results(results, allowed, success_count=1):
        successes = sum(result.returncode == 0 for result in results)
        assert successes in (success_count if isinstance(success_count, tuple) else (success_count,)), [r.stderr for r in results]
        for result in results:
            if result.returncode:
                match = re.search(r'ERROR:\s+([0-9A-Z]{5})', result.stderr)
                assert match and match.group(1) in allowed, result.stderr
        # Controllo globale dopo OGNI corsa, non solo degli exit code.
        assert sql("select count(*) from public.homes h where not exists (select from public.home_members m where m.home_id=h.id and m.role='owner' and m.revoked_at is null);").stdout.strip() == '0'
        assert sql('select count(*) from public.home_members m left join auth.users u on u.id=m.user_id left join public.homes h on h.id=m.home_id where u.id is null or h.id is null;').stdout.strip() == '0'

    count = 0
    for isolation in ['read committed', 'repeatable read', 'serializable']:
        actor, second, home = shared()
        results = race([as_user(user, f"select public.manage_home_member('{home}','{user}','viewer');") for user in [actor, second]], isolation)
        assert_results(results, {'23514', '40001'})
        print(f'PASS: {isolation}: demozioni RPC concorrenti mantengono owner')
        count += 1

        actor, second, home = shared()
        results = race([f"delete from public.home_members where home_id='{home}' and user_id='{user}';" for user in [actor, second]], isolation)
        assert_results(results, {'23514', '40001'})
        print(f'PASS: {isolation}: delete membership concorrenti mantengono owner')
        count += 1

        actor, second, home = shared()
        results = race([f"delete from auth.users where id='{user}';" for user in [actor, second]], isolation)
        assert_results(results, {'23514', '40001'})
        assert sql(f"select count(*) from auth.users where id in ('{actor}','{second}');").stdout.strip() == '1'
        print(f'PASS: {isolation}: eliminazioni account owner concorrenti mantengono casa e un owner')
        count += 1

        actor, second, home = shared()
        other_home = sql(as_user(second, "select public.create_home('Seconda casa',gen_random_uuid());").replace('set local role', 'begin; set local role') + ' commit;').stdout.splitlines()[1]
        sql(f"insert into public.home_members(home_id,user_id,role) values ('{other_home}','{actor}','owner');")
        results = race([f"delete from auth.users where id='{user}';" for user in [actor, second]], isolation)
        assert_results(results, {'23514', '40001'})
        assert sql(f"select count(*) from auth.users where id in ('{actor}','{second}');").stdout.strip() == '1'
        assert sql(f"select count(*) from public.homes where id in ('{home}','{other_home}');").stdout.strip() == '2'
        print(f'PASS: {isolation}: eliminazioni owner di due case bloccate in ordine stabile')
        count += 1

        actor, second, home = shared('editor')
        results = race([as_user(actor, f"select public.transfer_home_ownership('{home}','{second}');"), f"delete from auth.users where id='{second}';"], isolation)
        assert_results(results, {'23514', '22023', '40001'})
        print(f'PASS: {isolation}: trasferimento contro eliminazione destinatario mantiene owner')
        count += 1

        actor, second, home = shared('editor')
        results = race([as_user(actor, f"select public.transfer_home_ownership('{home}','{second}');"), as_user(actor, f"select public.delete_home('{home}');")], isolation)
        assert_results(results, {'42501', '40001'})
        print(f'PASS: {isolation}: trasferimento contro delete casa ricontrolla autorizzazione')
        count += 1

        actor, second, home = shared()
        results = race([f"delete from auth.users where id='{actor}';", as_user(second, f"select public.delete_home('{home}');")], isolation)
        assert_results(results, {'40001'}, success_count=(1, 2))
        print(f'PASS: {isolation}: delete account contro delete casa senza orfani')
        count += 1
    return count
