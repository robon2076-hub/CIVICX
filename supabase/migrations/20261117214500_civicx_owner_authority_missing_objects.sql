begin;

create table if not exists public.civic_authority_admin_events (
  id uuid primary key default gen_random_uuid(),
  actor_user_id uuid not null references auth.users(id) on delete restrict,
  authority_user_id uuid not null references public.civic_authorities(user_id) on delete restrict,
  jurisdiction_key text not null references public.civic_jurisdictions(jurisdiction_key) on delete restrict,
  event_type text not null check (event_type in ('jurisdiction_assigned', 'jurisdiction_removed')),
  created_at timestamptz not null default now()
);

create index if not exists civic_authority_admin_events_authority_created_idx
  on public.civic_authority_admin_events (authority_user_id, created_at desc);

alter table public.civic_authorities enable row level security;
alter table public.civic_authorities force row level security;
alter table public.civic_jurisdictions enable row level security;
alter table public.civic_jurisdictions force row level security;
alter table public.civic_authority_jurisdictions enable row level security;
alter table public.civic_authority_jurisdictions force row level security;
alter table public.civic_authority_admin_events enable row level security;
alter table public.civic_authority_admin_events force row level security;

revoke all on public.civic_authorities, public.civic_jurisdictions,
  public.civic_authority_jurisdictions, public.civic_authority_admin_events
  from public, anon, authenticated, service_role;
grant select on public.civic_authorities, public.civic_jurisdictions,
  public.civic_authority_jurisdictions, public.civic_authority_admin_events
  to service_role;

create or replace function public.civic_owner_set_authority_jurisdictions(
  p_actor_user_id uuid,
  p_authority_user_id uuid,
  p_jurisdiction_keys text[]
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  selected_count integer;
  unique_count integer;
  jurisdiction text;
  changed_count integer := 0;
begin
  if coalesce(current_setting('request.jwt.claim.role', true), '') <> 'service_role' then
    raise exception 'Owner assignment updates require the trusted server role.'
      using errcode = '42501';
  end if;
  if p_actor_user_id is null or p_authority_user_id is null or p_jurisdiction_keys is null then
    raise exception 'Provide an owner, an authority, and a jurisdiction list.'
      using errcode = '22023';
  end if;
  if cardinality(p_jurisdiction_keys) > 50 then
    raise exception 'An authority may have at most 50 jurisdiction assignments.'
      using errcode = '22023';
  end if;

  select count(*), count(distinct key)
    into selected_count, unique_count
    from unnest(p_jurisdiction_keys) as requested(key);
  if selected_count <> unique_count then
    raise exception 'Jurisdiction assignments must be unique.'
      using errcode = '22023';
  end if;

  perform 1
    from public.civic_authorities
   where user_id = p_authority_user_id and is_active
   for update;
  if not found then
    raise exception 'The authority account is not active.'
      using errcode = 'P0002';
  end if;

  if exists (
    select 1
      from unnest(p_jurisdiction_keys) as requested(key)
      left join public.civic_jurisdictions j
        on j.jurisdiction_key = requested.key and j.is_active
     where j.jurisdiction_key is null
  ) then
    raise exception 'Every assignment must reference an active registered jurisdiction.'
      using errcode = '22023';
  end if;

  for jurisdiction in
    select aj.jurisdiction_key
      from public.civic_authority_jurisdictions aj
     where aj.authority_user_id = p_authority_user_id
       and not (aj.jurisdiction_key = any(p_jurisdiction_keys))
  loop
    delete from public.civic_authority_jurisdictions
     where authority_user_id = p_authority_user_id
       and jurisdiction_key = jurisdiction;
    insert into public.civic_authority_admin_events (
      actor_user_id, authority_user_id, jurisdiction_key, event_type
    ) values (
      p_actor_user_id, p_authority_user_id, jurisdiction, 'jurisdiction_removed'
    );
    changed_count := changed_count + 1;
  end loop;

  for jurisdiction in
    select requested.key
      from unnest(p_jurisdiction_keys) as requested(key)
     where not exists (
       select 1
         from public.civic_authority_jurisdictions aj
        where aj.authority_user_id = p_authority_user_id
          and aj.jurisdiction_key = requested.key
     )
     order by requested.key
  loop
    insert into public.civic_authority_jurisdictions (authority_user_id, jurisdiction_key)
    values (p_authority_user_id, jurisdiction);
    insert into public.civic_authority_admin_events (
      actor_user_id, authority_user_id, jurisdiction_key, event_type
    ) values (
      p_actor_user_id, p_authority_user_id, jurisdiction, 'jurisdiction_assigned'
    );
    changed_count := changed_count + 1;
  end loop;

  return changed_count;
end;
$$;

revoke all on function public.civic_owner_set_authority_jurisdictions(uuid, uuid, text[])
  from public, anon, authenticated, service_role;
grant execute on function public.civic_owner_set_authority_jurisdictions(uuid, uuid, text[])
  to service_role;

notify pgrst, 'reload schema';
commit;
