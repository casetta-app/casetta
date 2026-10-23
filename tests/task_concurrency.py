from concurrent.futures import ThreadPoolExecutor
import uuid

def run_task_races(sql):
    actor = str(uuid.uuid4())
    sql(f"insert into auth.users values('{actor}');")
    prefix = f"begin; set local role authenticated; select set_config('request.jwt.claim.sub','{actor}',true);"
    for isolation in ['read committed', 'repeatable read', 'serializable']:
        key = str(uuid.uuid4())
        # Set isolation before any queries.
        prefix_iso = f"\\set VERBOSITY sqlstate\nbegin isolation level {isolation}; set local role authenticated; select set_config('request.jwt.claim.sub','{actor}',true);"
        def create(_):
            return sql(prefix_iso + f"select public.create_domestic_task('{key}',null,'Race','2030-01-31','Europe/Rome','chore',2::smallint,'calendar');commit;",check=False)
        with ThreadPoolExecutor(max_workers=6) as pool:
            results=list(pool.map(create,range(6)))
        assert any(r.returncode==0 for r in results)
        for r in results:
            assert r.returncode==0 or '40001' in r.stderr, r.stderr
        result=sql(prefix+f"select public.create_domestic_task('{key}',null,'Race','2030-01-31','Europe/Rome','chore',2::smallint,'calendar');commit;")
        task=result.stdout.splitlines()[1]
        complete_key=str(uuid.uuid4())
        def complete(_):
            return sql(prefix_iso+f"select public.act_on_domestic_task('{complete_key}','{task}',1,'complete');commit;",check=False)
        with ThreadPoolExecutor(max_workers=6) as pool:
            results=list(pool.map(complete,range(6)))
        assert any(r.returncode==0 for r in results)
        for r in results:
            assert r.returncode==0 or '40001' in r.stderr, r.stderr
        sql(prefix+f"select public.act_on_domestic_task('{complete_key}','{task}',1,'complete');commit;")
        assert sql(f"select count(*) from public.domestic_tasks where previous_task_id='{task}';").stdout.strip()=='1'
        assert sql(f"select count(*) from public.task_events where task_id='{task}';").stdout.strip()=='2'
        assert sql(f"select (not enabled and stopped_at is not null)::text from public.task_reminder_plans where task_id='{task}';").stdout.strip()=='true'
        def competing(_):
            return sql(prefix_iso+f"select public.act_on_domestic_task(gen_random_uuid(),(select id from public.domestic_tasks where previous_task_id='{task}'),1,'confirm');commit;",check=False)
        with ThreadPoolExecutor(max_workers=2) as pool:
            results=list(pool.map(competing,range(2)))
        assert sum(r.returncode==0 for r in results)==1
        assert sql(f"select (not p.enabled and p.stopped_at is null)::text from public.task_reminder_plans p join public.domestic_tasks t on t.id=p.task_id where t.previous_task_id='{task}';").stdout.strip()=='true'
        print(f'PASS: tasks {isolation}: concurrent create, complete retry, version conflict',flush=True)
    return 9
