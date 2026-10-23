\set ON_ERROR_STOP on
begin;
create function pg_temp.ok(v boolean,label text) returns void language plpgsql as $$begin if v is distinct from true then raise exception 'FAIL: %',label; end if; raise notice 'PASS: %',label;end$$;
insert into auth.users values('30000000-0000-4000-8000-000000000001');
set local role authenticated;
select set_config('request.jwt.claim.sub','30000000-0000-4000-8000-000000000001',true);
select public.create_domestic_task(gen_random_uuid(),null,'Plan lifecycle','2020-01-31 09:00','Europe/Rome','maintenance',2::smallint,'calendar') task \gset
select pg_temp.ok((select not enabled and stopped_at is null from public.task_reminder_plans where task_id=:'task'),'R1-A creates disabled, non-retired plan');
-- Synthetic enabled fixture exercises a future worker contract; sends nothing.
reset role;
update public.task_reminder_plans set enabled=true where task_id=:'task';
set local role authenticated;
select gen_random_uuid() start_key \gset
select public.act_on_domestic_task(:'start_key',:'task',1,'start');
select public.act_on_domestic_task(:'start_key',:'task',1,'start');
select pg_temp.ok((select enabled and stopped_at is null from public.task_reminder_plans where task_id=:'task'),'start preserves enabled plan; no retirement');
select pg_temp.ok((select state='in_progress' and version=2 from public.domestic_tasks where id=:'task') and (select count(*)=2 from public.task_events where task_id=:'task'),'start retry has one transition/event');
select gen_random_uuid() snooze_key \gset
select timestamp '2090-10-31 02:30' - extract(dow from date '2090-10-31') * interval '1 day' as ambiguous \gset
select public.act_on_domestic_task(:'snooze_key',:'task',2,'snooze',:'ambiguous');
select public.act_on_domestic_task(:'snooze_key',:'task',2,'snooze',:'ambiguous');
select pg_temp.ok((select enabled and stopped_at is null from public.task_reminder_plans where task_id=:'task'),'snooze does not retire or disable plan');
select pg_temp.ok((select state='snoozed' and completed_at is null and version=3 and due_local='2020-01-31 09:00'::timestamp from public.domestic_tasks where id=:'task'),'snooze retains original deadline, incomplete state and retry version');
select pg_temp.ok((select snoozed_until at time zone 'UTC'=:'ambiguous'::timestamp-interval '1 hour' from public.domestic_tasks where id=:'task'),'ambiguous snooze chooses standard UTC+1');
select count(*) events_before_retry from public.task_events where task_id=:'task' \gset
-- A delayed retry of start must not erase a newer snooze or alter the plan.
select public.act_on_domestic_task(:'start_key',:'task',1,'start');
select pg_temp.ok((select state='snoozed' and version=3 from public.domestic_tasks where id=:'task') and (select count(*)=:'events_before_retry' from public.task_events where task_id=:'task'),'old start retry cannot undo snooze');
select gen_random_uuid() complete_key \gset
select public.act_on_domestic_task(:'complete_key',:'task',3,'complete');
select stopped_at stopped from public.task_reminder_plans where task_id=:'task' \gset
select public.act_on_domestic_task(:'complete_key',:'task',3,'complete');
select public.act_on_domestic_task(:'snooze_key',:'task',2,'snooze',:'ambiguous');
select pg_temp.ok((select not enabled and stopped_at=:'stopped'::timestamptz from public.task_reminder_plans where task_id=:'task'),'completion retires permanently, terminal and stale snooze retries preserve stop timestamp');
select pg_temp.ok((select state='completed' and version=4 from public.domestic_tasks where id=:'task'),'stale snooze retry does not reopen completed task');
select id successor from public.domestic_tasks where previous_task_id=:'task' \gset
select pg_temp.ok((select count(*)=1 from public.domestic_tasks where previous_task_id=:'task') and (select due_local='2020-02-29 09:00'::timestamp and state='needs_verification' from public.domestic_tasks where id=:'successor'),'very late calendar completion yields one anchored, overdue unconfirmed occurrence; no catch-up loop');
select pg_temp.ok((select not enabled and stopped_at is null from public.task_reminder_plans where task_id=:'successor'),'successor plan disabled, not inherited as retired');
select gen_random_uuid() confirm_key \gset
select public.act_on_domestic_task(:'confirm_key',:'successor',1,'confirm');
select public.act_on_domestic_task(:'confirm_key',:'successor',1,'confirm');
select pg_temp.ok((select not enabled and stopped_at is null from public.task_reminder_plans where task_id=:'successor'),'confirm never enables or retires R1-A plan');
select pg_temp.ok((select state='open' and version=2 from public.domestic_tasks where id=:'successor') and (select count(*)=2 from public.task_events where task_id=:'successor'),'confirm retry is one transition/event');
select public.act_on_domestic_task(gen_random_uuid(),:'successor',2,'start');
select public.act_on_domestic_task(gen_random_uuid(),:'successor',3,'snooze','2090-01-01');
select pg_temp.ok((select not enabled and stopped_at is null from public.task_reminder_plans where task_id=:'successor'),'start/snooze never activate disabled plan');
select gen_random_uuid() cancel_key \gset
select public.act_on_domestic_task(:'cancel_key',:'successor',4,'cancel');
select stopped_at cancelled_stop from public.task_reminder_plans where task_id=:'successor' \gset
select public.act_on_domestic_task(:'cancel_key',:'successor',4,'cancel');
select public.act_on_domestic_task(:'confirm_key',:'successor',1,'confirm');
select pg_temp.ok((select not enabled and stopped_at=:'cancelled_stop'::timestamptz from public.task_reminder_plans where task_id=:'successor') and (select state='cancelled' and completed_at is null and version=5 from public.domestic_tasks where id=:'successor'),'cancel retires permanently; retry confirm cannot revive cancelled occurrence');
-- Confirm also preserves a synthetic enabled plan, not merely the default false.
select public.create_domestic_task(gen_random_uuid(),null,'Confirm enabled fixture','2020-01-01','Europe/Rome','chore',2::smallint,'calendar') parent \gset
select public.act_on_domestic_task(gen_random_uuid(),:'parent',1,'complete');
select id child from public.domestic_tasks where previous_task_id=:'parent' \gset
reset role;
update public.task_reminder_plans set enabled=true where task_id=:'child';
set local role authenticated;
select public.act_on_domestic_task(gen_random_uuid(),:'child',1,'confirm');
select pg_temp.ok((select enabled and stopped_at is null from public.task_reminder_plans where task_id=:'child'),'confirm preserves synthetic enabled plan');
-- Delayed completion differs from calendar cadence: base is the actual intervention.
select public.create_domestic_task(gen_random_uuid(),null,'Late intervention','2000-01-01 09:00','Europe/Rome','maintenance',2::smallint,'after_completion',3,'month') after_task \gset
select public.act_on_domestic_task(gen_random_uuid(),:'after_task',1,'complete');
select pg_temp.ok((select n.due_local=((p.completed_at at time zone p.timezone)+interval '3 months') and n.state='needs_verification' from public.domestic_tasks p join public.domestic_tasks n on n.previous_task_id=p.id where p.id=:'after_task'),'very late after-completion recurrence uses actual completion, not year 2000');
-- Ambiguous dates are deterministic even when the database session uses another zone.
set local timezone='America/New_York';
select public.create_domestic_task(gen_random_uuid(),null,'Autumn ambiguity','2027-10-31 02:30','Europe/Rome','chore',2::smallint,'calendar',1,'year') autumn \gset
select pg_temp.ok((select due_at='2027-10-31 01:30Z'::timestamptz and due_local='2027-10-31 02:30'::timestamp from public.domestic_tasks where id=:'autumn'),'ambiguous creation independent of session zone');
select public.act_on_domestic_task(gen_random_uuid(),:'autumn',1,'complete');
select pg_temp.ok((select due_local='2028-10-31 02:30'::timestamp and due_at='2028-10-31 01:30Z'::timestamptz from public.domestic_tasks where previous_task_id=:'autumn'),'calendar successor preserves local date across autumn offset');
rollback;
