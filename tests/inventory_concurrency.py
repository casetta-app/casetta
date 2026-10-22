"""Movimenti concorrenti reali, con barriera di snapshot PostgreSQL."""
from concurrency import synchronized_race
import json
import re
from decimal import Decimal
import uuid


def run_inventory_races(sql, command, env):
    def as_user(user, action):
        return f"set local role authenticated; select set_config('request.jwt.claim.sub','{user}',true); {action}"

    def execute(user, action):
        return sql('begin; ' + as_user(user, action) + ' commit;').stdout.splitlines()[-1]

    def fixture(quantity=1):
        actor, editor = str(uuid.uuid4()), str(uuid.uuid4())
        sql(f"insert into auth.users values ('{actor}'), ('{editor}');")
        home = execute(actor, "select public.create_home('Concorrenza stock',gen_random_uuid());")
        sql(f"insert into public.home_members(home_id,user_id,role) values ('{home}','{editor}','editor');")
        product = execute(actor, f"insert into public.products(scope_home_id,name) values ('{home}','Privato concorrenza') returning id;")
        form = execute(actor, f"insert into public.product_formats(product_id,label,kind) values ('{product}','Pacco','packaged') returning id;")
        hp = execute(actor, f"insert into public.home_products(home_id,format_id) values ('{home}','{form}') returning id;")
        state = json.dumps(dict(mode='count', quantity=str(quantity), unit='pack', certainty='confirmed', package_state='sealed'))
        movement = execute(actor, f"select public.record_stock_movement('{home}',gen_random_uuid(),'correction',p_home_product_id => '{hp}',p_state => '{state}');")
        entry = sql(f"select entry_id from public.stock_movements where id='{movement}';").stdout.strip()
        return actor, editor, home, entry

    def call(home, entry, kind, amount=1, key=None, extra='', unit='pack'):
        key = key or str(uuid.uuid4())
        amount_arg = f", p_amount => {amount}, p_unit => '{unit}'" if amount is not None else ''
        return f"select public.record_stock_movement('{home}','{key}','{kind}',p_entry_id => '{entry}'{amount_arg}{extra});"

    def failures(results, allowed):
        for result in results:
            if result.returncode:
                state = re.search(r'ERROR:\s+([0-9A-Z]{5})', result.stderr)
                assert state and state.group(1) in allowed, result.stderr

    def value(home, entry):
        return sql(f"select quantity from public.stock_entries where home_id='{home}' and id='{entry}';").stdout.strip()

    def race(actions, isolation):
        return synchronized_race(sql, command, env, actions, isolation)

    def invariant():
        assert sql("select count(*) from public.stock_entries where quantity < 0 or quantity::text in ('NaN','Infinity','-Infinity');").stdout.strip() == '0'
        assert sql('select count(*) from public.stock_movements m left join public.stock_entries s on s.id=m.entry_id and s.home_id=m.home_id where s.id is null;').stdout.strip() == '0'
        assert sql('select count(*) from public.stock_entries s left join public.home_products hp on hp.id=s.home_product_id and hp.home_id=s.home_id where hp.id is null;').stdout.strip() == '0'

    count = 0
    for isolation in ['read committed', 'repeatable read', 'serializable']:
        actor, editor, home, entry = fixture(10)
        action = call(home, entry, 'consume', key=str(uuid.uuid4()))
        results = race([as_user(actor, action)] * 8, isolation)
        failures(results, {'40001'})
        assert sum(result.returncode == 0 for result in results) >= 1
        # Retry espliciti delle transazioni serializzate: stessa chiave, mai doppio evento.
        ids = [execute(actor, action) for _ in results]
        assert len(set(ids)) == 1 and value(home, entry) == '9'
        assert sql(f"select count(*) from public.stock_movements where home_id='{home}';").stdout.strip() == '2'
        invariant(); count += 1
        print(f'PASS: stock {isolation}: 8 retry stessa chiave producono un solo consumo')

        actor, editor, home, entry = fixture(0)
        hp = sql(f"select home_product_id from public.stock_entries where id='{entry}';").stdout.strip()
        incoming = json.dumps(dict(mode='count', quantity='2', unit='pack', certainty='confirmed'))
        action = f"select public.record_stock_movement('{home}','{uuid.uuid4()}','purchase',p_home_product_id => '{hp}',p_state => '{incoming}');"
        results = race([as_user(actor, action)] * 4, isolation)
        failures(results, {'40001'})
        ids = [execute(actor, action) for _ in results]
        assert len(set(ids)) == 1
        assert sql(f"select count(*) from public.stock_entries where home_id='{home}';").stdout.strip() == '2'
        assert sql(f"select sum(quantity) from public.stock_entries where home_id='{home}';").stdout.strip() == '2'
        invariant(); count += 1
        print(f'PASS: stock {isolation}: creazioni lotto concorrenti con stessa chiave non duplicano scorte')

        actor, editor, home, entry = fixture(1)
        results = race([as_user(user, call(home, entry, 'consume')) for user in [actor, editor]], isolation)
        failures(results, {'23514', '40001'})
        assert sum(result.returncode == 0 for result in results) == 1
        assert value(home, entry) == '0'
        invariant(); count += 1
        print(f'PASS: stock {isolation}: due consumi dell’ultima confezione non vanno sotto zero')

        actor, editor, home, entry = fixture(0)
        # Per le frazioni si usa un lotto misurabile, non frazioni di pacco.
        version = sql(f"select version from public.stock_entries where id='{entry}';").stdout.strip()
        execute(actor, call(home, entry, 'correction', None, extra=f", p_expected_version => {version}, p_state => '{{\"mode\":\"measure\",\"quantity\":\"0\",\"unit\":\"kg\",\"certainty\":\"confirmed\"}}'"))
        actions = [call(home, entry, 'purchase', 0.1, unit='kg') for _ in range(8)]
        results = race([as_user(actor if i % 2 == 0 else editor, action) for i, action in enumerate(actions)], isolation)
        failures(results, {'40001'})
        for i, result in enumerate(results):
            if result.returncode: execute(actor if i % 2 == 0 else editor, actions[i])
        assert Decimal(value(home, entry)) == Decimal('0.8')
        assert sql(f"select count(*) from public.stock_movements where home_id='{home}' and kind='purchase';").stdout.strip() == '8'
        invariant(); count += 1
        print(f'PASS: stock {isolation}: incrementi frazionari concorrenti senza aggiornamenti persi')

        actor, editor, home, entry = fixture(5)
        state_a = ', p_expected_version => 1, p_state => \'{"mode":"count","quantity":"10","unit":"pack","certainty":"confirmed"}\''
        state_b = state_a.replace('"10"', '"20"')
        results = race([as_user(actor, call(home, entry, 'correction', None, extra=state_a)), as_user(editor, call(home, entry, 'correction', None, extra=state_b))], isolation)
        failures(results, {'40001'})
        assert sum(result.returncode == 0 for result in results) == 1
        assert value(home, entry) in ('10', '20')
        invariant(); count += 1
        print(f'PASS: stock {isolation}: correzioni obsolete non sovrascrivono lo stato corrente')

        actor, editor, home, entry = fixture(1)
        results = race([as_user(actor, call(home, entry, 'open')), as_user(editor, call(home, entry, 'consume'))], isolation)
        failures(results, {'23514', '40001'})
        assert sum(result.returncode == 0 for result in results) == 1 and value(home, entry) == '0'
        assert sql(f"select count(*) <= 1 from public.stock_entries where home_id='{home}' and package_state='open';").stdout.strip() == 't'
        invariant(); count += 1
        print(f'PASS: stock {isolation}: apertura contro consumo dell’ultimo pacco è atomica')

        actor, editor, home, entry = fixture(1)
        consume = call(home, entry, 'consume')
        results = race([as_user(editor, consume), as_user(actor, f"select public.manage_home_member('{home}','{editor}','editor',true);")], isolation)
        failures(results, {'42501', '40001'})
        assert results[1].returncode == 0
        assert value(home, entry) == ('0' if results[0].returncode == 0 else '1')
        denied = sql('\\set VERBOSITY sqlstate\nbegin; ' + as_user(editor, call(home, entry, 'purchase')) + ' commit;', False)
        failures([denied], {'42501'}); assert denied.returncode != 0
        invariant(); count += 1
        print(f'PASS: stock {isolation}: revoca serializzata e scritture successive negate')

        actor, editor, home, entry = fixture(1)
        deletion = f"select public.delete_home('{home}');"
        results = race([as_user(editor, call(home, entry, 'consume')), as_user(actor, deletion)], isolation)
        failures(results, {'42501', '40001'})
        if results[1].returncode: execute(actor, deletion)
        assert sql(f"select count(*) from public.stock_entries where home_id='{home}';").stdout.strip() == '0'
        assert sql(f"select count(*) from public.stock_movements where home_id='{home}';").stdout.strip() == '0'
        invariant(); count += 1
        print(f'PASS: stock {isolation}: eliminazione casa contro movimento senza residui')
    return count
