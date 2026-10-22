begin;
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;
grant usage on schema private to authenticated;

create table public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null default '' check (char_length(display_name) <= 80),
  created_at timestamptz not null default now()
);
create table public.homes (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 1 and 80),
  -- L'autore storico non è il proprietario attuale e non deve trattenere l'account.
  created_by uuid references auth.users(id) on delete set null,
  request_id uuid not null,
  -- Scritta dai trigger per serializzare le membership anche con snapshot ripetibili.
  membership_version bigint not null default 0,
  created_at timestamptz not null default now(),
  unique(created_by, request_id)
);
create table public.home_members (
  home_id uuid not null references public.homes(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('owner', 'editor', 'viewer')),
  relationship text not null default 'resident' check (relationship in ('resident', 'guest')),
  joined_at timestamptz not null default now(),
  revoked_at timestamptz,
  -- La futura accettazione inviti dovrà confrontare questa versione: un invito
  -- emesso prima di una revoca/modifica non può ripristinare il vecchio accesso.
  access_version bigint not null default 1 check (access_version > 0),
  primary key(home_id, user_id)
);
create index home_members_user on public.home_members(user_id, home_id) where revoked_at is null;

create function private.home_role(target uuid) returns text
language sql stable security definer set search_path = '' as $$
  select m.role from public.home_members m
  where m.home_id = target and m.user_id = (select auth.uid()) and m.revoked_at is null
$$;
revoke all on function private.home_role(uuid) from public, anon, authenticated;
grant execute on function private.home_role(uuid) to authenticated;

alter table public.profiles enable row level security;
alter table public.homes enable row level security;
alter table public.home_members enable row level security;
revoke all on public.profiles, public.homes, public.home_members from public, anon, authenticated;
grant select on public.profiles, public.homes, public.home_members to authenticated;
grant update(display_name) on public.profiles to authenticated;
create policy profile_read on public.profiles for select to authenticated using (user_id = (select auth.uid()));
create policy profile_update on public.profiles for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy homes_read on public.homes for select to authenticated using (private.home_role(id) is not null);
create policy members_read on public.home_members for select to authenticated
  using (private.home_role(home_id) is not null and revoked_at is null);

create function private.create_profile() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles(user_id) values (new.id);
  return new;
end $$;
revoke all on function private.create_profile() from public, anon, authenticated;
create trigger auth_user_profile after insert on auth.users for each row execute function private.create_profile();
insert into public.profiles(user_id) select id from auth.users on conflict do nothing;

-- L'eliminazione Auth (solo amministrativa) blocca le case coinvolte in ordine stabile.
-- I cascades successivi sono nella stessa transazione; se resta una casa senza owner
-- il trigger membership annulla TUTTA la cancellazione, profilo e SET NULL inclusi.
create function private.prepare_user_deletion() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform h.id from public.homes h
    where h.created_by = old.id or exists (
      select 1 from public.home_members m where m.home_id = h.id and m.user_id = old.id
    ) order by h.id for update;
  return old;
end $$;
revoke all on function private.prepare_user_deletion() from public, anon, authenticated;
create trigger auth_user_prepare_deletion before delete on auth.users
  for each row execute function private.prepare_user_deletion();

-- Il controllo riguarda case ANCORA ESISTENTI. Durante DELETE homes la riga padre
-- non esiste più nella transazione: il cascade può rimuovere anche l'ultimo owner.
-- Non esistono flag di sessione o parametri client per saltare questa verifica.
create function private.protect_last_owner() returns trigger
language plpgsql security definer set search_path = '' as $$
declare target uuid;
begin
  if tg_op = 'UPDATE' and (new.home_id <> old.home_id or new.user_id <> old.user_id) then
    raise exception 'Membership identity is immutable' using errcode = '23514';
  end if;
  if tg_op = 'INSERT' then
    target := new.home_id;
    new.access_version := 1;
  else
    target := old.home_id;
    if tg_op = 'UPDATE' then new.access_version := old.access_version + 1; end if;
  end if;
  -- Un UPDATE reale rende concorrenti gli accessi anche a REPEATABLE READ:
  -- chi ha uno snapshot precedente riceve 40001 invece di contare vecchi owner.
  update public.homes set membership_version = membership_version + 1 where id = target;
  if not found then
    if tg_op = 'DELETE' then return old; end if;
    raise exception 'Home not found' using errcode = '23503';
  end if;
  if tg_op <> 'INSERT' and old.role = 'owner' and old.revoked_at is null then
    if tg_op = 'DELETE' or new.role <> 'owner' or new.revoked_at is not null then
      if not exists (select 1 from public.home_members where home_id = old.home_id
        and user_id <> old.user_id and role = 'owner' and revoked_at is null) then
        raise exception 'Cannot remove the last owner' using errcode = '23514';
      end if;
    end if;
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end $$;
revoke all on function private.protect_last_owner() from public, anon, authenticated;
create trigger protect_last_owner before insert or update or delete on public.home_members
  for each row execute function private.protect_last_owner();

