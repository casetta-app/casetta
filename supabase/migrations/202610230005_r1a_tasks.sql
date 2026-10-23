begin;
-- Scope is immutable. Personal tasks are never shared through membership.
create table public.domestic_tasks (
 id uuid primary key default gen_random_uuid(),
 owner_user_id uuid references auth.users(id) on delete cascade,
 home_id uuid references public.homes(id) on delete cascade,
 created_by uuid references auth.users(id) on delete set null,
 title text not null check(length(trim(title)) between 1 and 200),
 kind text not null check(kind in ('appointment','deadline','maintenance','payment','chore','follow_up')),
 importance smallint not null check(importance between 1 and 3),
 state text not null default 'open' check(state in ('open','in_progress','snoozed','completed','cancelled','needs_verification')),
 source text not null default 'user_declared' check(source in ('user_declared','recurrence_rule')),
 timezone text not null,
 due_local timestamp without time zone,
 due_at timestamptz,
 snoozed_until timestamptz,
 recurrence text not null default 'none' check(recurrence in ('none','calendar','after_completion','confirmed_date')),
 interval_count integer not null default 1 check(interval_count between 1 and 120),
 interval_unit text not null default 'month' check(interval_unit in ('day','week','month','year')),
 anchor_local timestamp without time zone,
 occurrence_index integer not null default 0 check(occurrence_index >= 0),
 previous_task_id uuid unique references public.domestic_tasks(id) on delete set null,
 version bigint not null default 1,
 created_at timestamptz not null default now(),
 completed_at timestamptz,
 check((owner_user_id is null) <> (home_id is null)),
 check((due_local is null) = (due_at is null)),
 check(recurrence = 'none' or due_local is not null)
);
create index domestic_tasks_home on public.domestic_tasks(home_id, due_at);
create index domestic_tasks_person on public.domestic_tasks(owner_user_id, due_at);
create table public.task_events (
 id uuid primary key default gen_random_uuid(),
 task_id uuid not null references public.domestic_tasks(id) on delete cascade,
 actor_id uuid references auth.users(id) on delete set null,
 action text not null,
 from_state text,
 to_state text not null,
 version bigint not null,
 occurred_at timestamptz not null default now(),
 unique(task_id,version)
);
-- Foundation only: no delivery worker or notifications claimed active in R1-A.
create table public.task_reminder_plans (
 task_id uuid primary key references public.domestic_tasks(id) on delete cascade,
 enabled boolean not null default false,
 stopped_at timestamptz
);
create table private.task_commands (
 actor_id uuid not null references auth.users(id) on delete cascade,
 key uuid not null,
 signature text not null,
 task_id uuid not null references public.domestic_tasks(id) on delete cascade,
 primary key(actor_id,key)
);
alter table public.domestic_tasks enable row level security;
alter table public.task_events enable row level security;
alter table public.task_reminder_plans enable row level security;
alter table private.task_commands enable row level security;
revoke all on public.domestic_tasks,public.task_events,public.task_reminder_plans,private.task_commands from public,anon,authenticated;
grant select on public.domestic_tasks,public.task_events,public.task_reminder_plans to authenticated;
create policy tasks_read on public.domestic_tasks for select to authenticated using (
 owner_user_id = (select auth.uid()) or private.home_role(home_id) is not null
);
create policy task_events_read on public.task_events for select to authenticated using (
 exists(select 1 from public.domestic_tasks t where t.id=task_id)
);
create policy task_plans_read on public.task_reminder_plans for select to authenticated using (
 exists(select 1 from public.domestic_tasks t where t.id=task_id)
);
create function private.task_access(person uuid, house uuid) returns void
language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null then raise exception 'Authentication required' using errcode='42501'; end if;
 if person is not null then
   if person <> auth.uid() then raise exception 'Private task' using errcode='42501'; end if;
 else
   -- Membership mutations lock the same home: serialize revocation against commands.
   perform 1 from public.homes where id=house for update;
   if not found or coalesce(private.home_role(house),'') not in ('owner','editor') then
     raise exception 'Writer required' using errcode='42501';
   end if;
 end if;
