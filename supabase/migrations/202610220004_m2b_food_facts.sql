begin;
create function private.off_code(code text) returns text language sql immutable set search_path='' as $$ select case when length(code)=12 then '0'||code else code end $$;
revoke all on function private.off_code(text) from public,anon,authenticated;
create or replace function public.add_inventory_product(
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
  matching_count integer;
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
        ('name','brand','category','label','kind','barcode','size_quantity','size_unit','source','source_ref')
    ) then raise exception 'Invalid product fields' using errcode = '22023'; end if;
    if coalesce(p_product->>'source','manual') not in ('manual','external') or
      (p_product->>'source_ref' is not null and coalesce(p_product->>'source','manual') <> 'external') or
      ((p_product->>'source') = 'external' and coalesce(p_product->>'source_ref','') !~ '^https://world[.]openfoodfacts[.]org/product/[0-9]{8,14}$') then
      raise exception 'Invalid provenance' using errcode='22023';
    end if;
    if nullif(p_product->>'barcode','') is not null then
      select count(*), (array_agg(f.id order by f.id))[1] into matching_count,target_format
        from public.product_formats f join public.products p on p.id=f.product_id
        where (p.scope_home_id is null or p.scope_home_id=p_home_id)
          and private.off_code(f.barcode)=private.off_code(p_product->>'barcode');
      if matching_count>1 then raise exception 'Ambiguous barcode; select a format' using errcode='22023'; end if;
    end if;
    if target_format is null then
    insert into public.products(scope_home_id,name,brand,category,source,source_ref)
      values(p_home_id,btrim(p_product->>'name'),nullif(btrim(p_product->>'brand'),''),coalesce(p_product->>'category','food'),coalesce(p_product->>'source','manual'),p_product->>'source_ref') returning id into product_id;
    insert into public.product_formats(product_id,label,kind,barcode,size_quantity,size_unit)
      values(product_id,btrim(p_product->>'label'),p_product->>'kind',nullif(p_product->>'barcode',''),
        nullif(p_product->>'size_quantity','')::public.inventory_quantity,nullif(p_product->>'size_unit','')) returning id into target_format;
    end if;
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


create table private.off_cache(code text primary key, result jsonb, expires_at timestamptz, lease uuid, lease_until timestamptz);
create table private.off_users(actor uuid primary key, window_start timestamptz not null, requests integer not null);
create table private.off_gate(id boolean primary key default true check(id), next_fetch timestamptz not null);
insert into private.off_gate values(true,'-infinity');
alter table private.off_cache enable row level security;
alter table private.off_users enable row level security;
alter table private.off_gate enable row level security;
revoke all on private.off_cache,private.off_users,private.off_gate from public,anon,authenticated;
create function public.claim_food_lookup(actor uuid, barcode text) returns jsonb language plpgsql security definer set search_path='' as $$
declare c private.off_cache; g timestamptz; n integer; token uuid;
begin
 if actor is null or barcode !~ '^(\d{8}|\d{13}|\d{14})$' then raise exception 'Invalid lookup'; end if;
 select next_fetch into g from private.off_gate where id=true for update;
 delete from private.off_users where window_start < now()-interval '2 minutes';
 insert into private.off_users values(actor,now(),1) on conflict on constraint off_users_pkey do update set
 requests=case when off_users.window_start < now()-interval '1 minute' then 1 else off_users.requests+1 end,
 window_start=case when off_users.window_start < now()-interval '1 minute' then now() else off_users.window_start end returning requests into n;
 if n>20 then return '{"state":"limited"}'; end if;
 delete from private.off_cache where coalesce(expires_at,lease_until)<now()-interval '7 days';
 select * into c from private.off_cache where code=barcode;
 if c.expires_at>now() then return jsonb_build_object('state','cached','result',c.result); end if;
 if c.lease_until>now() then return '{"state":"pending"}'; end if;
 if g>now() then return '{"state":"limited"}'; end if;
 token:=gen_random_uuid();
 update private.off_gate set next_fetch=now()+interval '7 seconds' where id=true;
 insert into private.off_cache(code,lease,lease_until) values(barcode,token,now()+interval '15 seconds') on conflict(code) do update set lease=token,lease_until=excluded.lease_until;
 return jsonb_build_object('state','fetch','lease',token);
end $$;
create function public.finish_food_lookup(barcode text, token uuid, response jsonb) returns void language plpgsql security definer set search_path='' as $$
declare ttl integer;
begin
 perform 1 from private.off_gate where id=true for update;
 ttl:=case response->>'status' when 'found' then 86400 when 'incomplete' then 86400 when 'absent' then 3600 when 'limited' then least(3600,greatest(60,coalesce((response->>'retryAfter')::integer,60))) else 15 end;
 update private.off_cache set result=response,expires_at=now()+make_interval(secs=>ttl),lease=null,lease_until=null where code=barcode and lease=token;
 if found and response->>'status' in ('limited','unavailable') then
 update private.off_gate set next_fetch=greatest(next_fetch,now()+make_interval(secs=>case when response->>'status'='limited' then ttl else 30 end)) where id=true;
 end if;
end $$;
revoke all on function public.claim_food_lookup(uuid,text),public.finish_food_lookup(text,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.claim_food_lookup(uuid,text),public.finish_food_lookup(text,uuid,jsonb) to service_role;
commit;