-- Usata solo dalle RPC privilegiate: autorizzazione prima e dopo l'attesa sul lock.
create function private.require_home_owner(target uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null or private.home_role(target) is distinct from 'owner' then
    raise exception 'Owner required' using errcode = '42501';
  end if;
  perform 1 from public.homes where id = target for update;
  if not found or private.home_role(target) is distinct from 'owner' then
    raise exception 'Owner required' using errcode = '42501';
  end if;
end $$;
revoke all on function private.require_home_owner(uuid) from public, anon, authenticated;

create function public.create_home(home_name text, creation_key uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare actor uuid := auth.uid(); result uuid;
begin
  if actor is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  if creation_key is null or home_name is null or char_length(btrim(home_name)) not between 1 and 80 then
    raise exception 'Invalid home name or creation key' using errcode = '22023';
  end if;
  insert into public.homes(name, created_by, request_id) values (btrim(home_name), actor, creation_key)
    on conflict (created_by, request_id) do nothing returning id into result;
  if result is not null then
    insert into public.home_members(home_id, user_id, role) values (result, actor, 'owner');
  else
    select id into result from public.homes where created_by = actor and request_id = creation_key;
    if private.home_role(result) is distinct from 'owner' then
      raise exception 'Creation no longer accessible' using errcode = '42501';
    end if;
  end if;
  return result;
end $$;
-- Solo membership già esistenti: nessuna API per aggiungere persone prima degli inviti M4.
create function public.manage_home_member(target_home uuid, target_user uuid, new_role text, revoke_access boolean default false)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_home_owner(target_home);
  if new_role is null or new_role not in ('owner', 'editor', 'viewer') or revoke_access is null then
    raise exception 'Invalid role' using errcode = '22023';
  end if;
  update public.home_members set role = new_role,
    revoked_at = case when revoke_access then now() else null end
    where home_id = target_home and user_id = target_user and revoked_at is null;
  if not found then raise exception 'Active member not found' using errcode = '22023'; end if;
end $$;
revoke all on function public.create_home(text, uuid), public.manage_home_member(uuid, uuid, text, boolean) from public, anon, authenticated;
grant execute on function public.create_home(text, uuid), public.manage_home_member(uuid, uuid, text, boolean) to authenticated;

-- Trasferimento a un membro ATTIVO: promuove prima il destinatario, poi rende
-- editor il chiamante. Entrambe le modifiche devono riuscire nella stessa transazione.
create function public.transfer_home_ownership(target_home uuid, target_user uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_home_owner(target_home);
  if target_user is null or target_user = auth.uid() then
    raise exception 'Another active member is required' using errcode = '22023';
  end if;
  update public.home_members set role = 'owner'
    where home_id = target_home and user_id = target_user and revoked_at is null;
  if not found then
    raise exception 'Active member not found' using errcode = '22023';
  end if;
  update public.home_members set role = 'editor'
    where home_id = target_home and user_id = auth.uid() and revoked_at is null;
end $$;

-- L'owner può eliminare intenzionalmente l'intera casa, anche se è l'unico owner.
-- Le membership vengono eliminate dalla FK nella stessa transazione.
create function public.delete_home(target_home uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_home_owner(target_home);
  delete from public.homes where id = target_home;
end $$;
revoke all on function public.transfer_home_ownership(uuid, uuid), public.delete_home(uuid) from public, anon, authenticated;
grant execute on function public.transfer_home_ownership(uuid, uuid), public.delete_home(uuid) to authenticated;
commit;