end $$;
create function private.task_instant(local_time timestamp, zone text) returns timestamptz
language plpgsql stable set search_path='' as $$
declare instant timestamptz;
begin
 if local_time is not null and (not isfinite(local_time) or local_time < timestamp '0001-01-01' or local_time >= timestamp '10000-01-01') then
   raise exception 'Date outside supported range' using errcode='22023';
 end if;
 if not exists(select 1 from pg_catalog.pg_timezone_names where name=zone) then
   raise exception 'Invalid timezone' using errcode='22023';
 end if;
 instant := local_time at time zone zone;
 if local_time is not null and instant at time zone zone <> local_time then
   raise exception 'Local time does not exist (DST)' using errcode='22023';
 end if;
 return instant;
end $$;
create function private.task_next_local(anchor timestamp, amount integer, unit text, occurrence integer) returns timestamp
language sql immutable set search_path='' as $$
 select anchor + case unit when 'day' then make_interval(days=>amount*occurrence)
 when 'week' then make_interval(days=>7*amount*occurrence)
 when 'month' then make_interval(months=>amount*occurrence)
 when 'year' then make_interval(years=>amount*occurrence) end
$$;
create function public.create_domestic_task(p_key uuid, p_home uuid, p_title text,
 p_due timestamp default null, p_timezone text default 'Europe/Rome', p_kind text default 'chore',
 p_importance smallint default 2, p_recurrence text default 'none', p_count integer default 1, p_unit text default 'month') returns uuid
language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); result uuid; sig text; prior private.task_commands%rowtype; instant timestamptz;
begin
 perform private.task_access(case when p_home is null then actor else null end,p_home);
 if p_key is null then raise exception 'Key required' using errcode='22023'; end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(actor::text||p_key::text,0));
 sig:=md5(jsonb_build_array('create',p_home,p_title,p_due,p_timezone,p_kind,p_importance,p_recurrence,p_count,p_unit)::text);
 select * into prior from private.task_commands where actor_id=actor and key=p_key;
 if found then
   if sig<>prior.signature then raise exception 'Key reused with different input' using errcode='22023'; end if;
   return prior.task_id;
 end if;
 instant:=private.task_instant(p_due,p_timezone);
 insert into public.domestic_tasks(owner_user_id,home_id,created_by,title,kind,importance,timezone,due_local,due_at,recurrence,interval_count,interval_unit,anchor_local)
 values(case when p_home is null then actor else null end,p_home,actor,trim(p_title),p_kind,p_importance,p_timezone,p_due,instant,p_recurrence,p_count,p_unit,p_due) returning id into result;
 insert into public.task_events(task_id,actor_id,action,to_state,version) values(result,actor,'create','open',1);
 insert into public.task_reminder_plans(task_id) values(result);
 insert into private.task_commands values(actor,p_key,sig,result);
 return result;
exception when unique_violation then
 raise exception 'Concurrent command; retry same key' using errcode='40001';
end $$;
create function public.act_on_domestic_task(p_key uuid,p_task uuid,p_version bigint,p_action text,p_until timestamp default null) returns uuid
language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); t public.domestic_tasks%rowtype; prior private.task_commands%rowtype;
 successor uuid; sig text; next_state text; next_local timestamp; completion timestamptz:=clock_timestamp();
