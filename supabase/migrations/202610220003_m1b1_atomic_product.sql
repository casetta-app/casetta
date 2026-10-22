begin;

-- Registro privato dell'intera richiesta, inclusi esiti senza nuovo movimento.
create table private.inventory_add_requests (
  home_id uuid not null references public.homes(id) on delete cascade,
  request_key uuid not null,
  actor_id uuid references auth.users(id) on delete set null,
  payload jsonb not null,
  result jsonb not null,
  primary key(home_id, request_key)
);
alter table private.inventory_add_requests enable row level security;
revoke all on private.inventory_add_requests from public, anon, authenticated;

create function public.add_inventory_product(
  p_home_id uuid, p_key uuid, p_initial_state jsonb,
  p_format_id uuid default null, p_product jsonb default null
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  prior private.inventory_add_requests;
  payload jsonb;
  result jsonb;
  product_id uuid;
  target_format uuid := p_format_id;
  hp_id uuid;
  movement_id uuid;
  created boolean := false;
  scope_id uuid;
begin
  -- Controllo anche sui retry, prima di leggere qualsiasi esito privato.
  perform private.require_inventory_writer(p_home_id);
  if p_key is null or (p_format_id is null) = (p_product is null)
    or p_initial_state is null or jsonb_typeof(p_initial_state) <> 'object'
    or exists (select 1 from jsonb_object_keys(p_initial_state) k
      where k not in ('mode','quantity','unit','level','certainty','package_state','package_count','location_id','expires_on')) then
    raise exception 'Invalid inventory addition' using errcode = '22023';
  end if;
  payload := jsonb_build_object('format_id',p_format_id,'product',p_product,'state',p_initial_state);
  select * into prior from private.inventory_add_requests where home_id=p_home_id and request_key=p_key;
  if found then
    if prior.actor_id is distinct from auth.uid() or prior.payload <> payload then
      raise exception 'Addition key already used for another request' using errcode = '22023';
    end if;
    return prior.result;
  end if;

  if p_product is not null then
    if jsonb_typeof(p_product) <> 'object' or exists (
      select 1 from jsonb_object_keys(p_product) k where k not in
        ('name','brand','category','label','kind','barcode','size_quantity','size_unit')
    ) then raise exception 'Invalid product fields' using errcode = '22023'; end if;
    insert into public.products(scope_home_id,name,brand,category)
      values(p_home_id,btrim(p_product->>'name'),nullif(btrim(p_product->>'brand'),''),coalesce(p_product->>'category','food')) returning id into product_id;
    insert into public.product_formats(product_id,label,kind,barcode,size_quantity,size_unit)
      values(product_id,btrim(p_product->>'label'),p_product->>'kind',nullif(p_product->>'barcode',''),
        nullif(p_product->>'size_quantity','')::public.inventory_quantity,nullif(p_product->>'size_unit','')) returning id into target_format;
  else
    -- Il proprietario della funzione non deve eludere la visibilità RLS del catalogo.
    select p.scope_home_id into scope_id from public.product_formats f
      join public.products p on p.id=f.product_id where f.id=p_format_id;
    if not found or (scope_id is not null and scope_id <> p_home_id) then
      raise exception 'Format not available for this home' using errcode = '42501';
    end if;
  end if;

  select id into hp_id from public.home_products where home_id=p_home_id and home_products.format_id=target_format;
  if not found then
    insert into public.home_products(home_id,format_id) values(p_home_id,target_format) returning id into hp_id;
    created := true;
    movement_id := public.record_stock_movement(p_home_id,p_key,'correction',p_home_product_id => hp_id,p_state => p_initial_state);
  end if;
  -- Un formato già collegato conserva integralmente i lotti M1-A/M1-B.
  result := jsonb_build_object('home_product_id',hp_id,'created',created,'movement_id',movement_id);
  insert into private.inventory_add_requests(home_id,request_key,actor_id,payload,result)
    values(p_home_id,p_key,auth.uid(),payload,result);
  return result;
exception when unique_violation then
  -- A snapshot ripetibile una richiesta concorrente può non essere visibile.
  -- L'eccezione annulla anche metadati e movimento; ripetere la stessa chiave.
  raise exception 'Concurrent inventory addition; retry transaction' using errcode = '40001';
end $$;
revoke all on function public.add_inventory_product(uuid,uuid,jsonb,uuid,jsonb) from public, anon, authenticated;
grant execute on function public.add_inventory_product(uuid,uuid,jsonb,uuid,jsonb) to authenticated;
commit;
