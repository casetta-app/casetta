\set ON_ERROR_STOP on
begin;
create function pg_temp.ok(value boolean, label text) returns void language plpgsql as $$
begin if value is distinct from true then raise exception 'FAIL: %',label; end if; raise notice 'PASS: %',label; end $$;
create function pg_temp.fail(statement text, code text) returns void language plpgsql as $$
begin
  begin execute statement;
  exception when others then
    if sqlstate <> code then raise exception 'Wrong error %, expected %: %',sqlstate,code,sqlerrm; end if;
    raise notice 'PASS: expected error %',code; return;
  end;
  raise exception 'Operation unexpectedly accepted';
end $$;
insert into auth.users(id) values ('00000000-0000-4000-8000-000000000201'),('00000000-0000-4000-8000-000000000202'),('00000000-0000-4000-8000-000000000203');
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000201',true);
select public.create_home('Atomica A',gen_random_uuid()) as a \gset
select public.create_home('Atomica B',gen_random_uuid()) as b \gset
reset role;
insert into public.home_members(home_id,user_id,role) values (:'a','00000000-0000-4000-8000-000000000202','editor'),(:'a','00000000-0000-4000-8000-000000000203','viewer');
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000201',true);
select gen_random_uuid() as key \gset
select public.add_inventory_product(:'a',:'key','{"mode":"unknown","certainty":"unknown"}',p_product=>' {"name":"Sapone","label":"Confezione","kind":"packaged","category":"household"}') as result \gset
select :'result'::jsonb->>'home_product_id' as hp \gset
select pg_temp.ok((:'result'::jsonb->>'created')::boolean,'owner crea prodotto completo');
select pg_temp.ok((select count(*)=1 from public.stock_entries where home_product_id=:'hp' and mode='unknown'),'stato iniziale unknown');
select pg_temp.ok((select count(*)=1 from public.stock_movements where home_id=:'a'),'movimento iniziale registrato');
select pg_temp.ok(public.add_inventory_product(:'a',:'key','{"mode":"unknown","certainty":"unknown"}',p_product=>' {"name":"Sapone","label":"Confezione","kind":"packaged","category":"household"}')=:'result'::jsonb,'retry restituisce identico esito');
select pg_temp.fail(format('select public.add_inventory_product(%L,%L,%L,p_product=>%L)',:'a',:'key','{"mode":"unknown","certainty":"unknown"}','{"name":"Altro","label":"Confezione","kind":"packaged"}'),'22023');
select format_id as f from public.home_products where id=:'hp' \gset
select public.add_inventory_product(:'a',gen_random_uuid(),'{"mode":"unknown","certainty":"unknown"}',p_format_id=>:'f') as attached \gset
select pg_temp.ok(not (:'attached'::jsonb->>'created')::boolean and (:'attached'::jsonb->>'home_product_id')=:'hp','formato già collegato riusato');
select pg_temp.ok((select count(*)=1 from public.stock_movements where home_id=:'a'),'nessun lotto o movimento duplicato');
select pg_temp.fail(format('select public.add_inventory_product(%L,gen_random_uuid(),%L,p_format_id=>%L)',:'b','{"mode":"unknown","certainty":"unknown"}',:'f'),'42501');
select pg_temp.fail(format('select public.add_inventory_product(%L,gen_random_uuid(),%L,p_product=>%L)',:'a','{"mode":"count","quantity":"-1","unit":"pack","certainty":"confirmed"}','{"name":"Fallisce","label":"Pacco","kind":"packaged"}'),'23514');
select pg_temp.ok((select count(*)=1 from public.products where scope_home_id=:'a'),'rollback prodotto dopo stato invalido');
select pg_temp.fail(format('select public.add_inventory_product(%L,gen_random_uuid(),%L,p_product=>%L)',:'a','{"mode":"unknown","certainty":"unknown"}','{"name":"Fallisce","label":"Pacco","kind":"packaged","scope_home_id":"spoof"}'),'22023');
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000202',true);
select pg_temp.fail(format('select public.add_inventory_product(%L,%L,%L,p_product=>%L)',:'a',:'key','{"mode":"unknown","certainty":"unknown"}','{"name":"Sapone","label":"Confezione","kind":"packaged","category":"household"}'),'22023');
select public.add_inventory_product(:'a',gen_random_uuid(),'{"mode":"level","level":"low","certainty":"estimated"}',p_product=>'{"name":"Editor","label":"Sfuso","kind":"loose"}');
select pg_temp.ok((select count(*)=2 from public.stock_entries where home_id=:'a'),'editor autorizzato');
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000203',true);
select pg_temp.fail(format('select public.add_inventory_product(%L,gen_random_uuid(),%L,p_format_id=>%L)',:'a','{"mode":"unknown","certainty":"unknown"}',:'f'),'42501');
select pg_temp.fail(format('select public.add_inventory_product(%L,%L,%L,p_product=>%L)',:'a',:'key','{"mode":"unknown","certainty":"unknown"}','{"name":"Sapone","label":"Confezione","kind":"packaged","category":"household"}'),'42501');
select pg_temp.ok((select count(*)=2 from public.stock_entries where home_id=:'a'),'viewer legge inventario invariato');
reset role;
-- Catalogo condiviso e formato legacy M1-A: non viene duplicato.
insert into public.products(name) values ('Comune legacy') returning id as shared \gset
insert into public.product_formats(product_id,label,kind) values (:'shared','Pezzo','piece') returning id as sf \gset
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000201',true);
select public.add_inventory_product(:'a',gen_random_uuid(),'{"mode":"count","quantity":"2","unit":"piece","certainty":"confirmed"}',p_format_id=>:'sf');
select pg_temp.ok((select count(*)=1 from public.products where id=:'shared'),'catalogo legacy riutilizzato');
-- Forza errore DOPO che record_stock_movement ha già scritto lo storico.
reset role;
create function pg_temp.reject_request() returns trigger language plpgsql as $$ begin raise exception 'forced late failure' using errcode='P0001'; end $$;
create trigger reject_request before insert on private.inventory_add_requests for each row execute function pg_temp.reject_request();
select (select count(*) from public.products) as pc, (select count(*) from public.product_formats) as fc, (select count(*) from public.home_products) as hc, (select count(*) from public.stock_entries) as sc, (select count(*) from public.stock_movements) as mc \gset
set local role authenticated;
select pg_temp.fail(format('select public.add_inventory_product(%L,gen_random_uuid(),%L,p_product=>%L)',:'a','{"mode":"unknown","certainty":"unknown"}','{"name":"Rollback completo","label":"Pacco","kind":"packaged"}'),'P0001');
reset role;
select pg_temp.ok((select count(*)=:'pc'::bigint from public.products) and (select count(*)=:'fc'::bigint from public.product_formats) and (select count(*)=:'hc'::bigint from public.home_products) and (select count(*)=:'sc'::bigint from public.stock_entries) and (select count(*)=:'mc'::bigint from public.stock_movements),'errore tardivo annulla metadati, stock e registro');
drop trigger reject_request on private.inventory_add_requests;
select pg_temp.ok(not has_table_privilege('authenticated','private.inventory_add_requests','SELECT,INSERT,UPDATE,DELETE'),'registro richieste privato');
select pg_temp.ok(not has_function_privilege('anon','public.add_inventory_product(uuid,uuid,jsonb,uuid,jsonb)','EXECUTE'),'anon senza EXECUTE');
-- Revocare l'autore invalida anche il replay di una richiesta già riuscita.
update public.home_members set role='owner' where home_id=:'a' and user_id='00000000-0000-4000-8000-000000000202';
update public.home_members set revoked_at=now() where home_id=:'a' and user_id='00000000-0000-4000-8000-000000000201';
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000201',true);
select pg_temp.fail(format('select public.add_inventory_product(%L,%L,%L,p_product=>%L)',:'a',:'key','{"mode":"unknown","certainty":"unknown"}','{"name":"Sapone","label":"Confezione","kind":"packaged","category":"household"}'),'42501');
reset role;
set local role anon;
select pg_temp.fail(format('select public.add_inventory_product(%L,gen_random_uuid(),%L,p_format_id=>%L)',:'a','{"mode":"unknown","certainty":"unknown"}',:'sf'),'42501');
rollback;
