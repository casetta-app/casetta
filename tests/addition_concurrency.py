"""RPC completa su connessioni PostgreSQL reali e snapshot concorrenti."""
from concurrency import synchronized_race
import uuid
import re


def run_addition_races(sql, command, env):
    def execute(user, action):
        return sql(f"begin; set local role authenticated; select set_config('request.jwt.claim.sub','{user}',true); {action} commit;").stdout.splitlines()[-1]

    def action(user, statement):
        return f"set local role authenticated; select set_config('request.jwt.claim.sub','{user}',true); {statement}"

    def call(home, key, form=None):
        selector = f"p_format_id=>'{form}'" if form else "p_product=>'{\"name\":\"Atomico\",\"label\":\"Pacco\",\"kind\":\"packaged\"}'"
        return f"select public.add_inventory_product('{home}','{key}','{{\"mode\":\"unknown\",\"certainty\":\"unknown\"}}',{selector});"

    def check(results):
        for result in results:
            if result.returncode:
                state = re.search(r'ERROR:\s+([0-9A-Z]{5})', result.stderr)
                assert state and state.group(1) == '40001', result.stderr
        assert any(r.returncode == 0 for r in results)

    count = 0
    for isolation in ['read committed', 'repeatable read', 'serializable']:
        user = str(uuid.uuid4())
        sql(f"insert into auth.users values ('{user}');")
        home = execute(user, "select public.create_home('Aggiunta concorrente',gen_random_uuid());")
        statement = call(home, str(uuid.uuid4()))
        results = synchronized_race(sql, command, env, [action(user, statement)] * 6, isolation)
        check(results)
        ids = [execute(user, statement) for _ in results]
        assert len(set(ids)) == 1
        for table, column in [('products','scope_home_id'),('home_products','home_id'),('stock_entries','home_id'),('stock_movements','home_id')]:
            assert sql(f"select count(*) from public.{table} where {column}='{home}';").stdout.strip() == '1'
        assert sql(f"select count(*) from private.inventory_add_requests where home_id='{home}';").stdout.strip() == '1'
        count += 1
        print(f'PASS: add {isolation}: sei retry concorrenti = un prodotto, un lotto e un movimento')
        form = sql(f"select format_id from public.home_products where home_id='{home}';").stdout.strip()
        # Un altro collegamento legacy nella stessa casa: chiavi differenti non duplicano lotti.
        requests = [call(home, str(uuid.uuid4()), form) for _ in range(4)]
        results = synchronized_race(sql, command, env, [action(user, s) for s in requests], isolation)
        check(results)
        for statement in requests: execute(user, statement)
        assert sql(f"select count(*) from public.stock_entries where home_id='{home}';").stdout.strip() == '1'
        assert sql(f"select count(*) from public.stock_movements where home_id='{home}';").stdout.strip() == '1'
        count += 1
        print(f'PASS: add {isolation}: chiavi distinte sul formato già collegato preservano stock legacy')
        # Formato comune non ancora collegato, vere insert concorrenti dello stesso collegamento.
        common = sql("insert into public.products(name) values ('Condiviso') returning id;").stdout.strip()
        form = sql(f"insert into public.product_formats(product_id,label,kind) values ('{common}','Pezzo','piece') returning id;").stdout.strip()
        requests = [call(home, str(uuid.uuid4()), form) for _ in range(4)]
        results = synchronized_race(sql, command, env, [action(user, s) for s in requests], isolation)
        check(results)
        for statement in requests: execute(user, statement)
        assert sql(f"select count(*) from public.home_products where home_id='{home}' and format_id='{form}';").stdout.strip() == '1'
        assert sql(f"select count(*) from public.stock_movements where home_id='{home}';").stdout.strip() == '2'
        count += 1
        print(f'PASS: add {isolation}: collegamenti concorrenti a un formato comune = un solo lotto iniziale')
    return count
