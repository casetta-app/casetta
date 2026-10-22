begin;

-- Solo oggetti nuovi: nessuna modifica o inizializzazione dei dati M0.
create domain public.inventory_quantity as numeric
  check (value >= 0 and value < 1000000000000 and scale(trim_scale(value)) <= 6);
revoke all on type public.inventory_quantity from public, anon, authenticated;
grant usage on type public.inventory_quantity to authenticated;

create table public.products (
  id uuid primary key default gen_random_uuid(),
  scope_home_id uuid references public.homes(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 160),
  brand text check (char_length(brand) <= 120),
  category text not null default 'food' check (category in ('food', 'household', 'other')),
  source text not null default 'manual' check (source in ('manual', 'external')),
  source_ref text check (char_length(source_ref) <= 300),
  created_at timestamptz not null default now()
);
create index products_home on public.products(scope_home_id);

-- Un barcode identifica il formato, mai la quantità posseduta. Gli zeri iniziali restano.
create table public.product_formats (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete cascade,
  label text not null check (char_length(btrim(label)) between 1 and 120),
  kind text not null check (kind in ('packaged', 'loose', 'piece')),
  barcode text check (barcode ~ '^([0-9]{8}|[0-9]{12}|[0-9]{13}|[0-9]{14})$'),
  size_quantity public.inventory_quantity check (size_quantity > 0),
  size_unit text check (size_unit in ('g', 'kg', 'ml', 'l', 'piece')),
  created_at timestamptz not null default now(),
  check ((size_quantity is null) = (size_unit is null)),
  check (size_unit <> 'piece' or size_quantity = trunc(size_quantity)),
  unique(product_id, barcode)
);
create index product_formats_barcode on public.product_formats(barcode) where barcode is not null;

create table public.storage_locations (
  id uuid primary key default gen_random_uuid(),
  home_id uuid not null references public.homes(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 80),
  created_at timestamptz not null default now(),
  unique(home_id, id)
);
create table public.home_products (
  id uuid primary key default gen_random_uuid(),
  home_id uuid not null references public.homes(id) on delete cascade,
  format_id uuid not null references public.product_formats(id) deferrable initially deferred,
  alias text check (char_length(alias) <= 160),
  created_at timestamptz not null default now(),
  unique(home_id, id),
  unique(home_id, format_id)
);
create index home_products_format on public.home_products(format_id);

