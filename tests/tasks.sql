\set ON_ERROR_STOP on
begin;
create function pg_temp.ok(v boolean,label text) returns void language plpgsql as $$begin if v is distinct from true then raise exception 'FAIL: %',label; end if; raise notice 'PASS: %',label;end$$;
create function pg_temp.denied(command text, expected text default '42501') returns void language plpgsql as $$begin execute command; raise exception 'Expected rejection: %',command; exception when others then if sqlstate <> expected then raise; end if; raise notice 'PASS: denied %',expected;end$$;
insert into auth.users values('10000000-0000-4000-8000-000000000001'),('10000000-0000-4000-8000-000000000002'),('10000000-0000-4000-8000-000000000003'),('10000000-0000-4000-8000-000000000004');
set local role authenticated;
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000001',true);
select public.create_home('R1-A',gen_random_uuid()) h \gset
select public.create_domestic_task('20000000-0000-4000-8000-000000000001',null,'Personale','2028-01-31 09:00','Europe/Rome','maintenance',2::smallint,'calendar') personal \gset
select pg_temp.ok(public.create_domestic_task('20000000-0000-4000-8000-000000000001',null,'Personale','2028-01-31 09:00','Europe/Rome','maintenance',2::smallint,'calendar')=:'personal','create retry idempotent');
select pg_temp.denied($cmd$select public.create_domestic_task('20000000-0000-4000-8000-000000000001',null,'Diverso')$cmd$,'22023');
select public.create_domestic_task(gen_random_uuid(),:'h','Casa') shared \gset
reset role;
insert into public.home_members(home_id,user_id,role) values(:'h','10000000-0000-4000-8000-000000000002','editor'),(:'h','10000000-0000-4000-8000-000000000003','viewer');
update public.task_reminder_plans set enabled=true where task_id=:'personal';
set local role authenticated;
select public.act_on_domestic_task('20000000-0000-4000-8000-000000000002',:'personal',1,'complete');
select public.act_on_domestic_task('20000000-0000-4000-8000-000000000002',:'personal',1,'complete');
select pg_temp.ok((select count(*)=2 from public.domestic_tasks where owner_user_id=auth.uid()),'one successor on retry');
select pg_temp.ok((select state='completed' and version=2 from public.domestic_tasks where id=:'personal'),'completion persisted');
select pg_temp.ok((select not enabled and stopped_at is not null from public.task_reminder_plans where task_id=:'personal'),'completion stops reminders');
select id successor from public.domestic_tasks where previous_task_id=:'personal' \gset
select pg_temp.ok((select state='needs_verification' and due_local='2028-02-29 09:00'::timestamp from public.domestic_tasks where id=:'successor'),'month end leap date unconfirmed');
select pg_temp.denied(format('select public.act_on_domestic_task(gen_random_uuid(),%L,1,''complete'')',:'successor'),'22023');
select public.act_on_domestic_task(gen_random_uuid(),:'successor',1,'confirm');
select public.act_on_domestic_task(gen_random_uuid(),:'successor',2,'complete');
select pg_temp.ok((select due_local='2028-03-31 09:00'::timestamp from public.domestic_tasks where previous_task_id=:'successor'),'anchor preserved March 31');
select public.create_domestic_task(gen_random_uuid(),null,'Polizza','2028-04-01','Europe/Rome','deadline',3::smallint,'confirmed_date') certain \gset
select public.act_on_domestic_task(gen_random_uuid(),:'certain',1,'complete');
select pg_temp.ok(not exists(select 1 from public.domestic_tasks where previous_task_id=:'certain'),'confirmed deadline has no inferred renewal');
select public.create_domestic_task(gen_random_uuid(),null,'Dopo intervento','2020-01-01','Europe/Rome','maintenance',2::smallint,'after_completion',2,'week') after_task \gset
select public.act_on_domestic_task(gen_random_uuid(),:'after_task',1,'complete');
select pg_temp.ok((select due_at>now()+interval '13 days' and due_at<now()+interval '15 days' from public.domestic_tasks where previous_task_id=:'after_task'),'interval after actual completion');
select pg_temp.denied($cmd$select public.create_domestic_task(gen_random_uuid(),null,'Gap','2027-03-28 02:30','Europe/Rome')$cmd$,'22023');
select public.create_domestic_task(gen_random_uuid(),null,'DST','2027-10-31 02:30','Europe/Rome') autumn \gset
select pg_temp.ok((select due_at='2027-10-31 01:30Z'::timestamptz from public.domestic_tasks where id=:'autumn'),'autumn repeated hour standard time');
select pg_temp.denied($cmd$select public.create_domestic_task(gen_random_uuid(),null,'Zone',null,'Invalid/Zone')$cmd$,'22023');
select pg_temp.denied(format('update public.domestic_tasks set importance=3 where id=%L',:'shared'));
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000002',true);
select pg_temp.ok((select count(*)=1 from public.domestic_tasks),'editor sees home, no personal tasks');
select public.act_on_domestic_task(gen_random_uuid(),:'shared',1,'snooze','2090-01-01');
select pg_temp.ok((select state='snoozed' and due_at is null from public.domestic_tasks where id=:'shared'),'snooze does not change original due date');
select pg_temp.denied(format('select public.act_on_domestic_task(gen_random_uuid(),%L,1,''complete'')',:'shared'),'40001');
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000003',true);
select pg_temp.ok((select count(*)=1 from public.domestic_tasks),'viewer reads home');
select pg_temp.denied(format('select public.act_on_domestic_task(gen_random_uuid(),%L,2,''complete'')',:'shared'));
select pg_temp.denied(format('select public.create_domestic_task(gen_random_uuid(),%L,''viewer'')',:'h'));
select public.create_domestic_task(gen_random_uuid(),null,'Viewer personal');
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000004',true);
select public.create_home('Other house',gen_random_uuid()) other_h \gset
select pg_temp.ok((select count(*)=0 from public.domestic_tasks),'other account/house isolated');
select pg_temp.denied(format('select public.act_on_domestic_task(gen_random_uuid(),%L,2,''complete'')',:'shared'));
select pg_temp.denied(format('select public.act_on_domestic_task(gen_random_uuid(),%L,2,''complete'')',:'personal'));
reset role;
update public.home_members set revoked_at=now() where home_id=:'h' and user_id='10000000-0000-4000-8000-000000000002';
set local role authenticated;
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000002',true);
select pg_temp.ok((select count(*)=0 from public.domestic_tasks),'revocation immediately removes reads');
select pg_temp.denied(format('select public.act_on_domestic_task(gen_random_uuid(),%L,2,''complete'')',:'shared'));
reset role;
set local role anon;
select pg_temp.denied('select * from public.domestic_tasks');
select pg_temp.denied($cmd$select public.create_domestic_task(gen_random_uuid(),null,'anon')$cmd$);
reset role;
select pg_temp.ok(private.task_next_local('2028-02-29 09:00',1,'year',1)='2029-02-28 09:00'::timestamp,'leap year interval');
select pg_temp.ok(private.task_instant('2027-03-27 09:00','Europe/Rome')='2027-03-27 08:00Z'::timestamptz and private.task_instant('2027-03-28 09:00','Europe/Rome')='2027-03-28 07:00Z'::timestamptz,'DST preserves local wall time');
rollback;