begin
 select * into t from public.domestic_tasks where id=p_task;
 if not found then raise exception 'Task unavailable' using errcode='42501'; end if;
 perform private.task_access(t.owner_user_id,t.home_id);
 if p_key is null then raise exception 'Key required' using errcode='22023'; end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(actor::text||p_key::text,0));
 sig:=md5(jsonb_build_array('act',p_task,p_version,p_action,p_until)::text);
 select * into prior from private.task_commands where actor_id=actor and key=p_key;
 if found then
   if sig<>prior.signature then raise exception 'Key reused with different input' using errcode='22023'; end if;
   return prior.task_id;
 end if;
 select * into t from public.domestic_tasks where id=p_task for update;
 if not found then raise exception 'Task unavailable' using errcode='42501'; end if;
 if t.version<>p_version then raise exception 'Task changed; reload' using errcode='40001'; end if;
 if t.state in ('completed','cancelled') then raise exception 'Task closed' using errcode='22023'; end if;
 next_state:=case p_action when 'complete' then 'completed' when 'cancel' then 'cancelled'
 when 'start' then 'in_progress' when 'confirm' then 'open' when 'snooze' then 'snoozed' end;
 if next_state is null or (t.state='needs_verification' and p_action not in ('confirm','cancel')) then
   raise exception 'Invalid transition' using errcode='22023'; end if;
 if p_action='confirm' and t.state<>'needs_verification' then raise exception 'Already confirmed' using errcode='22023'; end if;
 if p_action='snooze' and (p_until is null or private.task_instant(p_until,t.timezone)<=completion) then
   raise exception 'Future date required' using errcode='22023'; end if;
 update public.domestic_tasks set state=next_state, version=version+1,
 completed_at=case when p_action='complete' then completion end,
 snoozed_until=case when p_action='snooze' then private.task_instant(p_until,t.timezone) end where id=t.id;
 -- Only terminal states retire this occurrence's plan. start/confirm preserve it;
 -- snooze defers attention through domestic_tasks.snoozed_until, not stopped_at.
 -- No transition activates a plan: R1-A has no notification delivery worker.
 if p_action in ('complete','cancel') then
   update public.task_reminder_plans set enabled=false,stopped_at=completion where task_id=t.id;
 end if;
 insert into public.task_events(task_id,actor_id,action,from_state,to_state,version) values(t.id,actor,p_action,t.state,next_state,t.version+1);
 if p_action='complete' and t.recurrence in ('calendar','after_completion') then
   next_local:=private.task_next_local(case when t.recurrence='calendar' then t.anchor_local else completion at time zone t.timezone end,
     t.interval_count,t.interval_unit,case when t.recurrence='calendar' then t.occurrence_index+1 else 1 end);
   -- Gap at DST: move to first matching PostgreSQL local time, explicitly unconfirmed.
   next_local:=(next_local at time zone t.timezone) at time zone t.timezone;
   insert into public.domestic_tasks(owner_user_id,home_id,created_by,title,kind,importance,state,source,timezone,due_local,due_at,
     recurrence,interval_count,interval_unit,anchor_local,occurrence_index,previous_task_id)
   values(t.owner_user_id,t.home_id,actor,t.title,t.kind,t.importance,'needs_verification','recurrence_rule',t.timezone,next_local,
     next_local at time zone t.timezone,t.recurrence,t.interval_count,t.interval_unit,t.anchor_local,t.occurrence_index+1,t.id) returning id into successor;
   insert into public.task_events(task_id,actor_id,action,to_state,version) values(successor,actor,'recurrence','needs_verification',1);
   insert into public.task_reminder_plans(task_id) values(successor);
 end if;
 insert into private.task_commands values(actor,p_key,sig,t.id);
 return t.id;
exception when unique_violation then
 raise exception 'Concurrent command; retry same key' using errcode='40001';
end $$;
revoke all on function private.task_access(uuid,uuid),private.task_instant(timestamp,text),private.task_next_local(timestamp,integer,text,integer) from public,anon,authenticated;
revoke all on function public.create_domestic_task(uuid,uuid,text,timestamp,text,text,smallint,text,integer,text),public.act_on_domestic_task(uuid,uuid,bigint,text,timestamp) from public,anon,authenticated;
grant execute on function public.create_domestic_task(uuid,uuid,text,timestamp,text,text,smallint,text,integer,text),public.act_on_domestic_task(uuid,uuid,bigint,text,timestamp) to authenticated;
commit;