-- Una riga = lotto omogeneo per formato, posizione, scadenza e stato confezione.
create table public.stock_entries (
  id uuid primary key default gen_random_uuid(),
  home_id uuid not null references public.homes(id) on delete cascade,
  home_product_id uuid not null,
  location_id uuid,
  mode text not null check (mode in ('count', 'measure', 'level', 'unknown')),
  quantity public.inventory_quantity,
  unit text check (unit in ('pack', 'piece', 'g', 'kg', 'ml', 'l')),
  level text check (level in ('available', 'low', 'empty')),
  certainty text not null check (certainty in ('confirmed', 'estimated', 'unknown')),
  package_state text not null default 'unspecified' check (package_state in ('sealed', 'open', 'unspecified')),
  -- Contenitori osservati, distinto dal contenuto numerico/indicativo della riga.
  package_count integer check (package_count >= 0),
  expires_on date check (expires_on is null or isfinite(expires_on)),
  last_verified_at timestamptz,
  version bigint not null default 1 check (version > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(home_id, id),
  foreign key(home_id, home_product_id) references public.home_products(home_id, id) deferrable initially deferred,
  foreign key(home_id, location_id) references public.storage_locations(home_id, id) deferrable initially deferred,
  constraint stock_state_shape check ((
    (mode = 'unknown' and quantity is null and unit is null and level is null and certainty = 'unknown')
    or (mode = 'count' and quantity is not null and quantity = trunc(quantity) and unit in ('pack', 'piece') and level is null and certainty in ('confirmed', 'estimated'))
    or (mode = 'measure' and quantity is not null and unit in ('g', 'kg', 'ml', 'l') and level is null and certainty in ('confirmed', 'estimated'))
    or (mode = 'level' and quantity is null and unit is null and level is not null and certainty in ('confirmed', 'estimated'))
  ) is true),
  check ((certainty = 'confirmed' and last_verified_at is not null) or (certainty <> 'confirmed' and last_verified_at is null)),
  check (package_count is null or (mode <> 'count' and package_state in ('sealed', 'open'))),
  check (package_count is null or package_count > 0 or (mode = 'level' and level = 'empty') or (mode = 'measure' and quantity = 0))
);
create index stock_entries_product on public.stock_entries(home_id, home_product_id);
create index stock_entries_location on public.stock_entries(home_id, location_id) where location_id is not null;

create table public.stock_movements (
  id uuid primary key default gen_random_uuid(),
  home_id uuid not null references public.homes(id) on delete cascade,
  entry_id uuid not null,
  related_entry_id uuid,
  actor_user_id uuid references auth.users(id) on delete set null,
  kind text not null check (kind in ('purchase', 'consume', 'correction', 'open', 'move', 'discard')),
  idempotency_key uuid not null,
  request jsonb not null check (jsonb_typeof(request) = 'object'),
  before_state jsonb not null check (jsonb_typeof(before_state) = 'array'),
  after_state jsonb not null check (jsonb_typeof(after_state) = 'array'),
  note text check (char_length(note) <= 500),
  created_at timestamptz not null default now(),
  constraint stock_movement_request_unique unique(home_id, idempotency_key),
  foreign key(home_id, entry_id) references public.stock_entries(home_id, id) deferrable initially deferred,
  foreign key(home_id, related_entry_id) references public.stock_entries(home_id, id) deferrable initially deferred
);
create index stock_movements_entry on public.stock_movements(home_id, entry_id, created_at);
create index stock_movements_actor on public.stock_movements(actor_user_id) where actor_user_id is not null;

-- Serializza con revoche/trasferimenti M0: il ruolo viene ricontrollato dopo l'attesa.
create function private.require_inventory_writer(target uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null or coalesce(private.home_role(target), '') not in ('owner', 'editor') then
    raise exception 'Inventory write denied' using errcode = '42501';
  end if;
  perform 1 from public.homes where id = target for update;
  if not found or coalesce(private.home_role(target), '') not in ('owner', 'editor') then
    raise exception 'Inventory write denied' using errcode = '42501';
  end if;
end $$;
revoke all on function private.require_inventory_writer(uuid) from public, anon, authenticated;

create function private.guard_home_product() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'UPDATE' and (new.id <> old.id or new.home_id <> old.home_id or new.format_id <> old.format_id) then
    raise exception 'Home product identity is immutable' using errcode = '23514';
  end if;
  perform private.require_inventory_writer(new.home_id);
  if not exists (select 1 from public.product_formats f join public.products p on p.id = f.product_id
    where f.id = new.format_id and (p.scope_home_id is null or p.scope_home_id = new.home_id)) then
    raise exception 'Format not available for this home' using errcode = '23514';
  end if;
  return new;
end $$;
revoke all on function private.guard_home_product() from public, anon, authenticated;
create trigger guard_home_product before insert or update on public.home_products
  for each row execute function private.guard_home_product();

-- La stessa serializzazione vale per il catalogo privato e le posizioni.
create function private.guard_inventory_metadata() returns trigger
language plpgsql security definer set search_path = '' as $$
declare target uuid;
begin
  if tg_op = 'UPDATE' and (
    new.id <> old.id or (to_jsonb(new)->'home_id') is distinct from (to_jsonb(old)->'home_id')
    or (to_jsonb(new)->'scope_home_id') is distinct from (to_jsonb(old)->'scope_home_id')
    or (tg_table_name = 'product_formats' and (to_jsonb(new) - 'label') <> (to_jsonb(old) - 'label'))
  ) then raise exception 'Catalog identity or scope is immutable' using errcode = '23514'; end if;
  if tg_table_name = 'products' then target := (to_jsonb(new)->>'scope_home_id')::uuid;
  elsif tg_table_name = 'product_formats' then
    select p.scope_home_id into target from public.products p where p.id = new.product_id;
    if not found then raise exception 'Product not available' using errcode = '23514'; end if;
  else target := (to_jsonb(new)->>'home_id')::uuid;
  end if;
  if target is not null then perform private.require_inventory_writer(target); end if;
  return new;
end $$;
revoke all on function private.guard_inventory_metadata() from public, anon, authenticated;
create trigger guard_products before insert or update on public.products for each row execute function private.guard_inventory_metadata();
create trigger guard_formats before insert or update on public.product_formats for each row execute function private.guard_inventory_metadata();
create trigger guard_locations before insert or update on public.storage_locations for each row execute function private.guard_inventory_metadata();

-- Anche i vincoli tra tabelle vengono controllati senza ricorsione RLS.
create function private.guard_stock_entry() returns trigger
language plpgsql security definer set search_path = '' as $$
declare format_kind text; format_unit text;
begin
  if tg_op = 'UPDATE' and (new.home_id <> old.home_id or new.home_product_id <> old.home_product_id or new.id <> old.id) then
    raise exception 'Stock identity is immutable' using errcode = '23514';
  end if;
  select f.kind, f.size_unit into format_kind, format_unit from public.home_products hp join public.product_formats f on f.id = hp.format_id
    join public.products p on p.id = f.product_id
    where hp.home_id = new.home_id and hp.id = new.home_product_id
      and (p.scope_home_id is null or p.scope_home_id = new.home_id);
  if not found then raise exception 'Invalid home product' using errcode = '23514'; end if;
  if (new.package_state <> 'unspecified' or new.unit = 'pack') and format_kind <> 'packaged' then
    raise exception 'Packaging requires a packaged format' using errcode = '23514';
  end if;
  if new.mode = 'measure' and (
    (format_unit in ('g','kg') and new.unit not in ('g','kg'))
    or (format_unit in ('ml','l') and new.unit not in ('ml','l'))
  ) then raise exception 'Measurement dimension differs from format' using errcode = '23514'; end if;
  if new.location_id is not null and not exists (select 1 from public.storage_locations where home_id = new.home_id and id = new.location_id) then
    raise exception 'Location not available for this home' using errcode = '23514';
  end if;
  if tg_op = 'UPDATE' then new.version := old.version + 1; new.updated_at := clock_timestamp(); end if;
  return new;
end $$;
revoke all on function private.guard_stock_entry() from public, anon, authenticated;
create trigger guard_stock_entry before insert or update on public.stock_entries
  for each row execute function private.guard_stock_entry();

-- Append-only, salvo cancellazione esplicita della casa e anonimizzazione FK Auth.
create function private.guard_stock_history() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'DELETE' and not exists (select 1 from public.homes where id = old.home_id) then return old; end if;
  if tg_op = 'UPDATE' and old.actor_user_id is not null and new.actor_user_id is null
    and not exists (select 1 from auth.users where id = old.actor_user_id)
    and (to_jsonb(new) - 'actor_user_id') = (to_jsonb(old) - 'actor_user_id') then return new; end if;
  raise exception 'Stock history is append-only' using errcode = '55000';
end $$;
revoke all on function private.guard_stock_history() from public, anon, authenticated;
create trigger guard_stock_history before update or delete on public.stock_movements
  for each row execute function private.guard_stock_history();

-- Catalogo comune leggibile ma non modificabile dai client. Prodotti privati per casa.
alter table public.products enable row level security;
alter table public.product_formats enable row level security;
alter table public.storage_locations enable row level security;
alter table public.home_products enable row level security;
alter table public.stock_entries enable row level security;
alter table public.stock_movements enable row level security;
revoke all on public.products, public.product_formats, public.storage_locations, public.home_products, public.stock_entries, public.stock_movements from public, anon, authenticated;
grant select on public.products, public.product_formats, public.storage_locations, public.home_products, public.stock_entries, public.stock_movements to authenticated;
grant insert(scope_home_id, name, brand, category) on public.products to authenticated;
grant update(name, brand, category) on public.products to authenticated;
grant insert(product_id, label, kind, barcode, size_quantity, size_unit) on public.product_formats to authenticated;
grant update(label) on public.product_formats to authenticated;
grant insert(home_id, name) on public.storage_locations to authenticated;
grant update(name) on public.storage_locations to authenticated;
grant insert(home_id, format_id, alias) on public.home_products to authenticated;
grant update(alias) on public.home_products to authenticated;

create policy products_read on public.products for select to authenticated
  using (scope_home_id is null or private.home_role(scope_home_id) is not null);
create policy products_insert on public.products for insert to authenticated
  with check (scope_home_id is not null and private.home_role(scope_home_id) in ('owner', 'editor'));
create policy products_update on public.products for update to authenticated
  using (scope_home_id is not null and private.home_role(scope_home_id) in ('owner', 'editor'))
  with check (scope_home_id is not null and private.home_role(scope_home_id) in ('owner', 'editor'));
create policy formats_read on public.product_formats for select to authenticated
  using (exists (select 1 from public.products p where p.id = product_id));
create policy formats_insert on public.product_formats for insert to authenticated
  with check (exists (select 1 from public.products p where p.id = product_id and p.scope_home_id is not null and private.home_role(p.scope_home_id) in ('owner', 'editor')));
create policy formats_update on public.product_formats for update to authenticated
  using (exists (select 1 from public.products p where p.id = product_id and p.scope_home_id is not null and private.home_role(p.scope_home_id) in ('owner', 'editor')))
  with check (exists (select 1 from public.products p where p.id = product_id and p.scope_home_id is not null and private.home_role(p.scope_home_id) in ('owner', 'editor')));
create policy locations_read on public.storage_locations for select to authenticated using (private.home_role(home_id) is not null);
create policy locations_insert on public.storage_locations for insert to authenticated with check (private.home_role(home_id) in ('owner', 'editor'));
create policy locations_update on public.storage_locations for update to authenticated using (private.home_role(home_id) in ('owner', 'editor')) with check (private.home_role(home_id) in ('owner', 'editor'));
create policy home_products_read on public.home_products for select to authenticated using (private.home_role(home_id) is not null);
create policy home_products_insert on public.home_products for insert to authenticated with check (private.home_role(home_id) in ('owner', 'editor'));
create policy home_products_update on public.home_products for update to authenticated using (private.home_role(home_id) in ('owner', 'editor')) with check (private.home_role(home_id) in ('owner', 'editor'));
create policy stock_entries_read on public.stock_entries for select to authenticated using (private.home_role(home_id) is not null);
create policy stock_movements_read on public.stock_movements for select to authenticated using (private.home_role(home_id) is not null);

-- Snapshot con decimali come stringhe: nessuna perdita di precisione nei futuri client JS.
create function private.stock_snapshot(entry public.stock_entries) returns jsonb
language sql immutable set search_path = '' as $$
  select to_jsonb(entry) || jsonb_build_object('quantity', entry.quantity::text)
$$;
revoke all on function private.stock_snapshot(public.stock_entries) from public, anon, authenticated;

-- Sostituisce solo i campi di stato; identità, autore, versioni e timestamp non vengono dal client.
create function private.stock_from_state(original public.stock_entries, state jsonb) returns public.stock_entries
language plpgsql set search_path = '' as $$
declare result public.stock_entries := original;
begin
  if state is null or jsonb_typeof(state) <> 'object' or exists (
    select 1 from jsonb_object_keys(state) k where k not in ('mode','quantity','unit','level','certainty','package_state','package_count','location_id','expires_on')
  ) then raise exception 'Invalid stock state fields' using errcode = '22023'; end if;
  result.mode := state->>'mode';
  result.quantity := (state->>'quantity')::public.inventory_quantity;
  result.unit := state->>'unit';
  result.level := state->>'level';
  result.certainty := state->>'certainty';
  result.package_state := coalesce(state->>'package_state', 'unspecified');
  result.package_count := (state->>'package_count')::integer;
  result.location_id := (state->>'location_id')::uuid;
  result.expires_on := (state->>'expires_on')::date;
  result.last_verified_at := case when result.certainty = 'confirmed' then clock_timestamp() else null end;
  return result;
end $$;
revoke all on function private.stock_from_state(public.stock_entries, jsonb) from public, anon, authenticated;

create function public.record_stock_movement(
  p_home_id uuid, p_key uuid, p_kind text,
  p_entry_id uuid default null, p_home_product_id uuid default null,
  p_state jsonb default null, p_amount numeric default null,
  p_location_id uuid default null, p_expected_version bigint default null,
  p_note text default null, p_unit text default null
) returns uuid language plpgsql security definer set search_path = '' as $$
declare
  current_entry public.stock_entries;
  next_entry public.stock_entries;
  opened_entry public.stock_entries;
  previous public.stock_movements;
  payload jsonb;
  before_rows jsonb := '[]';
  after_rows jsonb;
  movement_id uuid;
  conflicted_constraint text;
begin
  perform private.require_inventory_writer(p_home_id);
  if p_key is null or p_kind is null or p_kind not in ('purchase','consume','correction','open','move','discard')
    or char_length(p_note) > 500 then raise exception 'Invalid movement' using errcode = '22023'; end if;
  payload := jsonb_build_object('kind',p_kind,'entry_id',p_entry_id,'home_product_id',p_home_product_id,
    'state',p_state,'amount',p_amount,'location_id',p_location_id,'expected_version',p_expected_version,'note',p_note,'unit',p_unit);
  select * into previous from public.stock_movements where home_id = p_home_id and idempotency_key = p_key;
  if found then
    if previous.actor_user_id is distinct from auth.uid() or previous.request <> payload then
      raise exception 'Idempotency key already used for another request' using errcode = '22023';
    end if;
    return previous.id;
  end if;
  if p_amount is not null then
    perform p_amount::public.inventory_quantity;
    if p_amount <= 0 then raise exception 'Positive amount required' using errcode = '22023'; end if;
  end if;
  if p_entry_id is null then
    if p_kind not in ('correction','purchase') or p_home_product_id is null or p_amount is not null
      or p_location_id is not null or p_expected_version is not null or p_unit is not null then
      raise exception 'New entry requires a complete state' using errcode = '22023';
    end if;
    next_entry.id := gen_random_uuid(); next_entry.home_id := p_home_id; next_entry.home_product_id := p_home_product_id;
    next_entry.version := 1; next_entry.created_at := clock_timestamp(); next_entry.updated_at := next_entry.created_at;
    next_entry := private.stock_from_state(next_entry, p_state);
    if p_kind = 'purchase' and (next_entry.certainty is distinct from 'confirmed'
      or (next_entry.mode in ('count','measure') and coalesce(next_entry.quantity,0) <= 0)
      or (next_entry.mode = 'level' and next_entry.level is distinct from 'available')
      or next_entry.mode = 'unknown') then raise exception 'Purchase requires known incoming stock' using errcode = '22023'; end if;
    insert into public.stock_entries select (next_entry).* returning * into next_entry;
  else
    if p_home_product_id is not null then raise exception 'Cannot change home product' using errcode = '22023'; end if;
    select * into current_entry from public.stock_entries where home_id = p_home_id and id = p_entry_id for update;
    if not found then raise exception 'Stock entry not available' using errcode = '42501'; end if;
    if p_expected_version is not null and p_expected_version <> current_entry.version then
      raise exception 'Stock version conflict' using errcode = '40001';
    end if;
    before_rows := jsonb_build_array(private.stock_snapshot(current_entry));
    next_entry := current_entry;
    if p_kind = 'correction' then
      if p_expected_version is null or p_amount is not null or p_location_id is not null or p_unit is not null then
        raise exception 'Correction requires current version and complete state' using errcode = '22023';
      end if;
      next_entry := private.stock_from_state(current_entry, p_state);
    elsif p_kind = 'consume' and current_entry.mode = 'level' and current_entry.certainty = 'confirmed' then
        if p_amount is not null or p_location_id is not null or p_unit is not null or p_state is null or jsonb_typeof(p_state) <> 'object'
          or exists (select 1 from jsonb_object_keys(p_state) k where k <> 'level')
          or coalesce(p_state->>'level','') not in ('low','empty')
          or current_entry.level = 'empty' or (current_entry.level = 'low' and p_state->>'level' <> 'empty') then
          raise exception 'Indicative consumption must reduce availability' using errcode = '22023';
        end if;
        next_entry.level := p_state->>'level'; next_entry.last_verified_at := clock_timestamp();
    else
      if p_state is not null then raise exception 'Unexpected state' using errcode = '22023'; end if;
      if p_kind = 'move' then
        if p_amount is not null or p_unit is not null then raise exception 'Move transfers the whole entry' using errcode = '22023'; end if;
        next_entry.location_id := p_location_id;
      else
        if p_location_id is not null then raise exception 'Unexpected location' using errcode = '22023'; end if;
        if p_kind = 'discard' and current_entry.mode in ('unknown','level') and p_amount is null and p_unit is null then
          next_entry.mode := 'level'; next_entry.quantity := null; next_entry.unit := null; next_entry.certainty := 'confirmed'; next_entry.level := 'empty';
          if next_entry.package_count is not null then next_entry.package_count := 0; end if;
        else
          if current_entry.mode not in ('count','measure') or current_entry.certainty <> 'confirmed' or p_amount is null then
            raise exception 'Numeric operation requires confirmed quantity' using errcode = '22023';
          end if;
          if p_unit is null or p_unit is distinct from current_entry.unit then
            raise exception 'Stock unit changed or not specified' using errcode = '22023';
          end if;
          if current_entry.mode = 'count' and p_amount <> trunc(p_amount) then
            raise exception 'Fractional package or piece count' using errcode = '22023';
          end if;
          if p_kind = 'purchase' then
            next_entry.quantity := current_entry.quantity + p_amount;
          else
            if p_amount > current_entry.quantity then raise exception 'Insufficient confirmed stock' using errcode = '23514'; end if;
            next_entry.quantity := current_entry.quantity - p_amount;
            if p_kind = 'open' then
              if current_entry.mode <> 'count' or current_entry.unit <> 'pack' or current_entry.package_state <> 'sealed' then
                raise exception 'Opening requires confirmed sealed packages' using errcode = '22023';
              end if;
              opened_entry := current_entry; opened_entry.id := gen_random_uuid(); opened_entry.mode := 'level';
              opened_entry.quantity := null; opened_entry.unit := null; opened_entry.level := 'available';
              opened_entry.package_state := 'open'; opened_entry.package_count := p_amount::integer;
              opened_entry.version := 1; opened_entry.created_at := clock_timestamp(); opened_entry.updated_at := opened_entry.created_at; opened_entry.last_verified_at := opened_entry.created_at;
              insert into public.stock_entries select (opened_entry).* returning * into opened_entry;
            end if;
          end if;
        end if;
        next_entry.last_verified_at := clock_timestamp();
      end if;
    end if;
    update public.stock_entries set location_id = next_entry.location_id, mode = next_entry.mode,
      quantity = next_entry.quantity, unit = next_entry.unit, level = next_entry.level, certainty = next_entry.certainty,
      package_state = next_entry.package_state, package_count = next_entry.package_count, expires_on = next_entry.expires_on,
      last_verified_at = next_entry.last_verified_at where id = current_entry.id returning * into next_entry;
  end if;
  after_rows := jsonb_build_array(private.stock_snapshot(next_entry));
  if opened_entry.id is not null then after_rows := after_rows || jsonb_build_array(private.stock_snapshot(opened_entry)); end if;
  insert into public.stock_movements(home_id, entry_id, related_entry_id, actor_user_id, kind, idempotency_key, request, before_state, after_state, note)
    values (p_home_id, next_entry.id, opened_entry.id, auth.uid(), p_kind, p_key, payload, before_rows, after_rows, p_note)
    returning id into movement_id;
  return movement_id;
exception when unique_violation then
  get stacked diagnostics conflicted_constraint = constraint_name;
  if conflicted_constraint = 'stock_movement_request_unique' then
    -- Snapshot ripetibili possono non vedere il primo INSERT dopo l'attesa:
    -- tutte le scritture della funzione sono annullate prima del retry.
    raise exception 'Concurrent movement request; retry transaction' using errcode = '40001';
  end if;
  raise;
end $$;
revoke all on function public.record_stock_movement(uuid, uuid, text, uuid, uuid, jsonb, numeric, uuid, bigint, text, text) from public, anon, authenticated;
grant execute on function public.record_stock_movement(uuid, uuid, text, uuid, uuid, jsonb, numeric, uuid, bigint, text, text) to authenticated;
commit;
