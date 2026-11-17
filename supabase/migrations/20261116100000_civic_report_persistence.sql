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
  resolution_evidence_url text check (
    resolution_evidence_url is null
    or (char_length(resolution_evidence_url) <= 1000 and resolution_evidence_url ~* '^https://')
  ),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists civic_reports_user_created_idx
  on public.civic_reports (user_id, created_at desc);

alter table public.complaint_tracking
  drop constraint if exists complaint_tracking_user_id_fkey;
alter table public.complaint_tracking
  add constraint complaint_tracking_user_id_fkey
  foreign key (user_id) references auth.users(id) on delete restrict;

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

create index if not exists civic_report_events_report_created_idx
  on public.civic_report_events (report_id, created_at asc);

alter table public.civic_reports enable row level security;
alter table public.civic_report_events enable row level security;

create policy "Users read their own civic reports"
  on public.civic_reports for select to authenticated
  using (user_id = (select auth.uid()));
create policy "Users create civic reports for their own account"
  on public.civic_reports for insert to authenticated
  with check (user_id = (select auth.uid()));

create policy "Users read history for their own civic reports"
  on public.civic_report_events for select to authenticated
  using (exists (
    select 1 from public.civic_reports
    where civic_reports.id = civic_report_events.report_id
      and civic_reports.user_id = (select auth.uid())
  ));
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

revoke all on public.civic_reports, public.civic_report_events from anon, public;
grant select, insert on public.civic_reports to authenticated;
grant select, insert on public.civic_report_events to authenticated;
grant select, insert, update on public.civic_reports to service_role;
grant select, insert on public.civic_report_events to service_role;

create or replace function public.validate_civic_report_submission()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
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

create trigger civic_report_submission_valid
  before insert on public.civic_reports
  for each row execute function public.validate_civic_report_submission();

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

create trigger civic_report_submission_history
  after insert on public.civic_reports
  for each row execute function public.record_civic_report_submission();

create or replace function public.record_civic_report_authority_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status is distinct from old.status then
    insert into public.civic_report_events (
      report_id, actor_kind, event_type, summary, metadata
    ) values (
      new.id, 'authority', 'authority_action', 'Authority status update',
      jsonb_build_object('previous_status', old.status, 'status', new.status)
    );
  end if;
  if new.resolution_evidence_url is distinct from old.resolution_evidence_url
      and new.resolution_evidence_url is not null then
    insert into public.civic_report_events (
      report_id, actor_kind, event_type, summary, metadata
    ) values (
      new.id, 'authority', 'resolution_evidence', 'Resolution evidence recorded',
      jsonb_build_object('evidence_url', new.resolution_evidence_url)
    );
  end if;
  if new.status is distinct from old.status or
      new.resolution_evidence_url is distinct from old.resolution_evidence_url then
    new.updated_at := now();
  end if;
  return new;
end;
$$;
revoke all on function public.record_civic_report_authority_update() from public, anon, authenticated;

create trigger civic_report_authority_history
  before update of status, resolution_evidence_url on public.civic_reports
  for each row execute function public.record_civic_report_authority_update();

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('civic-report-attachments', 'civic-report-attachments', false, 10485760, array['image/jpeg'])
on conflict (id) do update
  set public = false, file_size_limit = 10485760, allowed_mime_types = excluded.allowed_mime_types;

create policy "Users read their own civic report photos"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'civic-report-attachments'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );
create policy "Users upload civic report photos to their own folder"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'civic-report-attachments'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );
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
