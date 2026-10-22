\set ON_ERROR_STOP on
begin;
create function pg_temp.assert_true(value boolean, label text) returns void language plpgsql as $$
begin
  if value is distinct from true then raise exception 'FAIL: %', label; end if;
  raise notice 'PASS: %', label;
end $$;
create function pg_temp.expect_error(statement text, expected_state text, label text) returns void language plpgsql as $$
declare actual_state text;
begin
  begin execute statement;
  exception when others then
    get stacked diagnostics actual_state = returned_sqlstate;
    if actual_state <> expected_state then
      raise exception 'FAIL: %, expected %, got %', label, expected_state, actual_state;
    end if;
    raise notice 'PASS: %', label;
    return;
  end;
  raise exception 'FAIL (operation accepted): %', label;
end $$;
insert into auth.users(id) values
 ('00000000-0000-4000-8000-000000000011'),
 ('00000000-0000-4000-8000-000000000012'),
 ('00000000-0000-4000-8000-000000000013'),
 ('00000000-0000-4000-8000-000000000014'),
 ('00000000-0000-4000-8000-000000000015'),
 ('00000000-0000-4000-8000-000000000016'),
 ('00000000-0000-4000-8000-000000000017'),
 ('00000000-0000-4000-8000-000000000018');
-- Cancellazione Auth amministrativa, senza casa: profilo rimosso in cascata.
delete from auth.users where id = '00000000-0000-4000-8000-000000000014';
select pg_temp.assert_true(not exists (select from auth.users where id = '00000000-0000-4000-8000-000000000014'), 'account senza case eliminabile');
select pg_temp.assert_true(not exists (select from public.profiles where user_id = '00000000-0000-4000-8000-000000000014'), 'profilo account eliminato in cascata');
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000011', true);
select public.create_home('Condivisa', gen_random_uuid()) as shared \gset
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000015', true);
select public.create_home('Indipendente', gen_random_uuid()) as independent \gset
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000016', true);
select public.create_home('Unico proprietario', gen_random_uuid()) as solo \gset
reset role;
insert into public.home_members(home_id,user_id,role,revoked_at) values
 (:'shared','00000000-0000-4000-8000-000000000012','editor',null),
 (:'shared','00000000-0000-4000-8000-000000000013','viewer',now()),
 (:'shared','00000000-0000-4000-8000-000000000016','editor',null),
 (:'shared','00000000-0000-4000-8000-000000000017','viewer',null),
 (:'shared','00000000-0000-4000-8000-000000000018','editor',null);
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000013', true);
select pg_temp.expect_error(format('insert into public.home_members(home_id,user_id,role) values (%L,%L,''owner'')', :'shared', '00000000-0000-4000-8000-000000000013'), '42501', 'revocato non può reinserirsi');
select pg_temp.expect_error(format('update public.home_members set revoked_at = null, role = ''owner'' where home_id = %L', :'shared'), '42501', 'revocato non può riattivarsi o promuoversi');
select pg_temp.expect_error(format('select public.delete_home(%L)', :'shared'), '42501', 'revocato non può eliminare la casa');
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000011', true);
select pg_temp.expect_error(format('select public.manage_home_member(%L,%L,''viewer'')', :'shared', '00000000-0000-4000-8000-000000000013'), '22023', 'RPC attuale non riattiva revocati neppure per owner');
select pg_temp.expect_error(format('select public.transfer_home_ownership(%L,%L)', :'shared', '00000000-0000-4000-8000-000000000013'), '22023', 'trasferimento a revocato negato');
select pg_temp.expect_error(format('select public.transfer_home_ownership(%L,%L)', :'shared', '00000000-0000-4000-8000-000000000015'), '22023', 'trasferimento a non membro negato');
select pg_temp.expect_error(format('select public.transfer_home_ownership(%L,%L)', :'shared', '00000000-0000-4000-8000-000000000011'), '22023', 'trasferimento a se stesso negato');
reset role;
-- Solo primitiva amministrativa: mostra il riuso della PK, NON simula un invito valido.
-- La futura RPC inviti dovrà verificare token, identità, ruolo e consumo atomico.
update public.home_members set role = 'viewer', revoked_at = null, joined_at = now(), access_version = 1
 where home_id = :'shared' and user_id = '00000000-0000-4000-8000-000000000013';
