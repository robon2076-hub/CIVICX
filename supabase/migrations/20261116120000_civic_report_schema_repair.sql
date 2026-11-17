-- Forward-only, repeatable setup for the report and tracking tables.
-- It creates absent objects, replaces only CivicX-owned policies/triggers, and
-- aborts on same-named relations outside public or incompatible existing tables.
-- Authority actions are performed only through the server RPC and an approved
-- user row with a trusted jurisdiction assignment; no service-role key belongs
-- in the browser. Reports need a trusted admin-assigned jurisdiction before
-- authorities can read or change them.

begin;

do $preflight$
declare
  target_name text;
  existing record;
  missing_columns text;
  incompatible_columns text;
  incompatible_rows bigint;
begin
  foreach target_name in array array[
    'complaint_tracking',
    'civic_reports',
    'civic_report_events',
    'civic_authorities',
    'civic_jurisdictions',
    'civic_authority_jurisdictions'
  ] loop
    if exists (
      select 1
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where c.relname = target_name
        and n.nspname <> 'public'
        and c.relkind in ('r', 'p', 'v', 'm', 'f')
    ) then
      raise exception
        'Found relation % outside public. Inspect and migrate it explicitly; this repair will not create a duplicate.',
        target_name;
    end if;

    if exists (
      select 1
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where c.relname = target_name
        and n.nspname = 'public'
        and c.relkind not in ('r', 'p')
    ) then
      raise exception
        'public.% exists but is not a table. Inspect it before applying this repair.',
        target_name;
    end if;
  end loop;

  for existing in
    select *
    from (values
      ('complaint_tracking', array[
        'id', 'user_id', 'report_id', 'city', 'portal', 'registration_number',
        'portal_status', 'status_remarks', 'status_date', 'official_document_url',
        'checked_at', 'created_at', 'updated_at'
      ]::text[]),
      ('civic_reports', array[
        'id', 'user_id', 'category', 'title', 'city', 'location', 'area',
        'description', 'latitude', 'longitude', 'status', 'priority',
        'registration_number', 'submission_state', 'status_source', 'portal',
        'official_portal_url', 'official_registration', 'photo_path',
        'resolution_evidence_url', 'created_at', 'updated_at'
      ]::text[]),
      ('civic_report_events', array[
        'id', 'report_id', 'actor_user_id', 'actor_kind', 'event_type',
        'summary', 'details', 'metadata', 'created_at'
      ]::text[]),
      ('civic_authorities', array[
        'user_id', 'is_active', 'created_at'
      ]::text[]),
      ('civic_jurisdictions', array[
        'jurisdiction_key', 'display_name', 'is_active', 'created_at'
      ]::text[]),
      ('civic_authority_jurisdictions', array[
        'authority_user_id', 'jurisdiction_key', 'created_at'
      ]::text[])
    ) as required(table_name, columns)
  loop
    if to_regclass(format('public.%I', existing.table_name)) is not null then
      select string_agg(required_column.column_name, ', ')
      into missing_columns
      from unnest(existing.columns) as required_column(column_name)
      where not exists (
        select 1
        from information_schema.columns c
        where c.table_schema = 'public'
          and c.table_name = existing.table_name
          and c.column_name = required_column.column_name
      );

      if missing_columns is not null then
        raise exception
          'public.% has an incompatible existing schema (missing columns: %). No repair was applied.',
          existing.table_name,
          missing_columns;
      end if;
    end if;
  end loop;

  for existing in
    select *
    from (values
      ('complaint_tracking','id','uuid','NO'),
      ('complaint_tracking','user_id','uuid','NO'),
      ('complaint_tracking','report_id','text','YES'),
      ('complaint_tracking','city','text','YES'),
      ('complaint_tracking','portal','text','NO'),
      ('complaint_tracking','registration_number','text','NO'),
      ('complaint_tracking','portal_status','text','NO'),
      ('complaint_tracking','status_remarks','text','YES'),
      ('complaint_tracking','status_date','date','YES'),
      ('complaint_tracking','official_document_url','text','YES'),
      ('complaint_tracking','checked_at','timestamptz','YES'),
      ('complaint_tracking','created_at','timestamptz','NO'),
      ('complaint_tracking','updated_at','timestamptz','NO'),
      ('civic_reports','id','text','NO'),
      ('civic_reports','user_id','uuid','NO'),
      ('civic_reports','category','text','NO'),
      ('civic_reports','title','text','NO'),
      ('civic_reports','city','text','NO'),
      ('civic_reports','location','text','NO'),
      ('civic_reports','area','text','NO'),
      ('civic_reports','description','text','NO'),
      ('civic_reports','latitude','float8','NO'),
      ('civic_reports','longitude','float8','NO'),
      ('civic_reports','status','text','NO'),
      ('civic_reports','priority','text','NO'),
      ('civic_reports','registration_number','text','YES'),
      ('civic_reports','submission_state','text','NO'),
      ('civic_reports','status_source','text','NO'),
      ('civic_reports','portal','text','NO'),
      ('civic_reports','official_portal_url','text','NO'),
      ('civic_reports','official_registration','text','YES'),
      ('civic_reports','photo_path','text','YES'),
      ('civic_reports','jurisdiction_key','text','YES'),
      ('civic_reports','resolution_evidence_url','text','YES'),
      ('civic_reports','created_at','timestamptz','NO'),
      ('civic_reports','updated_at','timestamptz','NO'),
      ('civic_report_events','id','uuid','NO'),
      ('civic_report_events','report_id','text','NO'),
      ('civic_report_events','actor_user_id','uuid','YES'),
      ('civic_report_events','actor_kind','text','NO'),
      ('civic_report_events','event_type','text','NO'),
      ('civic_report_events','summary','text','NO'),
      ('civic_report_events','details','text','YES'),
      ('civic_report_events','metadata','jsonb','NO'),
      ('civic_report_events','created_at','timestamptz','NO'),
      ('civic_authorities','user_id','uuid','NO'),
      ('civic_authorities','is_active','bool','NO'),
      ('civic_authorities','created_at','timestamptz','NO'),
      ('civic_jurisdictions','jurisdiction_key','text','NO'),
      ('civic_jurisdictions','display_name','text','NO'),
      ('civic_jurisdictions','is_active','bool','NO'),
      ('civic_jurisdictions','created_at','timestamptz','NO'),
      ('civic_authority_jurisdictions','authority_user_id','uuid','NO'),
      ('civic_authority_jurisdictions','jurisdiction_key','text','NO'),
      ('civic_authority_jurisdictions','created_at','timestamptz','NO')
    ) as expected(table_name, column_name, expected_udt, expected_nullable)
  loop
    if to_regclass(format('public.%I', existing.table_name)) is not null then
      select string_agg(
        format('%s: expected %s nullable=%s, found %s nullable=%s',
          existing.column_name, existing.expected_udt, existing.expected_nullable,
          c.udt_name, c.is_nullable),
        '; '
      )
      into incompatible_columns
      from information_schema.columns c
      where c.table_schema = 'public'
        and c.table_name = existing.table_name
        and c.column_name = existing.column_name
        and (c.udt_name <> existing.expected_udt or c.is_nullable <> existing.expected_nullable);

      if incompatible_columns is not null then
        raise exception
          'public.% has incompatible column types or nullability (%). No repair was applied.',
          existing.table_name,
          incompatible_columns;
      end if;
    end if;
  end loop;

  if exists (
    select 1
    from (values
      ('complaint_tracking','complaint_tracking_pkey','p'),
      ('complaint_tracking','complaint_tracking_report_id_check','c'),
      ('complaint_tracking','complaint_tracking_city_check','c'),
      ('complaint_tracking','complaint_tracking_portal_check','c'),
      ('complaint_tracking','complaint_tracking_registration_number_check','c'),
      ('complaint_tracking','complaint_tracking_portal_status_check','c'),
      ('complaint_tracking','complaint_tracking_status_remarks_check','c'),
      ('complaint_tracking','complaint_tracking_official_document_url_check','c'),
      ('complaint_tracking','complaint_tracking_user_id_portal_registration_number_key','u'),
      ('civic_reports','civic_reports_pkey','p'),
      ('civic_reports','civic_reports_id_check','c'),
      ('civic_reports','civic_reports_category_check','c'),
      ('civic_reports','civic_reports_title_check','c'),
      ('civic_reports','civic_reports_city_check','c'),
      ('civic_reports','civic_reports_location_check','c'),
      ('civic_reports','civic_reports_area_check','c'),
      ('civic_reports','civic_reports_description_check','c'),
      ('civic_reports','civic_reports_latitude_check','c'),
      ('civic_reports','civic_reports_longitude_check','c'),
      ('civic_reports','civic_reports_priority_check','c'),
      ('civic_reports','civic_reports_resolution_evidence_url_check','c'),
      ('civic_report_events','civic_report_events_pkey','p'),
      ('civic_report_events','civic_report_events_actor_kind_check','c'),
      ('civic_report_events','civic_report_events_event_type_check','c'),
      ('civic_report_events','civic_report_events_summary_check','c'),
      ('civic_report_events','civic_report_events_details_check','c'),
      ('civic_authorities','civic_authorities_pkey','p'),
      ('civic_jurisdictions','civic_jurisdictions_pkey','p'),
      ('civic_jurisdictions','civic_jurisdictions_jurisdiction_key_check','c'),
      ('civic_jurisdictions','civic_jurisdictions_display_name_check','c'),
      ('civic_authority_jurisdictions','civic_authority_jurisdictions_pkey','p')
    ) as expected(table_name, constraint_name, constraint_type)
    join pg_class rel on rel.oid = to_regclass(format('public.%I', expected.table_name))
    left join pg_constraint con
      on con.conrelid = rel.oid
      and con.conname = expected.constraint_name
      and con.contype::text = expected.constraint_type
      and con.convalidated
    where to_regclass(format('public.%I', expected.table_name)) is not null
      and con.oid is null
  ) then
    raise exception
      'An existing report table is missing an expected validated PK/check/unique constraint. Review the preflight before repairing it.';
  end if;

  if exists (
    select 1
    from pg_trigger trg
    join pg_class rel on rel.oid = trg.tgrelid
    join pg_namespace n on n.oid = rel.relnamespace
    where n.nspname = 'public'
      and rel.relname in (
        'complaint_tracking', 'civic_reports', 'civic_report_events', 'civic_authorities',
        'civic_jurisdictions', 'civic_authority_jurisdictions'
      )
      and not trg.tgisinternal
      and trg.tgname not in (
        'civic_report_submission_valid',
        'civic_report_submission_history',
        'civic_report_authority_history'
      )
  ) then
    raise exception 'Unexpected trigger found on a CivicX report table. Review it before applying this repair.';
  end if;

  if to_regclass('public.complaint_tracking') is not null then
    execute $query$
      select count(*) from public.complaint_tracking t
      left join auth.users u on u.id = t.user_id
      where u.id is null
    $query$ into incompatible_rows;
    if incompatible_rows > 0 then
      raise exception 'complaint_tracking has % rows without a matching auth.users owner.', incompatible_rows;
    end if;
  end if;
  if to_regclass('public.civic_reports') is not null then
    execute $query$
      select count(*) from public.civic_reports r
      left join auth.users u on u.id = r.user_id
      where u.id is null
    $query$ into incompatible_rows;
    if incompatible_rows > 0 then
      raise exception 'civic_reports has % rows without a matching auth.users owner.', incompatible_rows;
    end if;
  end if;
  if to_regclass('public.civic_report_events') is not null
      and to_regclass('public.civic_reports') is not null then
    execute $query$
      select count(*) from public.civic_report_events e
      left join public.civic_reports r on r.id = e.report_id
      left join auth.users u on u.id = e.actor_user_id
      where r.id is null
        or (e.actor_user_id is not null and u.id is null)
        or (e.actor_kind = 'citizen' and e.actor_user_id is distinct from r.user_id)
    $query$ into incompatible_rows;
    if incompatible_rows > 0 then
      raise exception 'civic_report_events has % rows with broken report or actor references.', incompatible_rows;
    end if;
  end if;

  if to_regclass('public.civic_reports') is not null
      and exists (
        select 1 from information_schema.columns
        where table_schema = 'public'
          and table_name = 'civic_reports'
          and column_name = 'jurisdiction_key'
      ) then
    if to_regclass('public.civic_jurisdictions') is null then
      execute 'select count(*) from public.civic_reports where jurisdiction_key is not null'
        into incompatible_rows;
      if incompatible_rows > 0 then
        raise exception
          'civic_reports has % jurisdiction keys but public.civic_jurisdictions is absent. Verify and reconcile them before applying this repair.',
          incompatible_rows;
      end if;
    else
      execute $query$
        select count(*) from public.civic_reports r
        where r.jurisdiction_key is not null
          and not exists (
            select 1 from public.civic_jurisdictions j
            where j.jurisdiction_key = r.jurisdiction_key
          )
      $query$ into incompatible_rows;
      if incompatible_rows > 0 then
        raise exception
          'civic_reports has % jurisdiction keys without registry rows. Verify and reconcile them before applying this repair.',
          incompatible_rows;
      end if;
    end if;
  end if;

  if to_regclass('public.civic_authority_jurisdictions') is not null then
    if to_regclass('public.civic_authorities') is null
        or to_regclass('public.civic_jurisdictions') is null then
      execute 'select count(*) from public.civic_authority_jurisdictions'
        into incompatible_rows;
      if incompatible_rows > 0 then
        raise exception
          'Existing authority jurisdiction assignments cannot be validated because their parent tables are absent. Review them before applying this repair.';
      end if;
    else
      execute $query$
        select count(*) from public.civic_authority_jurisdictions aj
        where not exists (
          select 1 from public.civic_authorities a where a.user_id = aj.authority_user_id
        )
        or not exists (
          select 1 from public.civic_jurisdictions j where j.jurisdiction_key = aj.jurisdiction_key
        )
      $query$ into incompatible_rows;
      if incompatible_rows > 0 then
        raise exception
          'Existing authority jurisdiction assignments have % missing parent references. Review them before applying this repair.',
          incompatible_rows;
      end if;
    end if;
  end if;

  if exists (
    select 1
    from pg_policies p
    where p.schemaname = 'public'
      and (
        (p.tablename = 'complaint_tracking' and p.policyname not in (
          'Users read their own complaint tracking records',
          'Users create their own complaint tracking records',
          'Users update their own complaint tracking records',
          'Users delete their own complaint tracking records'
        ))
        or (p.tablename = 'civic_reports' and p.policyname not in (
          'Users read their own civic reports',
          'Users create civic reports for their own account'
        ))
        or (p.tablename = 'civic_report_events' and p.policyname not in (
          'Users read history for their own civic reports',
          'Users append citizen actions to their own report history'
        ))
        or p.tablename in ('civic_authorities', 'civic_jurisdictions', 'civic_authority_jurisdictions')
      )
  ) then
    raise exception
      'Unexpected policy found on a CivicX report table. Review existing RLS policies before applying this repair.';
  end if;

  if to_regclass('storage.objects') is null or to_regclass('storage.buckets') is null then
    raise exception 'Supabase Storage objects are unavailable; inspect the project before applying this repair.';
  end if;

  if to_regclass('public.civic_reports') is null then
    execute $query$
      select count(*) from storage.objects
      where bucket_id = 'civic-report-attachments'
    $query$ into incompatible_rows;
    if incompatible_rows > 0 then
      raise exception
        'The target attachment bucket contains % objects but civic_reports is absent. Identify their owners before applying this repair.',
        incompatible_rows;
    end if;
  else
    execute $query$
      select count(*) from storage.objects o
      where o.bucket_id = 'civic-report-attachments'
        and not exists (
          select 1 from public.civic_reports r where r.photo_path = o.name
        )
    $query$ into incompatible_rows;
    if incompatible_rows > 0 then
      raise exception
        'The target attachment bucket has % objects not linked to civic reports. Review them before applying bucket restrictions.',
        incompatible_rows;
    end if;

    execute $query$
      select count(*) from public.civic_reports r
      where r.photo_path is not null
        and not exists (
          select 1 from storage.objects o
          where o.bucket_id = 'civic-report-attachments'
            and o.name = r.photo_path
        )
    $query$ into incompatible_rows;
    if incompatible_rows > 0 then
      raise exception
        'civic_reports has % photo paths without matching Storage objects. Review existing report attachments before applying this repair.',
        incompatible_rows;
    end if;
  end if;

  if exists (
    select 1
    from pg_policies p
    where p.schemaname = 'storage'
      and p.tablename = 'objects'
      and p.policyname not in (
        'Users read their own civic report photos',
        'Users upload civic report photos to their own folder',
        'Users remove only unattached civic report photos'
      )
      and (
        position('civic-report-attachments' in lower(coalesce(p.qual, '') || ' ' || coalesce(p.with_check, ''))) > 0
        or position('bucket_id =' in lower(coalesce(p.qual, '') || ' ' || coalesce(p.with_check, ''))) = 0
      )
  ) then
    raise exception
      'A storage.objects policy may affect civic-report-attachments. Review storage policies before applying this repair.';
  end if;
