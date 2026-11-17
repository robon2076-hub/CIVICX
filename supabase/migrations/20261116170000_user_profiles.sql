begin;

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete restrict,
  email text not null,
  username text not null,
  role text not null default 'citizen'
    check (role in ('citizen', 'authority', 'owner')),
  created_at timestamptz not null default now(),
  constraint profiles_username_format
    check (username ~ '^[A-Za-z0-9_]{3,20}$')
);

create unique index if not exists profiles_email_lower_key
  on public.profiles (lower(email));
create unique index if not exists profiles_username_lower_key
  on public.profiles (lower(username));

alter table public.profiles enable row level security;

revoke all on table public.profiles from public, anon;
revoke delete on table public.profiles from authenticated;
grant select, insert, update on table public.profiles to authenticated;

drop policy if exists "Users can view their own profile" on public.profiles;
create policy "Users can view their own profile"
  on public.profiles
  for select
  to authenticated
  using (id = (select auth.uid()));

drop policy if exists "Users can create their own citizen profile" on public.profiles;
create policy "Users can create their own citizen profile"
  on public.profiles
  for insert
  to authenticated
  with check (
    id = (select auth.uid())
    and role = 'citizen'
    and lower(email) = lower((select auth.jwt() ->> 'email'))
  );

drop policy if exists "Users can update their own citizen profile" on public.profiles;
create policy "Users can update their own citizen profile"
  on public.profiles
  for update
  to authenticated
  using (id = (select auth.uid()))
  with check (
    id = (select auth.uid())
    and role = 'citizen'
    and lower(email) = lower((select auth.jwt() ->> 'email'))
  );

create or replace function public.is_username_available(p_username text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select coalesce(
    p_username ~ '^[A-Za-z0-9_]{3,20}$'
    and not exists (
      select 1
      from public.profiles
      where lower(username) = lower(p_username)
    ),
    false
  );
$function$;

revoke all on function public.is_username_available(text) from public, anon;
grant execute on function public.is_username_available(text) to authenticated;

commit;
