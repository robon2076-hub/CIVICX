# Authority administration

The Authority portal scopes reports through `civic_jurisdictions` and
`civic_authority_jurisdictions`. Adding a corporation is a database-only change;
the site reads active jurisdictions from the database.

## Add a corporation and assign an authority

1. Create and verify the authority user's CivicX account.
2. Obtain the authority user's UUID from Supabase Auth. Obtain the acting owner's
   UUID from the server-side `CIVICX_OWNER_USER_IDS` allowlist. Do not copy
   master keys into SQL or into this guide.
3. Apply the CivicX Authority repair migration first so
   `civic_authority_admin_events` and the assignment RPC exist.
4. In Supabase SQL Editor, replace both UUID placeholders and the corporation
   name/key, then run:

```sql
begin;

do $$
declare
  v_owner_user_id uuid := '00000000-0000-4000-8000-000000000001';
  v_authority_user_id uuid := '00000000-0000-4000-8000-000000000002';
  v_new_jurisdiction_key text := 'new-corporation';
  v_new_display_name text := 'New Municipal Corporation';
begin
  if not exists (select 1 from auth.users where id = v_owner_user_id) then
    raise exception 'Replace owner_user_id with an existing owner account UUID.';
  end if;
  if not exists (select 1 from auth.users where id = v_authority_user_id) then
    raise exception 'Replace authority_user_id with the new authority account UUID.';
  end if;

  insert into public.civic_jurisdictions (
    jurisdiction_key, display_name, is_active, center_latitude, center_longitude
  ) values (
    v_new_jurisdiction_key, v_new_display_name, true, null, null
  );

  insert into public.civic_authorities (user_id, is_active)
  values (v_authority_user_id, true)
  on conflict (user_id) do nothing;

  if not exists (
    select 1 from public.civic_authorities
    where user_id = v_authority_user_id and is_active
  ) then
    raise exception 'The authority account exists but is not active; review it before enabling access.';
  end if;

  with added_assignment as (
    insert into public.civic_authority_jurisdictions (authority_user_id, jurisdiction_key)
    values (v_authority_user_id, v_new_jurisdiction_key)
    on conflict (authority_user_id, jurisdiction_key) do nothing
    returning authority_user_id, jurisdiction_key
  )
  insert into public.civic_authority_admin_events (
    actor_user_id, authority_user_id, jurisdiction_key, event_type
  )
  select v_owner_user_id, v_authority_user_id, jurisdiction_key, 'jurisdiction_assigned'
  from added_assignment;
end
$$;

commit;
```

The UUIDs above are placeholders; replace them before running. The insert does
not reactivate an existing inactive authority account. If the jurisdiction key
already exists, the transaction fails rather than changing its current name or
data. If an assignment already exists, it is left unchanged and no duplicate
audit event is added.

Verify the result:

```sql
select j.jurisdiction_key, j.display_name, j.is_active,
       a.user_id as authority_user_id, a.is_active as authority_is_active
from public.civic_jurisdictions j
join public.civic_authority_jurisdictions aj
  on aj.jurisdiction_key = j.jurisdiction_key
join public.civic_authorities a
  on a.user_id = aj.authority_user_id
where j.jurisdiction_key = 'new-corporation';
```

Map coordinates are optional, but set both `center_latitude` and
`center_longitude` together when known. The portal authorization scope comes
from the jurisdiction assignment, not from the legacy nullable `city` columns
present in some databases. The `civic_authorities.is_active` row is the
database approval/verification marker used by the current server checks.

## Authority-key onboarding

Apply `20261117230500_civic_authority_self_promotion.sql` in the Supabase SQL
Editor before enabling self-onboarding. When a signed-in user submits the
server-configured Authority key, the server first checks for an existing active
authority and active assignment. Existing authorities go directly to their
assigned report queue.

If the account has no authority row, the page displays the active
`civic_jurisdictions` registry. The user must choose one corporation. The server
revalidates the session, key, and selection, then calls the
`civic_authority_promote_self` RPC. That transaction creates the active
`civic_authorities` row, jurisdiction assignment, and
`civic_authority_admin_events` assignment event together. The RPC is executable
only by the server service role; the browser never supplies the user ID.

An existing inactive authority row is not reactivated through this flow; an
owner must manage its approval. The Owner key does not promote an account:
Owner access still requires the account UUID in `CIVICX_OWNER_USER_IDS` as well
as the server-configured Owner key.