end
$preflight$;

create extension if not exists pgcrypto;

create table if not exists public.complaint_tracking (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete restrict,
  report_id text check (report_id is null or char_length(report_id) between 1 and 80),
  city text check (city is null or char_length(city) between 2 and 120),
  portal text not null default 'CPGRAMS' check (portal = 'CPGRAMS'),
  registration_number text not null check (
    char_length(registration_number) between 2 and 80
    and btrim(registration_number) <> ''
  ),
  portal_status text not null default 'not_checked' check (
    portal_status in ('not_checked', 'registered', 'under_review', 'in_progress', 'resolved', 'closed', 'rejected')
  ),
  status_remarks text check (status_remarks is null or char_length(status_remarks) <= 1200),
  status_date date,
  official_document_url text check (
    official_document_url is null
    or (
      char_length(official_document_url) <= 500
      and official_document_url ~* '^https://pgportal\.gov\.in(/|$)'
    )
  ),
  checked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, portal, registration_number)
);

create table if not exists public.civic_reports (
  id text primary key check (id ~ '^CX-[A-Za-z0-9-]{1,77}$'),
  user_id uuid not null references auth.users(id) on delete restrict,
  category text not null check (category in ('Pothole', 'Garbage', 'Water leakage', 'Streetlight')),
  title text not null check (char_length(title) between 1 and 200),
  city text not null check (char_length(city) between 2 and 120),
  location text not null check (char_length(location) between 2 and 160),
  area text not null check (char_length(area) between 1 and 120),
  description text not null check (char_length(description) between 1 and 2500),
  latitude double precision not null check (latitude between -90 and 90),
  longitude double precision not null check (longitude between -180 and 180),
  status text not null default 'Prepared (awaiting user filing)',
  priority text not null default 'Medium' check (priority in ('High', 'Medium', 'Low')),
  registration_number text,
  submission_state text not null default 'awaiting_user_filing',
  status_source text not null default 'CivicX report preparation; not filed with an authority',
  portal text not null default 'CPGRAMS',
  official_portal_url text not null default 'https://pgportal.gov.in/Home/LodgeGrievance',
  official_registration text,
  photo_path text,
  jurisdiction_key text,
  resolution_evidence_url text check (
    resolution_evidence_url is null
    or (char_length(resolution_evidence_url) <= 1000 and resolution_evidence_url ~* '^https://')
  ),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.civic_report_events (
  id uuid primary key default gen_random_uuid(),
  report_id text not null references public.civic_reports(id) on delete restrict,
  actor_user_id uuid references auth.users(id) on delete restrict,
  actor_kind text not null check (actor_kind in ('citizen', 'authority', 'system')),
  event_type text not null check (event_type in (
    'report_submitted', 'authority_action', 'resolution_evidence',
    'citizen_dispute', 'reopening_requested', 'reopened',
    'portal_reference_saved', 'citizen_status_check'
  )),
  summary text not null check (char_length(summary) between 1 and 240),
  details text check (details is null or char_length(details) <= 2000),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.civic_authorities (
  user_id uuid primary key references auth.users(id) on delete restrict,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

alter table public.civic_reports
  add column if not exists jurisdiction_key text;

create table if not exists public.civic_jurisdictions (
  jurisdiction_key text primary key check (
    jurisdiction_key ~ '^[a-z0-9][a-z0-9_-]{1,79}$'
  ),
  display_name text not null check (char_length(btrim(display_name)) between 1 and 120),
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.civic_authority_jurisdictions (
  authority_user_id uuid not null,
  jurisdiction_key text not null,
  created_at timestamptz not null default now(),
  primary key (authority_user_id, jurisdiction_key)
);

create index if not exists complaint_tracking_user_updated_idx
  on public.complaint_tracking (user_id, updated_at desc);
create index if not exists civic_reports_user_created_idx
  on public.civic_reports (user_id, created_at desc);
create index if not exists civic_report_events_report_created_idx
  on public.civic_report_events (report_id, created_at asc);

do $foreign_keys$
declare
  spec record;
  attribute_number smallint;
  existing_fk record;
  has_safe_fk boolean;
  referenced_table regclass;
begin
  for spec in
    select *
    from (values
      ('complaint_tracking', 'user_id', 'auth', 'users', 'id', 'complaint_tracking_user_id_fkey'),
      ('civic_reports', 'user_id', 'auth', 'users', 'id', 'civic_reports_user_id_fkey'),
      ('civic_report_events', 'report_id', 'public', 'civic_reports', 'id', 'civic_report_events_report_id_fkey'),
      ('civic_report_events', 'actor_user_id', 'auth', 'users', 'id', 'civic_report_events_actor_user_id_fkey'),
      ('civic_authorities', 'user_id', 'auth', 'users', 'id', 'civic_authorities_user_id_fkey'),
      ('civic_reports', 'jurisdiction_key', 'public', 'civic_jurisdictions', 'jurisdiction_key', 'civic_reports_jurisdiction_key_fkey'),
      ('civic_authority_jurisdictions', 'authority_user_id', 'public', 'civic_authorities', 'user_id', 'civic_authority_jurisdictions_authority_user_id_fkey'),
      ('civic_authority_jurisdictions', 'jurisdiction_key', 'public', 'civic_jurisdictions', 'jurisdiction_key', 'civic_authority_jurisdictions_jurisdiction_key_fkey')
    ) as required(table_name, column_name, referenced_schema, referenced_name, referenced_column, constraint_name)
  loop
    select a.attnum
    into attribute_number
    from pg_attribute a
    where a.attrelid = to_regclass(format('public.%I', spec.table_name))
      and a.attname = spec.column_name
      and not a.attisdropped;

    referenced_table := to_regclass(format('%I.%I', spec.referenced_schema, spec.referenced_name));
    if attribute_number is null or referenced_table is null then
      raise exception 'Cannot establish required foreign key for public.%.%', spec.table_name, spec.column_name;
    end if;

    has_safe_fk := false;
    for existing_fk in
      select c.conname, c.confrelid, c.confdeltype
      from pg_constraint c
      where c.conrelid = to_regclass(format('public.%I', spec.table_name))
        and c.contype = 'f'
        and c.conkey = array[attribute_number]::smallint[]
    loop
      if existing_fk.confrelid = referenced_table and existing_fk.confdeltype = 'r' then
        has_safe_fk := true;
      elsif existing_fk.confrelid = referenced_table then
        execute format(
          'alter table public.%I drop constraint %I',
          spec.table_name,
          existing_fk.conname
        );
      else
        raise exception
          'Unexpected foreign key on public.%.%; inspect it before applying this repair.',
          spec.table_name,
          spec.column_name;
      end if;
    end loop;

    if not has_safe_fk then
      execute format(
        'alter table public.%I add constraint %I foreign key (%I) references %I.%I (%I) on delete restrict',
        spec.table_name,
        spec.constraint_name,
        spec.column_name,
        spec.referenced_schema,
        spec.referenced_name,
        spec.referenced_column
      );
    end if;
  end loop;
end
$foreign_keys$;

alter table public.complaint_tracking enable row level security;
alter table public.civic_reports enable row level security;
alter table public.civic_report_events enable row level security;
alter table public.civic_authorities enable row level security;
alter table public.civic_authorities force row level security;
alter table public.civic_jurisdictions enable row level security;
alter table public.civic_jurisdictions force row level security;
alter table public.civic_authority_jurisdictions enable row level security;
alter table public.civic_authority_jurisdictions force row level security;

drop policy if exists "Users read their own complaint tracking records" on public.complaint_tracking;
create policy "Users read their own complaint tracking records"
  on public.complaint_tracking for select to authenticated
  using (user_id = (select auth.uid()));
drop policy if exists "Users create their own complaint tracking records" on public.complaint_tracking;
create policy "Users create their own complaint tracking records"
  on public.complaint_tracking for insert to authenticated
  with check (user_id = (select auth.uid()));
drop policy if exists "Users update their own complaint tracking records" on public.complaint_tracking;
create policy "Users update their own complaint tracking records"
  on public.complaint_tracking for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
drop policy if exists "Users delete their own complaint tracking records" on public.complaint_tracking;

drop policy if exists "Users read their own civic reports" on public.civic_reports;
create policy "Users read their own civic reports"
  on public.civic_reports for select to authenticated
  using (user_id = (select auth.uid()));
drop policy if exists "Users create civic reports for their own account" on public.civic_reports;
create policy "Users create civic reports for their own account"
  on public.civic_reports for insert to authenticated
  with check (user_id = (select auth.uid()));

drop policy if exists "Users read history for their own civic reports" on public.civic_report_events;
create policy "Users read history for their own civic reports"
  on public.civic_report_events for select to authenticated
  using (exists (
    select 1 from public.civic_reports
    where civic_reports.id = civic_report_events.report_id
      and civic_reports.user_id = (select auth.uid())
  ));
drop policy if exists "Users append citizen actions to their own report history" on public.civic_report_events;
create policy "Users append citizen actions to their own report history"
  on public.civic_report_events for insert to authenticated
  with check (
    actor_kind = 'citizen'
    and actor_user_id = (select auth.uid())
    and event_type in ('citizen_dispute', 'reopening_requested', 'portal_reference_saved', 'citizen_status_check')
    and exists (
      select 1 from public.civic_reports
      where civic_reports.id = civic_report_events.report_id
        and civic_reports.user_id = (select auth.uid())
    )
  );

revoke all on public.complaint_tracking, public.civic_reports, public.civic_report_events,
  public.civic_authorities, public.civic_jurisdictions, public.civic_authority_jurisdictions
  from anon, authenticated, service_role, public;
grant select, insert, update on public.complaint_tracking to authenticated;
grant select, insert on public.civic_reports to authenticated;
grant select, insert on public.civic_report_events to authenticated;
grant select on public.civic_authorities to service_role;
grant select on public.civic_reports, public.civic_report_events,
  public.civic_jurisdictions, public.civic_authority_jurisdictions to service_role;

create or replace function public.validate_civic_report_submission()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if auth.role() = 'authenticated' and new.jurisdiction_key is not null then
    raise exception 'Report jurisdiction must be assigned through a trusted administrative workflow.';
  end if;
  if auth.role() = 'authenticated' and (
    new.status <> 'Prepared (awaiting user filing)'
    or new.registration_number is distinct from new.id
    or new.submission_state <> 'awaiting_user_filing'
    or new.status_source <> 'CivicX report preparation; not filed with an authority'
    or new.portal <> 'CPGRAMS'
    or new.official_portal_url <> 'https://pgportal.gov.in/Home/LodgeGrievance'
    or new.official_registration is not null
    or new.resolution_evidence_url is not null
  ) then
    raise exception 'CivicX reports must begin in the prepared state and cannot claim authority action.';
  end if;
  if new.photo_path is not null and new.photo_path not like new.user_id::text || '/' || new.id || '/%' then
    raise exception 'Report photos must be stored under the report owner and report ID.';
  end if;
  new.created_at := now();
  new.updated_at := new.created_at;
  return new;
end;
$$;
revoke all on function public.validate_civic_report_submission() from public, anon, authenticated;

create or replace function public.record_civic_report_submission()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.civic_report_events (report_id, actor_user_id, actor_kind, event_type, summary)
  values (new.id, new.user_id, 'citizen', 'report_submitted', 'CivicX report prepared');
  return new;
end;
$$;
revoke all on function public.record_civic_report_submission() from public, anon, authenticated;

create or replace function public.record_civic_report_authority_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  action_name text;
  actor_id uuid;
  event_id uuid;
  event_summary text;
  event_details text;
begin
  action_name := coalesce(nullif(current_setting('civicx.authority_action', true), ''), 'status_update');
  actor_id := nullif(current_setting('civicx.authority_user_id', true), '')::uuid;
  event_summary := nullif(current_setting('civicx.authority_summary', true), '');
  event_details := nullif(current_setting('civicx.authority_details', true), '');

  if auth.role() is distinct from 'service_role'
      or actor_id is null
      or action_name not in (
        'status_update', 'reopen',
        'resolution_evidence_add', 'resolution_evidence_remove'
      )
      or not exists (
        select 1
        from public.civic_authorities a
        where a.user_id = actor_id
          and a.is_active
      ) then
    raise exception 'Authority report changes require an active, authenticated authority action.'
      using errcode = '42501';
  end if;

  if new.status is distinct from old.status then
    insert into public.civic_report_events (
      report_id, actor_user_id, actor_kind, event_type, summary, details, metadata
    ) values (
      new.id,
      actor_id,
      'authority',
      case when action_name = 'reopen' then 'reopened' else 'authority_action' end,
      coalesce(event_summary, case when action_name = 'reopen' then 'Authority reopened report' else 'Authority status update' end),
      event_details,
      jsonb_build_object('action', action_name, 'previous_status', old.status, 'status', new.status)
    )
    returning id into event_id;
  end if;

  if new.resolution_evidence_url is distinct from old.resolution_evidence_url then
    insert into public.civic_report_events (
      report_id, actor_user_id, actor_kind, event_type, summary, details, metadata
    ) values (
      new.id,
      actor_id,
      'authority',
      'resolution_evidence',
      coalesce(event_summary, case when new.resolution_evidence_url is null then 'Resolution evidence removed' else 'Resolution evidence recorded' end),
      event_details,
      jsonb_build_object(
        'action', case when new.resolution_evidence_url is null then 'removed' else 'added' end,
        'previous_evidence_url', old.resolution_evidence_url,
        'evidence_url', new.resolution_evidence_url
      )
    )
    returning id into event_id;
  end if;

  if new.status is distinct from old.status or
      new.resolution_evidence_url is distinct from old.resolution_evidence_url then
    new.updated_at := now();
    perform set_config('civicx.authority_event_id', event_id::text, true);
  end if;
  return new;
end;
$$;
revoke all on function public.record_civic_report_authority_update() from public, anon, authenticated;

create or replace function public.civic_authority_can_access_report(
  p_actor_user_id uuid,
  p_report_id text
)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Authority jurisdiction checks require the trusted server role.'
      using errcode = '42501';
  end if;

  return exists (
    select 1
    from public.civic_reports r
    join public.civic_jurisdictions j
      on j.jurisdiction_key = r.jurisdiction_key
      and j.is_active
    join public.civic_authority_jurisdictions aj
      on aj.jurisdiction_key = j.jurisdiction_key
      and aj.authority_user_id = p_actor_user_id
    join public.civic_authorities a
      on a.user_id = aj.authority_user_id
      and a.is_active
    where r.id = p_report_id
      and p_actor_user_id is not null
      and p_report_id is not null
  );
end;
$$;
revoke all on function public.civic_authority_can_access_report(uuid, text)
  from public, anon, authenticated, service_role;
grant execute on function public.civic_authority_can_access_report(uuid, text)
  to service_role;

create or replace function public.apply_civic_report_authority_action(
  p_report_id text,
  p_actor_user_id uuid,
  p_action text,
  p_status text,
  p_evidence_url text,
  p_summary text,
  p_details text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  report_row public.civic_reports%rowtype;
  event_row public.civic_report_events%rowtype;
  event_id uuid;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Authority actions require the trusted server role.' using errcode = '42501';
  end if;
  if not exists (
    select 1
    from public.civic_authorities a
    where a.user_id = p_actor_user_id
      and a.is_active
  ) then
    raise exception 'The authenticated account is not an active CivicX authority.' using errcode = '42501';
  end if;
  if p_details is null or char_length(btrim(p_details)) not between 1 and 2000 then
    raise exception 'An audit note of 1 to 2000 characters is required.' using errcode = '22023';
  end if;
  if p_summary is not null and char_length(btrim(p_summary)) not between 1 and 240 then
    raise exception 'The audit summary must contain 1 to 240 characters.' using errcode = '22023';
  end if;

  select *
  into report_row
  from public.civic_reports
  where id = p_report_id
  for update;
  if not found then
    raise exception 'CivicX report not found.' using errcode = 'P0002';
  end if;
  if not public.civic_authority_can_access_report(p_actor_user_id, p_report_id) then
    raise exception 'The authority is not assigned to the report jurisdiction.'
      using errcode = '42501';
  end if;

  perform set_config('civicx.authority_user_id', p_actor_user_id::text, true);
  perform set_config('civicx.authority_action', p_action, true);
  perform set_config('civicx.authority_summary', coalesce(p_summary, ''), true);
  perform set_config('civicx.authority_details', btrim(p_details), true);
  perform set_config('civicx.authority_event_id', '', true);

  if p_action = 'status_update' then
    if p_status is null
        or p_status not in ('Submitted', 'Verified', 'Assigned', 'In progress', 'Resolved', 'Closed', 'Rejected')
        or p_evidence_url is not null then
      raise exception 'Invalid status update.' using errcode = '22023';
    end if;
    if p_status is not distinct from report_row.status then
      raise exception 'The requested status is already current.' using errcode = '22023';
    end if;
    update public.civic_reports set status = p_status where id = p_report_id;
  elsif p_action = 'reopen' then
    if p_status is not null or p_evidence_url is not null
        or report_row.status not in ('Resolved', 'Closed') then
      raise exception 'Only resolved or closed reports can be explicitly reopened.' using errcode = '22023';
    end if;
    update public.civic_reports set status = 'In progress' where id = p_report_id;
  elsif p_action = 'resolution_evidence_add' then
    if p_status is not null or p_evidence_url is null
        or char_length(p_evidence_url) > 1000 or p_evidence_url !~* '^https://'
        or p_evidence_url is not distinct from report_row.resolution_evidence_url then
      raise exception 'Provide a new HTTPS resolution-evidence URL.' using errcode = '22023';
    end if;
    update public.civic_reports set resolution_evidence_url = p_evidence_url where id = p_report_id;
  elsif p_action = 'resolution_evidence_remove' then
    if p_status is not null or p_evidence_url is not null
        or report_row.resolution_evidence_url is null then
      raise exception 'The report has no resolution evidence to remove.' using errcode = '22023';
    end if;
    update public.civic_reports set resolution_evidence_url = null where id = p_report_id;
  else
    raise exception 'Unsupported authority action.' using errcode = '22023';
  end if;

  event_id := nullif(current_setting('civicx.authority_event_id', true), '')::uuid;
  if event_id is null then
    raise exception 'The authority action did not produce an audit event.' using errcode = '22023';
  end if;

  select * into report_row from public.civic_reports where id = p_report_id;
  select * into event_row from public.civic_report_events where id = event_id;
  return jsonb_build_object(
    'report', jsonb_build_object(
      'id', report_row.id,
      'status', report_row.status,
      'resolution_evidence_url', report_row.resolution_evidence_url,
      'updated_at', report_row.updated_at
    ),
    'event', jsonb_build_object(
      'id', event_row.id,
      'report_id', event_row.report_id,
      'actor_user_id', event_row.actor_user_id,
      'actor_kind', event_row.actor_kind,
      'event_type', event_row.event_type,
      'summary', event_row.summary,
      'details', event_row.details,
      'metadata', event_row.metadata,
      'created_at', event_row.created_at
    )
  );
end;
$$;
revoke all on function public.apply_civic_report_authority_action(text, uuid, text, text, text, text, text)
  from public, anon, authenticated, service_role;
grant execute on function public.apply_civic_report_authority_action(text, uuid, text, text, text, text, text)
  to service_role;

drop trigger if exists civic_report_submission_valid on public.civic_reports;
create trigger civic_report_submission_valid
  before insert on public.civic_reports
  for each row execute function public.validate_civic_report_submission();
drop trigger if exists civic_report_submission_history on public.civic_reports;
create trigger civic_report_submission_history
  after insert on public.civic_reports
  for each row execute function public.record_civic_report_submission();
drop trigger if exists civic_report_authority_history on public.civic_reports;
create trigger civic_report_authority_history
  before update of status, resolution_evidence_url on public.civic_reports
  for each row execute function public.record_civic_report_authority_update();

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('civic-report-attachments', 'civic-report-attachments', false, 10485760, array['image/jpeg'])
on conflict (id) do update
  set public = false, file_size_limit = 10485760, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Users read their own civic report photos" on storage.objects;
create policy "Users read their own civic report photos"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'civic-report-attachments'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );
drop policy if exists "Users upload civic report photos to their own folder" on storage.objects;
create policy "Users upload civic report photos to their own folder"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'civic-report-attachments'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );
drop policy if exists "Users remove only unattached civic report photos" on storage.objects;
create policy "Users remove only unattached civic report photos"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'civic-report-attachments'
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and not exists (
      select 1 from public.civic_reports
      where civic_reports.photo_path = storage.objects.name
        and civic_reports.user_id = (select auth.uid())
    )
  );

notify pgrst, 'reload schema';

commit;
