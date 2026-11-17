begin;

create function public.civic_authority_promote_self(
  p_actor_user_id uuid,
  p_jurisdiction_key text
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce(current_setting('request.jwt.claim.role', true), '') <> 'service_role' then
    raise exception 'Authority promotion requires the trusted server role.'
      using errcode = '42501';
  end if;
  if p_actor_user_id is null or p_jurisdiction_key is null then
    raise exception 'Provide an account and active municipal corporation.'
      using errcode = '22023';
  end if;

  perform 1
    from public.civic_jurisdictions
   where jurisdiction_key = p_jurisdiction_key and is_active
   for key share;
  if not found then
    raise exception 'The selected municipal corporation is not active.'
      using errcode = '22023';
  end if;

  if exists (
    select 1
      from public.civic_authorities
     where user_id = p_actor_user_id
  ) then
    raise exception 'This account already has an authority record.'
      using errcode = '23505';
  end if;

  insert into public.civic_authorities (user_id, is_active)
  values (p_actor_user_id, true);

  insert into public.civic_authority_jurisdictions (authority_user_id, jurisdiction_key)
  values (p_actor_user_id, p_jurisdiction_key);

  insert into public.civic_authority_admin_events (
    actor_user_id, authority_user_id, jurisdiction_key, event_type
  ) values (
    p_actor_user_id, p_actor_user_id, p_jurisdiction_key, 'jurisdiction_assigned'
  );

  return 1;
end;
$$;

revoke all on function public.civic_authority_promote_self(uuid, text)
  from public, anon, authenticated, service_role;
grant execute on function public.civic_authority_promote_self(uuid, text)
  to service_role;

notify pgrst, 'reload schema';
commit;