select pg_temp.assert_true((select count(*) = 1 from public.home_members where home_id = :'shared' and user_id = '00000000-0000-4000-8000-000000000013' and role = 'viewer' and revoked_at is null), 'PK riutilizzabile con UPDATE privilegiato senza duplicare membership');
select pg_temp.assert_true((select access_version = 2 from public.home_members where home_id = :'shared' and user_id = '00000000-0000-4000-8000-000000000013'), 'riattivazione incrementa versione anche se UPDATE tenta di forzarla');
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000011', true);
select public.manage_home_member(:'shared','00000000-0000-4000-8000-000000000013','viewer',true);
select pg_temp.assert_true((select access_version = 3 from public.home_members where home_id = :'shared' and user_id = '00000000-0000-4000-8000-000000000013') is null, 'revocato nascosto anche a owner nella policy membri attivi');
reset role;
select pg_temp.assert_true((select access_version = 3 and revoked_at is not null from public.home_members where home_id = :'shared' and user_id = '00000000-0000-4000-8000-000000000013'), 'revoca incrementa versione e invalida la generazione precedente');
delete from auth.users where id = '00000000-0000-4000-8000-000000000013';
select pg_temp.assert_true(not exists (select from auth.users where id = '00000000-0000-4000-8000-000000000013'), 'account con membership revocata eliminabile');
select pg_temp.assert_true(not exists (select from public.home_members where user_id = '00000000-0000-4000-8000-000000000013'), 'membership revocata eliminata in cascata');
select pg_temp.assert_true(exists (select from public.homes where id = :'shared'), 'eliminazione revocato conserva casa condivisa');
select pg_temp.expect_error('delete from auth.users where id = ''00000000-0000-4000-8000-000000000011''', '23514', 'eliminazione Auth ultimo owner negata');
select pg_temp.assert_true(exists (select from public.profiles where user_id = '00000000-0000-4000-8000-000000000011') and exists (select from public.homes where id = :'shared' and created_by = '00000000-0000-4000-8000-000000000011'), 'account negato: rollback di profilo e created_by');
select pg_temp.expect_error('delete from auth.users where id = ''00000000-0000-4000-8000-000000000016''', '23514', 'account ultimo owner di una tra più case non eliminabile');
select pg_temp.assert_true(exists (select from public.home_members where home_id = :'shared' and user_id = '00000000-0000-4000-8000-000000000016') and exists (select from auth.users where id = '00000000-0000-4000-8000-000000000016'), 'eliminazione account fallita conserva tutte le sue membership');
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000018', true);
select pg_temp.expect_error(format('select public.delete_home(%L)', :'shared'), '42501', 'editor non può eliminare casa');
select pg_temp.expect_error(format('select public.transfer_home_ownership(%L,%L)', :'shared', '00000000-0000-4000-8000-000000000018'), '42501', 'editor non può trasferire proprietà');
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000017', true);
select pg_temp.expect_error(format('select public.delete_home(%L)', :'shared'), '42501', 'viewer non può eliminare casa');
select pg_temp.expect_error(format('select public.transfer_home_ownership(%L,%L)', :'shared', '00000000-0000-4000-8000-000000000017'), '42501', 'viewer non può trasferire proprietà');
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000015', true);
select pg_temp.expect_error(format('select public.delete_home(%L)', :'shared'), '42501', 'estraneo non può eliminare casa altrui');
select pg_temp.expect_error(format('select public.transfer_home_ownership(%L,%L)', :'shared', '00000000-0000-4000-8000-000000000015'), '42501', 'estraneo non può trasferire casa altrui');
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000011', true);
select pg_temp.expect_error(format('delete from public.homes where id = %L', :'shared'), '42501', 'owner non ha DELETE diretto: usa RPC controllata');
reset role;
create function pg_temp.reject_transfer_demotion() returns trigger language plpgsql as $$
begin
  if old.user_id = '00000000-0000-4000-8000-000000000011' and new.role = 'editor' then
    raise exception 'Forced transfer failure' using errcode = '23514';
  end if;
  return new;
