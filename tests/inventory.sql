\set ON_ERROR_STOP on
begin;
create function pg_temp.assert_true(value boolean, label text) returns void language plpgsql as $$
begin if value is distinct from true then raise exception 'FAIL: %', label; end if; raise notice 'PASS: %', label; end $$;
create function pg_temp.expect_error(statement text, expected_state text, label text) returns void language plpgsql as $$
declare actual_state text;
begin
  begin execute statement;
  exception when others then
    get stacked diagnostics actual_state = returned_sqlstate;
    if actual_state <> expected_state then raise exception 'FAIL: %, expected %, got %: %', label, expected_state, actual_state, sqlerrm; end if;
    raise notice 'PASS: %', label; return;
  end;
  raise exception 'FAIL (operation accepted): %', label;
end $$;
create function pg_temp.new_stock(home uuid, product uuid, state jsonb, kind text default 'correction') returns uuid language plpgsql as $$
declare movement uuid; entry uuid;
begin
  movement := public.record_stock_movement(home, gen_random_uuid(), kind, p_home_product_id => product, p_state => state);
  select entry_id into entry from public.stock_movements where id = movement;
  return entry;
end $$;
insert into auth.users(id) values
 ('00000000-0000-4000-8000-000000000101'), ('00000000-0000-4000-8000-000000000102'),
 ('00000000-0000-4000-8000-000000000103'), ('00000000-0000-4000-8000-000000000104'),
 ('00000000-0000-4000-8000-000000000105');
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000101',true);
select public.create_home('Inventario A',gen_random_uuid()) as a \gset
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000102',true);
select public.create_home('Inventario B',gen_random_uuid()) as b \gset
reset role;
insert into public.home_members(home_id,user_id,role,revoked_at) values
 (:'a','00000000-0000-4000-8000-000000000103','editor',null),
 (:'a','00000000-0000-4000-8000-000000000104','viewer',null),
 (:'a','00000000-0000-4000-8000-000000000105','viewer',now());
