\set ON_ERROR_STOP on
begin;
create function pg_temp.ok(value boolean,label text) returns void language plpgsql as $$begin if value is distinct from true then raise exception 'FAIL: %',label; end if;raise notice 'PASS: %',label;end$$;
insert into auth.users values('00000000-0000-4000-8000-000000000901');
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000901',true);
select public.create_home('OFF test',gen_random_uuid()) as h \gset
select gen_random_uuid() as k \gset
select public.add_inventory_product(:'h',:'k','{"mode":"unknown","certainty":"unknown"}',p_product=>'{"name":"Proposta confermata","label":"500 g","kind":"packaged","barcode":"036000291452","source":"external","source_ref":"https://world.openfoodfacts.org/product/0036000291452"}') as result \gset
select pg_temp.ok((select source='external' and source_ref like '%0036000291452' from public.products where scope_home_id=:'h'),'provenienza persistita');
select public.add_inventory_product(:'h',gen_random_uuid(),'{"mode":"unknown","certainty":"unknown"}',p_product=>'{"name":"Non sovrascrivere","label":"Altro","kind":"packaged","barcode":"0036000291452"}') as retry \gset
select pg_temp.ok((:'retry'::jsonb->>'home_product_id')=(:'result'::jsonb->>'home_product_id') and not (:'retry'::jsonb->>'created')::boolean,'equivalenti UPC/EAN riusano prodotto');
select pg_temp.ok((select count(*)=1 from public.products where scope_home_id=:'h') and (select count(*)=1 from public.stock_movements where home_id=:'h'),'nessuna duplicazione o movimento aggiuntivo');
select pg_temp.ok((select name='Proposta confermata' from public.products where scope_home_id=:'h'),'dati locali non sovrascritti');
select pg_temp.ok(not has_function_privilege('authenticated','public.claim_food_lookup(uuid,text)','execute') and not has_function_privilege('anon','public.finish_food_lookup(text,uuid,jsonb)','execute'),'cache solo service role');
reset role;
set local role service_role;
select public.claim_food_lookup('00000000-0000-4000-8000-000000000901','0036000291452') as c \gset
select pg_temp.ok(:'c'::jsonb->>'state'='fetch','prima richiesta acquisisce lease');
select pg_temp.ok(public.claim_food_lookup('00000000-0000-4000-8000-000000000901','0036000291452')->>'state'='pending','duplicato in volo non chiama OFF');
select public.finish_food_lookup('0036000291452',(:'c'::jsonb->>'lease')::uuid,'{"status":"absent"}');
select pg_temp.ok(public.claim_food_lookup('00000000-0000-4000-8000-000000000901','0036000291452')->'result'->>'status'='absent','cache negativa riutilizzata');
select pg_temp.ok(public.claim_food_lookup('00000000-0000-4000-8000-000000000901','4006381333931')->>'state'='limited','budget globale condiviso applicato');
rollback;