end $$;
create trigger test_reject_transfer before update on public.home_members for each row execute function pg_temp.reject_transfer_demotion();
set local role authenticated;
select pg_temp.expect_error(format('select public.transfer_home_ownership(%L,%L)', :'shared', '00000000-0000-4000-8000-000000000012'), '23514', 'errore nella seconda parte annulla trasferimento');
select pg_temp.assert_true((select role = 'owner' from public.home_members where home_id = :'shared' and user_id = '00000000-0000-4000-8000-000000000011') and (select role = 'editor' from public.home_members where home_id = :'shared' and user_id = '00000000-0000-4000-8000-000000000012'), 'rollback trasferimento conserva entrambi i ruoli originari');
reset role;
drop trigger test_reject_transfer on public.home_members;
set local role authenticated;
select public.transfer_home_ownership(:'shared','00000000-0000-4000-8000-000000000012');
select pg_temp.assert_true((select role = 'owner' from public.home_members where home_id = :'shared' and user_id = '00000000-0000-4000-8000-000000000012'), 'trasferimento promuove nuovo owner');
select pg_temp.assert_true((select role = 'editor' from public.home_members where home_id = :'shared' and user_id = '00000000-0000-4000-8000-000000000011'), 'trasferimento demuove vecchio owner');
select pg_temp.expect_error(format('select public.delete_home(%L)', :'shared'), '42501', 'ex owner perde immediatamente diritto di cancellazione');
reset role;
select pg_temp.expect_error('delete from auth.users where id in (''00000000-0000-4000-8000-000000000011'',''00000000-0000-4000-8000-000000000012'')', '23514', 'cancellazione multipla account non può rimuovere tutti gli owner');
select pg_temp.assert_true((select count(*) = 2 from auth.users where id in ('00000000-0000-4000-8000-000000000011','00000000-0000-4000-8000-000000000012')), 'cancellazione multipla fallita ripristina entrambi gli account');
delete from auth.users where id = '00000000-0000-4000-8000-000000000011';
select pg_temp.assert_true(not exists (select from auth.users where id = '00000000-0000-4000-8000-000000000011'), 'vecchio proprietario eliminabile dopo trasferimento');
select pg_temp.assert_true((select created_by is null from public.homes where id = :'shared'), 'casa conservata con autore storico nullo');
select pg_temp.assert_true(not exists (select from public.home_members where user_id = '00000000-0000-4000-8000-000000000011'), 'nessuna membership del vecchio proprietario');
select pg_temp.assert_true(exists (select from public.home_members where home_id = :'shared' and role = 'owner' and user_id = '00000000-0000-4000-8000-000000000012'), 'casa conserva nuovo owner dopo eliminazione account');
-- Cancellazione di un membro attivo non owner: deve riuscire anch'essa.
delete from auth.users where id = '00000000-0000-4000-8000-000000000018';
select pg_temp.assert_true(not exists (select from public.home_members where user_id = '00000000-0000-4000-8000-000000000018'), 'account editor attivo eliminato senza membership orfane');
select pg_temp.expect_error(format('delete from public.home_members where home_id = %L and role = ''owner''', :'shared'), '23514', 'delete diretto ultimo owner ancora negato');
-- Una cancellazione casa che fallisce deve conservare casa e membri.
create function pg_temp.reject_home_delete() returns trigger language plpgsql as $$
begin raise exception 'Forced home deletion failure' using errcode = '23514'; end $$;
create trigger test_reject_home_delete before delete on public.home_members for each row execute function pg_temp.reject_home_delete();
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000012', true);
select pg_temp.expect_error(format('select public.delete_home(%L)', :'shared'), '23514', 'errore durante cancellazione casa annulla RPC');
select pg_temp.assert_true(exists (select from public.homes where id = :'shared') and (select count(*) = 3 from public.home_members where home_id = :'shared'), 'rollback cancellazione conserva casa e membership');
reset role;
drop trigger test_reject_home_delete on public.home_members;
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000012', true);
select public.delete_home(:'shared');
reset role;
select pg_temp.assert_true(not exists (select from public.homes where id = :'shared'), 'owner unico può eliminare intenzionalmente casa');
select pg_temp.assert_true(not exists (select from public.home_members where home_id = :'shared'), 'eliminazione casa rimuove tutte le membership');
select pg_temp.assert_true(exists (select from auth.users where id = '00000000-0000-4000-8000-000000000012'), 'cancellazione casa non cancella account');
select pg_temp.assert_true(exists (select from public.homes where id = :'independent') and exists (select from public.home_members where home_id = :'independent' and role = 'owner'), 'cancellazione casa non tocca abitazione indipendente');
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000016', true);
select public.delete_home(:'solo');
reset role;
delete from auth.users where id = '00000000-0000-4000-8000-000000000016';
select pg_temp.assert_true(not exists (select from auth.users where id = '00000000-0000-4000-8000-000000000016'), 'ultimo owner eliminabile dopo eliminazione intenzionale della sua casa');
select pg_temp.assert_true(not exists (select from public.home_members m left join auth.users u on u.id = m.user_id left join public.homes h on h.id = m.home_id where u.id is null or h.id is null), 'nessuna membership orfana');
select pg_temp.assert_true(not exists (select from public.homes h where not exists (select from public.home_members m where m.home_id = h.id and m.role = 'owner' and m.revoked_at is null)), 'nessuna casa esistente senza owner');
-- Verifiche del catalogo realmente interrogato su PostgreSQL, oltre ai test di comportamento.
select pg_temp.assert_true((select count(*) = 3 and bool_and(relrowsecurity) from pg_class where oid in ('public.profiles'::regclass,'public.homes'::regclass,'public.home_members'::regclass)), 'catalogo: RLS su tutte le tabelle pubbliche');
select pg_temp.assert_true(not has_function_privilege('authenticated','private.require_home_owner(uuid)','EXECUTE') and not has_function_privilege('authenticated','private.prepare_user_deletion()','EXECUTE'), 'catalogo: helper lifecycle non eseguibili dal client');
select pg_temp.assert_true(not has_table_privilege('authenticated','auth.users','DELETE') and not has_table_privilege('authenticated','public.homes','DELETE'), 'catalogo: nessun grant DELETE diretto');
select pg_temp.assert_true(not exists (select from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname in ('public','private') and p.prosecdef and not ('search_path=""' = any(p.proconfig))), 'catalogo: search_path vuoto su tutte le funzioni privilegiate');
set local role anon;
select pg_temp.expect_error(format('select public.delete_home(%L)', :'independent'), '42501', 'anon non può chiamare delete_home');
select pg_temp.expect_error(format('select public.transfer_home_ownership(%L,%L)', :'independent', '00000000-0000-4000-8000-000000000015'), '42501', 'anon non può chiamare trasferimento');
reset role;
rollback;