select pg_temp.assert_true((select count(*) = 0 from public.storage_locations), 'nessuna posizione obbligatoria creata per le case');
select pg_temp.assert_true((select count(*) = 0 from public.stock_entries), 'nessuna scorta dimostrativa creata');
-- Catalogo comune: fixture amministrativa nel solo cluster temporaneo.
insert into public.products(name,source,source_ref) values ('Pasta comune','external','fixture:catalog') returning id as shared_product \gset
insert into public.product_formats(product_id,label,kind,barcode,size_quantity,size_unit)
 values (:'shared_product','Pacco 500 g','packaged','0000000000000',500,'g') returning id as shared_format \gset
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000102',true);
insert into public.home_products(home_id,format_id) values (:'b',:'shared_format') returning id as hp_b \gset
insert into public.storage_locations(home_id,name) values (:'b','Posizione B') returning id as loc_b \gset
insert into public.products(scope_home_id,name,category) values (:'b','Prodotto privato B','household') returning id as private_b \gset
insert into public.product_formats(product_id,label,kind) values (:'private_b','Formato B','piece') returning id as private_format_b \gset
select pg_temp.new_stock(:'b',:'hp_b','{"mode":"count","quantity":"7","unit":"pack","certainty":"confirmed","package_state":"sealed"}') as stock_b \gset
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000101',true);
insert into public.home_products(home_id,format_id) values (:'a',:'shared_format') returning id as hp_a \gset
insert into public.storage_locations(home_id,name) values (:'a','Dispensa personale') returning id as loc_a \gset
insert into public.products(scope_home_id,name,category) values (:'a','Farina sfusa','food') returning id as flour \gset
insert into public.product_formats(product_id,label,kind) values (:'flour','Sfusa senza barcode','loose') returning id as flour_format \gset
insert into public.home_products(home_id,format_id) values (:'a',:'flour_format') returning id as hp_flour \gset
select pg_temp.assert_true((select barcode is null from public.product_formats where id = :'flour_format'), 'formato sfuso senza barcode rappresentabile');
select pg_temp.assert_true((select count(*) = 1 from public.products where id = :'shared_product'), 'catalogo comune leggibile senza inventario condiviso');
select pg_temp.expect_error(format('insert into public.products(name) values (''Catalogo pubblico illecito'')'), '42501', 'client non può pubblicare prodotti nel catalogo comune');
with changed as (update public.products set name = 'Attacco' where id = :'shared_product' returning id) select pg_temp.assert_true((select count(*) = 0 from changed), 'client non può modificare prodotto comune');
select pg_temp.expect_error(format('insert into public.home_products(home_id,format_id) values (%L,%L)',:'a',:'private_format_b'), '23514', 'vietato collegare prodotto privato di altra casa');
select pg_temp.expect_error(format('update public.products set scope_home_id = null where id = %L',:'flour'), '42501', 'scope del catalogo non modificabile dal client');
select pg_temp.new_stock(:'a',:'hp_a','{"mode":"count","quantity":"4","unit":"pack","certainty":"confirmed","package_state":"sealed"}') as stock_a \gset
select pg_temp.assert_true((select quantity = 4 and location_id is null from public.stock_entries where id = :'stock_a'), 'quantità esatta senza posizione obbligatoria');
select pg_temp.assert_true((select count(*) = 0 from public.stock_entries where home_id = :'b'), 'owner A non legge stock B');
select pg_temp.assert_true((select count(*) = 0 from public.stock_movements where home_id = :'b'), 'owner A non legge storico B');
select pg_temp.assert_true((select count(*) = 0 from public.home_products where home_id = :'b'), 'owner A non legge prodotti domestici B');
select pg_temp.assert_true((select count(*) = 0 from public.storage_locations where home_id = :'b'), 'owner A non legge posizioni B');
select pg_temp.assert_true((select count(*) = 0 from public.products where id = :'private_b'), 'owner A non legge catalogo privato B');
select pg_temp.assert_true((select count(*) = 0 from public.product_formats where id = :'private_format_b'), 'owner A non legge formati privati B');
select pg_temp.expect_error(format('select public.record_stock_movement(%L,gen_random_uuid(),''consume'',p_entry_id => %L,p_amount => 1,p_unit => ''pack'')',:'b',:'stock_b'), '42501', 'RPC non può modificare stock di altra casa');
select pg_temp.expect_error(format('select public.record_stock_movement(%L,gen_random_uuid(),''move'',p_entry_id => %L,p_location_id => %L)',:'a',:'stock_a',:'loc_b'), '23514', 'posizione di altra casa negata');
select pg_temp.expect_error(format('select pg_temp.new_stock(%L,%L,''{"mode":"unknown","certainty":"unknown"}'')',:'a',:'hp_b'), '23514', 'stock non può riferirsi al home_product di altra casa');
select public.record_stock_movement(:'a',gen_random_uuid(),'open',p_entry_id => :'stock_a',p_amount => 1,p_unit => 'pack') as opened_movement \gset
select related_entry_id as opened from public.stock_movements where id = :'opened_movement' \gset
select pg_temp.assert_true((select quantity = 3 and package_state = 'sealed' from public.stock_entries where id = :'stock_a'), 'apertura lascia tre confezioni chiuse');
select pg_temp.assert_true((select mode = 'level' and quantity is null and level = 'available' and package_state = 'open' and package_count = 1 from public.stock_entries where id = :'opened'), 'una confezione aperta senza peso residuo inventato');
select pg_temp.assert_true((select jsonb_array_length(before_state) = 1 and jsonb_array_length(after_state) = 2 from public.stock_movements where id = :'opened_movement'), 'apertura registra atomicamente entrambe le righe');
select pg_temp.expect_error(format('select public.record_stock_movement(%L,gen_random_uuid(),''consume'',p_entry_id => %L,p_amount => 4,p_unit => ''pack'')',:'a',:'stock_a'), '23514', 'consumo superiore a disponibilità certa negato');
select pg_temp.assert_true((select quantity = 3 from public.stock_entries where id = :'stock_a'), 'consumo fallito non modifica quantità');
select public.record_stock_movement(:'a',gen_random_uuid(),'consume',p_entry_id => :'opened',p_state => '{"level":"low"}');
select pg_temp.assert_true((select level = 'low' and quantity is null and package_count = 1 from public.stock_entries where id = :'opened'), 'consumo indicativo quasi finito senza quantità numerica');
select pg_temp.expect_error(format('select public.record_stock_movement(%L,gen_random_uuid(),''consume'',p_entry_id => %L,p_state => ''{"level":"available"}'')',:'a',:'opened'), '22023', 'consumo non può aumentare livello indicativo');
select public.record_stock_movement(:'a',gen_random_uuid(),'discard',p_entry_id => :'opened');
select pg_temp.assert_true((select level = 'empty' and package_count = 0 and quantity is null from public.stock_entries where id = :'opened'), 'scarto indicativo distingue vuoto da quantità numerica');
select pg_temp.new_stock(:'a',:'hp_flour','{"mode":"unknown","certainty":"unknown"}') as unknown_stock \gset
select pg_temp.new_stock(:'a',:'hp_flour','{"mode":"measure","quantity":"0","unit":"kg","certainty":"confirmed"}') as zero_stock \gset
select pg_temp.new_stock(:'a',:'hp_flour','{"mode":"measure","quantity":"0.4","unit":"kg","certainty":"estimated"}') as estimate_stock \gset
select pg_temp.assert_true((select quantity is null and last_verified_at is null and certainty = 'unknown' from public.stock_entries where id = :'unknown_stock'), 'sconosciuto resta NULL, senza data di conferma');
select pg_temp.assert_true((select quantity = 0 and certainty = 'confirmed' and last_verified_at is not null from public.stock_entries where id = :'zero_stock'), 'zero confermato resta distinto da sconosciuto');
select pg_temp.assert_true((select quantity = 0.4 and certainty = 'estimated' and last_verified_at is null from public.stock_entries where id = :'estimate_stock'), 'stima resta esplicitamente stimata e non confermata');
select pg_temp.expect_error(format('select public.record_stock_movement(%L,gen_random_uuid(),''consume'',p_entry_id => %L,p_amount => 0.1,p_unit => ''kg'')',:'a',:'unknown_stock'), '22023', 'consumo numerico da sconosciuto negato');
select pg_temp.expect_error(format('select public.record_stock_movement(%L,gen_random_uuid(),''consume'',p_entry_id => %L,p_amount => 0.1,p_unit => ''kg'')',:'a',:'estimate_stock'), '22023', 'consumo numerico da stima non trattato come certo');
select pg_temp.new_stock(:'a',:'hp_flour','{"mode":"measure","quantity":"1.5","unit":"kg","certainty":"confirmed"}','purchase') as measured \gset
select public.record_stock_movement(:'a',gen_random_uuid(),'consume',p_entry_id => :'measured',p_amount => 0.25,p_unit => 'kg');
select public.record_stock_movement(:'a',gen_random_uuid(),'purchase',p_entry_id => :'measured',p_amount => 0.1,p_unit => 'kg');
select pg_temp.assert_true((select quantity = 1.35 from public.stock_entries where id = :'measured'), 'aritmetica frazionaria esatta: 1.5 - 0.25 + 0.1 = 1.35');
select version as measured_version from public.stock_entries where id = :'measured' \gset
select public.record_stock_movement(:'a',gen_random_uuid(),'correction',p_entry_id => :'measured',p_expected_version => :measured_version,p_state => '{"mode":"measure","quantity":"0.75","unit":"kg","certainty":"confirmed","expires_on":"2030-01-01"}') as correction \gset
select pg_temp.assert_true((select quantity = 0.75 and expires_on = '2030-01-01' from public.stock_entries where id = :'measured'), 'correzione sostituisce quantità senza fingere un consumo');
select pg_temp.assert_true((select kind = 'correction' and before_state->0->>'quantity' = '1.35' and after_state->0->>'quantity' = '0.75' from public.stock_movements where id = :'correction'), 'storico correzione conserva valori decimali come stringhe');
select pg_temp.expect_error(format('select public.record_stock_movement(%L,gen_random_uuid(),''correction'',p_entry_id => %L,p_expected_version => %s,p_state => ''{"mode":"unknown","certainty":"unknown"}'')',:'a',:'measured',:measured_version), '40001', 'correzione con versione obsoleta negata');
select pg_temp.expect_error(format('select public.record_stock_movement(%L,gen_random_uuid(),''correction'',p_entry_id => %L,p_state => ''{"mode":"unknown","certainty":"unknown"}'')',:'a',:'measured'), '22023', 'correzione richiede versione corrente');
select pg_temp.expect_error(format('select public.record_stock_movement(%L,gen_random_uuid(),''consume'',p_entry_id => %L,p_amount => 0.1,p_unit => ''g'')',:'a',:'measured'), '22023', 'unita attesa errata non reinterpreta un consumo');
select pg_temp.expect_error(format('select public.record_stock_movement(%L,gen_random_uuid(),''consume'',p_entry_id => %L,p_amount => 0.1)',:'a',:'measured'), '22023', 'operazione numerica richiede unita esplicita');
select pg_temp.new_stock(:'a',:'hp_flour','{"mode":"measure","quantity":"750","unit":"g","certainty":"confirmed"}') as grams_stock \gset
select pg_temp.assert_true((select quantity = 750 and unit = 'g' from public.stock_entries where id = :'grams_stock'), 'misura 750 g senza conversioni implicite');
select pg_temp.new_stock(:'a',:'hp_flour','{"mode":"measure","quantity":"0","unit":"kg","certainty":"estimated"}') as estimated_zero \gset
select pg_temp.assert_true((select quantity = 0 and certainty = 'estimated' and last_verified_at is null from public.stock_entries where id = :'estimated_zero'), 'zero stimato resta distinto da zero confermato');
select public.record_stock_movement(:'a',gen_random_uuid(),'discard',p_entry_id => :'unknown_stock') as discard_unknown \gset
select pg_temp.assert_true((select mode = 'level' and level = 'empty' and quantity is null and certainty = 'confirmed' from public.stock_entries where id = :'unknown_stock'), 'scarto completo da sconosciuto conferma vuoto senza inventare quantita');
select pg_temp.assert_true((select kind = 'discard' and before_state->0->>'mode' = 'unknown' from public.stock_movements where id = :'discard_unknown'), 'scarto da sconosciuto resta evento scarto');
select pg_temp.expect_error(format('select pg_temp.new_stock(%L,%L,''{"mode":"unknown","certainty":"unknown"}'',''purchase'')',:'a',:'hp_a'), '22023', 'acquisto non dichiara certo un totale sconosciuto');
select pg_temp.expect_error(format('select pg_temp.new_stock(%L,%L,''{"mode":"level","level":"available","certainty":"confirmed","package_state":"open","package_count":0}'')',:'a',:'hp_a'), '23514', 'zero contenitori incompatibile con disponibile');
select public.record_stock_movement(:'a','10000000-0000-4000-8000-000000000111','consume',p_entry_id => :'stock_a',p_amount => 1,p_unit => 'pack') as once \gset
select pg_temp.assert_true(public.record_stock_movement(:'a','10000000-0000-4000-8000-000000000111','consume',p_entry_id => :'stock_a',p_amount => 1,p_unit => 'pack') = :'once', 'retry stessa richiesta restituisce stesso movimento');
select pg_temp.assert_true((select quantity = 2 from public.stock_entries where id = :'stock_a'), 'retry non duplica consumo');
select pg_temp.expect_error(format('select public.record_stock_movement(%L,''10000000-0000-4000-8000-000000000111'',''consume'',p_entry_id => %L,p_amount => 2,p_unit => ''pack'')',:'a',:'stock_a'), '22023', 'stessa chiave con payload diverso negata');
select public.record_stock_movement(:'a',gen_random_uuid(),'move',p_entry_id => :'stock_a',p_location_id => :'loc_a');
select pg_temp.assert_true((select location_id = :'loc_a' and quantity = 2 from public.stock_entries where id = :'stock_a'), 'cambio posizione conserva quantità');
select public.record_stock_movement(:'a',gen_random_uuid(),'move',p_entry_id => :'stock_a');
select pg_temp.assert_true((select location_id is null from public.stock_entries where id = :'stock_a'), 'posizione torna facoltativa');
select pg_temp.expect_error(format('select public.record_stock_movement(%L,gen_random_uuid(),''consume'',p_entry_id => %L,p_amount => 0.5,p_unit => ''pack'')',:'a',:'stock_a'), '22023', 'mezzo pacco non diventa un conteggio certo');
select pg_temp.expect_error(format('select pg_temp.new_stock(%L,%L,''{"mode":"count","quantity":1,"certainty":"confirmed"}'')',:'a',:'hp_a'), '23514', 'SQL NULL non aggira il vincolo sull’unita');
select pg_temp.expect_error(format('select pg_temp.new_stock(%L,%L,''{"mode":"count","quantity":0.5,"unit":"pack","certainty":"confirmed"}'')',:'a',:'hp_a'), '23514', 'conteggio frazionario vietato anche nello stato iniziale');
select pg_temp.expect_error(format('select pg_temp.new_stock(%L,%L,''{"mode":"measure","quantity":"NaN","unit":"kg","certainty":"confirmed"}'')',:'a',:'hp_flour'), '23514', 'NaN non entra nell’inventario');
select pg_temp.expect_error(format('select pg_temp.new_stock(%L,%L,''{"mode":"measure","quantity":"Infinity","unit":"kg","certainty":"confirmed"}'')',:'a',:'hp_flour'), '23514', 'infinito non entra nell’inventario');
select pg_temp.expect_error(format('select pg_temp.new_stock(%L,%L,''{"mode":"measure","quantity":"0.0000001","unit":"kg","certainty":"confirmed"}'')',:'a',:'hp_flour'), '23514', 'precisione oltre sei decimali rifiutata, non arrotondata');
select pg_temp.expect_error(format('select pg_temp.new_stock(%L,%L,''{"mode":"measure","quantity":1,"unit":"l","certainty":"confirmed"}'')',:'a',:'hp_a'), '23514', 'nessuna conversione implicita massa volume');
select pg_temp.expect_error(format('select pg_temp.new_stock(%L,%L,''{"mode":"unknown","certainty":"unknown","role":"owner"}'')',:'a',:'hp_a'), '22023', 'payload non può introdurre ruoli o campi arbitrari');
select pg_temp.expect_error(format('update public.stock_entries set quantity = 999 where id = %L',:'stock_a'), '42501', 'niente UPDATE stock diretto senza movimento');
select pg_temp.expect_error(format('update public.home_products set home_id = %L where id = %L',:'b',:'hp_a'), '42501', 'home_id non modificabile dal client');
-- Fallimento dello storico DOPO la variazione: nessuna mezza apertura rimane.
select count(*) as entries_before_failure from public.stock_entries where home_id = :'a' \gset
select count(*) as events_before_failure from public.stock_movements where home_id = :'a' \gset
reset role;
create function pg_temp.reject_stock_event() returns trigger language plpgsql as $$
begin raise exception 'Forced journal failure' using errcode = '23514'; end $$;
create trigger test_reject_stock_event before insert on public.stock_movements for each row execute function pg_temp.reject_stock_event();
set local role authenticated;
select pg_temp.expect_error(format('select public.record_stock_movement(%L,gen_random_uuid(),''open'',p_entry_id => %L,p_amount => 1,p_unit => ''pack'')',:'a',:'stock_a'), '23514', 'fallimento registro annulla apertura e decremento');
select pg_temp.assert_true((select quantity = 2 from public.stock_entries where id = :'stock_a') and (select count(*) = :entries_before_failure from public.stock_entries where home_id = :'a'), 'rollback apertura conserva quantita e non lascia nuovi lotti');
select pg_temp.assert_true((select count(*) = :events_before_failure from public.stock_movements where home_id = :'a'), 'fallimento atomico non lascia movimenti parziali');
reset role;
drop trigger test_reject_stock_event on public.stock_movements;
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000104',true);
select pg_temp.assert_true((select quantity = 2 from public.stock_entries where id = :'stock_a'), 'viewer legge quantità autorizzata');
select pg_temp.expect_error(format('select public.record_stock_movement(%L,gen_random_uuid(),''consume'',p_entry_id => %L,p_amount => 1,p_unit => ''pack'')',:'a',:'stock_a'), '42501', 'viewer non modifica scorte');
select pg_temp.expect_error(format('insert into public.storage_locations(home_id,name) values (%L,''Negata'')',:'a'), '42501', 'viewer non crea posizioni');
select pg_temp.expect_error(format('insert into public.products(scope_home_id,name) values (%L,''Negato'')',:'a'), '42501', 'viewer non crea prodotti');
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000105',true);
select pg_temp.assert_true((select count(*) = 0 from public.stock_entries where home_id = :'a'), 'revocato non legge scorte');
select pg_temp.assert_true((select count(*) = 0 from public.stock_movements where home_id = :'a'), 'revocato non legge storico');
select pg_temp.expect_error(format('select public.record_stock_movement(%L,gen_random_uuid(),''consume'',p_entry_id => %L,p_amount => 1,p_unit => ''pack'')',:'a',:'stock_a'), '42501', 'revocato non modifica scorte');
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000103',true);
insert into public.products(scope_home_id,name,category) values (:'a','Detersivo personale','household') returning id as detergent \gset
insert into public.product_formats(product_id,label,kind,size_quantity,size_unit) values (:'detergent','Flacone 1.5 l','packaged',1.5,'l') returning id as detergent_format \gset
insert into public.home_products(home_id,format_id) values (:'a',:'detergent_format') returning id as hp_detergent \gset
select pg_temp.new_stock(:'a',:'hp_detergent','{"mode":"level","level":"available","certainty":"confirmed","package_state":"open","package_count":1}','purchase') as detergent_stock \gset
select public.record_stock_movement(:'a',gen_random_uuid(),'consume',p_entry_id => :'detergent_stock',p_state => '{"level":"low"}') as editor_movement \gset
select pg_temp.assert_true((select level = 'low' from public.stock_entries where id = :'detergent_stock'), 'editor crea prodotto domestico e aggiorna scorta indicativa');
select pg_temp.expect_error(format('select public.record_stock_movement(%L,''10000000-0000-4000-8000-000000000111'',''consume'',p_entry_id => %L,p_amount => 1,p_unit => ''pack'')',:'a',:'stock_a'), '22023', 'idempotenza non trasferisce richieste tra autori');
select pg_temp.expect_error(format('delete from public.stock_movements where id = %L',:'editor_movement'), '42501', 'client non elimina movimenti');
reset role;
select pg_temp.assert_true((select quantity = 7 from public.stock_entries where id = :'stock_b'), 'stesso formato in due case mantiene quantità indipendenti');
select pg_temp.expect_error(format('update public.stock_movements set note = ''Riscritta'' where id = %L',:'editor_movement'), '55000', 'storico append-only anche per DML amministrativo normale');
select pg_temp.expect_error(format('delete from public.stock_movements where id = %L',:'editor_movement'), '55000', 'storico non eliminabile mentre la casa esiste');
select pg_temp.expect_error(format('update public.stock_movements set actor_user_id = null where id = %L',:'editor_movement'), '55000', 'nessun anonimato manuale mentre autore esiste');
select pg_temp.expect_error(format('delete from public.product_formats where id = %L; set constraints all immediate',:'shared_format'), '23503', 'formato comune in uso non cancellabile lasciando riferimenti orfani');
set constraints all immediate;
delete from auth.users where id = '00000000-0000-4000-8000-000000000103';
select pg_temp.assert_true((select actor_user_id is null and kind = 'consume' from public.stock_movements where id = :'editor_movement'), 'eliminazione account anonimizza autore conservando storico');
select pg_temp.assert_true(exists (select from public.stock_entries where id = :'detergent_stock'), 'eliminazione autore non cancella scorta condivisa');
select pg_temp.assert_true((select count(*) = 6 and bool_and(relrowsecurity) from pg_class where oid in ('public.products'::regclass,'public.product_formats'::regclass,'public.home_products'::regclass,'public.storage_locations'::regclass,'public.stock_entries'::regclass,'public.stock_movements'::regclass)), 'catalogo: RLS su tutte le sei nuove tabelle');
select pg_temp.assert_true(not has_table_privilege('authenticated','public.stock_entries','UPDATE') and not has_table_privilege('authenticated','public.stock_movements','INSERT'), 'catalogo: scritture stock e storico riservate alla RPC');
set local role anon;
select pg_temp.expect_error('select * from public.products', '42501', 'anon senza accesso al catalogo');
select pg_temp.expect_error('select * from public.product_formats', '42501', 'anon senza accesso ai formati');
select pg_temp.expect_error('select * from public.home_products', '42501', 'anon senza accesso ai prodotti domestici');
select pg_temp.expect_error('select * from public.storage_locations', '42501', 'anon senza accesso alle posizioni');
select pg_temp.expect_error('select * from public.stock_entries', '42501', 'anon senza accesso alle scorte');
select pg_temp.expect_error('select * from public.stock_movements', '42501', 'anon senza accesso allo storico');
select pg_temp.expect_error(format('select public.record_stock_movement(%L,gen_random_uuid(),''consume'',p_entry_id => %L,p_amount => 1,p_unit => ''pack'')',:'a',:'stock_a'), '42501', 'anon senza RPC inventario');
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000101',true);
select public.delete_home(:'a');
reset role;
select pg_temp.assert_true(not exists (select from public.stock_entries where home_id = :'a') and not exists (select from public.stock_movements where home_id = :'a'), 'delete_home M0 elimina scorte e storico atomicamente');
select pg_temp.assert_true(not exists (select from public.products where scope_home_id = :'a') and not exists (select from public.home_products where home_id = :'a') and not exists (select from public.storage_locations where home_id = :'a'), 'delete_home rimuove solo metadati domestici propri');
select pg_temp.assert_true((select quantity = 7 from public.stock_entries where id = :'stock_b') and exists (select from public.product_formats where id = :'shared_format'), 'delete_home conserva casa B e catalogo comune');
set constraints all immediate;
rollback;
