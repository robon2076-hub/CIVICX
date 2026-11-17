create table if not exists public.complaint_tracking (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
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

create index if not exists complaint_tracking_user_updated_idx
  on public.complaint_tracking (user_id, updated_at desc);

alter table public.complaint_tracking enable row level security;

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
create policy "Users delete their own complaint tracking records"
  on public.complaint_tracking for delete to authenticated
  using (user_id = (select auth.uid()));

revoke all on public.complaint_tracking from anon, public;
grant select, insert, update, delete on public.complaint_tracking to authenticated;
