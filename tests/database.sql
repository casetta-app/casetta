\set ON_ERROR_STOP on
begin;
create function pg_temp.assert_true(value boolean, label text) returns void language plpgsql as $$
begin if value is distinct from true then raise exception 'FAIL: %', label; end if; raise notice 'PASS: %', label; end $$;
create function pg_temp.denied(statement text, label text) returns void language plpgsql as $$
begin
  begin execute statement;
  exception when insufficient_privilege or check_violation then raise notice 'PASS: %', label; return;
  end;
  raise exception 'FAIL (operation accepted): %', label;
end $$;
insert into auth.users(id) values
 ('00000000-0000-4000-8000-000000000001'),
 ('00000000-0000-4000-8000-000000000002'),
 ('00000000-0000-4000-8000-000000000003'),
 ('00000000-0000-4000-8000-000000000004');
select pg_temp.assert_true((select count(*) = 4 from public.profiles), 'profile automatico');
select pg_temp.assert_true((select count(*) = 0 from public.homes), 'registrazione senza casa automatica');
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000001', true);
select public.create_home('Casa', '10000000-0000-4000-8000-000000000001') as home_a \gset
select public.create_home('Casa', '10000000-0000-4000-8000-000000000002') as home_a2 \gset
select pg_temp.assert_true(public.create_home('Casa', '10000000-0000-4000-8000-000000000001') = :'home_a', 'retry idempotente');
select pg_temp.assert_true((select count(*) = 2 from public.homes), 'utente con due case anche omonime');
select pg_temp.assert_true((select count(*) = 2 from public.home_members where role = 'owner'), 'creazione atomica owner');
select pg_temp.assert_true((select count(*) = 1 from public.profiles), 'profili privati');
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000002', true);
select public.create_home('Casa B', '10000000-0000-4000-8000-000000000003') as home_b \gset
select pg_temp.assert_true((select count(*) = 1 from public.homes), 'abitazioni indipendenti');
select pg_temp.assert_true((select count(*) = 0 from public.homes where id = :'home_a'), 'lettura cross-home negata');
select pg_temp.denied(format('insert into public.home_members(home_id,user_id,role) values (%L,%L,''owner'')', :'home_a', '00000000-0000-4000-8000-000000000002'), 'autoassegnazione negata');
select pg_temp.denied(format('update public.homes set name = ''Attacco'' where id = %L', :'home_a'), 'modifica casa non autorizzata');
select pg_temp.denied(format('select public.manage_home_member(%L,%L,''owner'')', :'home_a', '00000000-0000-4000-8000-000000000002'), 'RPC cross-home negata');
reset role;
-- Fixture amministrativa di condivisione: non esiste ancora un flusso inviti.
insert into public.home_members(home_id,user_id,role,relationship) values
 (:'home_a', '00000000-0000-4000-8000-000000000002', 'editor','resident'),
 (:'home_a', '00000000-0000-4000-8000-000000000003', 'viewer','guest');
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000002', true);
select pg_temp.assert_true((select count(*) = 2 from public.homes), 'membro casa propria e condivisa');
select pg_temp.assert_true((select count(*) = 3 from public.home_members where home_id = :'home_a'), 'più membri e policy senza ricorsione');
select pg_temp.denied(format('update public.home_members set role = ''owner'' where home_id = %L', :'home_a'), 'alterazione diretta ruoli negata');
select pg_temp.denied(format('select public.manage_home_member(%L,%L,''owner'')', :'home_a', '00000000-0000-4000-8000-000000000002'), 'editor non può promuoversi');
select pg_temp.denied(format('delete from public.home_members where home_id = %L', :'home_a'), 'delete diretto negato');
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000003', true);
select pg_temp.assert_true((select count(*) = 1 from public.homes), 'viewer consulta solo casa autorizzata');
select pg_temp.denied(format('select public.manage_home_member(%L,%L,''owner'')', :'home_a', '00000000-0000-4000-8000-000000000003'), 'viewer non può promuoversi');
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000001', true);
select pg_temp.denied(format('select public.manage_home_member(%L,%L,''viewer'')', :'home_a', '00000000-0000-4000-8000-000000000001'), 'demozione ultimo owner negata');
select pg_temp.denied(format('select public.manage_home_member(%L,%L,''owner'',true)', :'home_a', '00000000-0000-4000-8000-000000000001'), 'revoca ultimo owner negata');
select public.manage_home_member(:'home_a', '00000000-0000-4000-8000-000000000003', 'viewer', true);
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000003', true);
select pg_temp.assert_true((select count(*) = 0 from public.homes), 'revoca rimuove lettura case');
select pg_temp.assert_true((select count(*) = 0 from public.home_members), 'revoca rimuove lettura membri');
reset role;
select pg_temp.denied(format('delete from public.home_members where home_id = %L and role = ''owner''', :'home_a'), 'trigger protegge delete ultimo owner anche amministrativo');
-- Un errore nell'inserimento owner deve annullare anche l'inserimento casa.
create function pg_temp.reject_owner() returns trigger language plpgsql as $$
begin raise exception 'Forced membership failure' using errcode = '23514'; end $$;
create trigger test_reject_owner before insert on public.home_members for each row execute function pg_temp.reject_owner();
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000004', true);
select pg_temp.denied('select public.create_home(''Rollback'', ''10000000-0000-4000-8000-000000000004'')', 'errore owner annulla creazione');
reset role;
select pg_temp.assert_true((select count(*) = 0 from public.homes where created_by = '00000000-0000-4000-8000-000000000004'), 'nessuna casa orfana dopo errore');
drop trigger test_reject_owner on public.home_members;
select pg_temp.assert_true(not has_function_privilege('anon', 'private.home_role(uuid)', 'EXECUTE'), 'helper non eseguibile da anon');
select pg_temp.assert_true(not has_function_privilege('authenticated', 'private.protect_last_owner()', 'EXECUTE'), 'trigger non eseguibile da client');
set local role anon;
select pg_temp.denied('select * from public.homes', 'anon senza accesso case');
select pg_temp.denied('select * from public.home_members', 'anon senza accesso membri');
select pg_temp.denied('select * from public.profiles', 'anon senza accesso profili');
select pg_temp.denied('select public.create_home(''Casa'', gen_random_uuid())', 'anon senza RPC creazione');
reset role;
rollback;
