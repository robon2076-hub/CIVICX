create extension if not exists pgcrypto;

create table if not exists public.community_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null check (char_length(display_name) between 2 and 40),
  city text not null check (char_length(city) between 2 and 80),
  locality text not null check (char_length(locality) between 2 and 80),
  updated_at timestamptz not null default now()
);

create table if not exists public.community_moderators (
  user_id uuid primary key references auth.users(id) on delete cascade,
  granted_at timestamptz not null default now()
);

create or replace function public.is_civicx_moderator()
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.community_moderators
    where user_id = (select auth.uid())
  );
$$;

revoke all on function public.is_civicx_moderator() from public, anon;
grant execute on function public.is_civicx_moderator() to anon, authenticated;

create table if not exists public.community_posts (
  id uuid primary key default gen_random_uuid(),
  author_id uuid not null references public.community_profiles(user_id) on delete cascade,
  category text not null check (category in (
    'Road and Infrastructure', 'Garbage and Sanitation', 'Water and Drainage',
    'Pollution and Environment', 'Public Safety', 'Government Services',
    'General Civic Discussions', 'Suggestions and Solutions'
  )),
  city text not null check (char_length(city) between 2 and 80),
  locality text not null check (char_length(locality) between 2 and 80),
  body text not null check (char_length(body) between 10 and 3000),
  image_path text,
  linked_report_id text check (linked_report_id is null or char_length(linked_report_id) <= 80),
  support_count integer not null default 0 check (support_count >= 0),
  visibility text not null default 'published' check (visibility in ('published', 'hidden')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.community_comments (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.community_posts(id) on delete cascade,
  parent_comment_id uuid references public.community_comments(id) on delete cascade,
  author_id uuid not null references public.community_profiles(user_id) on delete cascade,
  body text not null check (char_length(body) between 1 and 1500),
  visibility text not null default 'published' check (visibility in ('published', 'hidden')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.community_posts
  add column if not exists support_count integer not null default 0 check (support_count >= 0);

create table if not exists public.community_reactions (
  post_id uuid not null references public.community_posts(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (post_id, user_id)
);

create table if not exists public.community_follows (
  post_id uuid not null references public.community_posts(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (post_id, user_id)
);

create table if not exists public.community_reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid not null references auth.users(id) on delete cascade,
  post_id uuid references public.community_posts(id) on delete cascade,
  comment_id uuid references public.community_comments(id) on delete cascade,
  reason text not null check (reason in ('spam', 'harassment', 'personal_information', 'unsafe', 'other')),
  details text check (details is null or char_length(details) <= 500),
  status text not null default 'open' check (status in ('open', 'reviewing', 'actioned', 'dismissed')),
  created_at timestamptz not null default now(),
  check ((post_id is not null) <> (comment_id is not null)),
  unique (reporter_id, post_id),
  unique (reporter_id, comment_id)
);

create table if not exists public.community_notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  actor_id uuid references auth.users(id) on delete set null,
  post_id uuid references public.community_posts(id) on delete cascade,
  comment_id uuid references public.community_comments(id) on delete cascade,
  kind text not null check (kind in ('reply', 'reaction', 'followed_post_update')),
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists community_posts_locality_feed_idx
  on public.community_posts (city, locality, created_at desc)
  where visibility = 'published';
create index if not exists community_comments_post_idx
  on public.community_comments (post_id, created_at);
create index if not exists community_notifications_user_idx
  on public.community_notifications (user_id, created_at desc);
create index if not exists community_reports_queue_idx
  on public.community_reports (status, created_at);

create or replace function public.validate_community_content()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  author uuid;
  recent_count integer;
begin
  if new.body ~* '[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}'
    or new.body ~ '(\+?[0-9][0-9 ()-]{8,}[0-9])' then
    raise exception 'Remove email addresses and phone numbers from public content.';
  end if;

  author := new.author_id;
  if tg_op = 'UPDATE' then
    return new;
  elsif tg_table_name = 'community_posts' then
    select count(*) into recent_count
      from public.community_posts
      where author_id = author and created_at > now() - interval '1 hour';
    if recent_count >= 5 then
      raise exception 'Post limit reached. Try again later.';
    end if;
  else
    select count(*) into recent_count
      from public.community_comments
      where author_id = author and created_at > now() - interval '1 hour';
    if recent_count >= 30 then
      raise exception 'Reply limit reached. Try again later.';
    end if;
  end if;
  return new;
end;
$$;

create or replace function public.validate_community_comment_parent()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  parent_post uuid;
  parent_parent uuid;
begin
  if new.parent_comment_id is null then return new; end if;
  select post_id, parent_comment_id into parent_post, parent_parent
    from public.community_comments where id = new.parent_comment_id;
  if parent_post is null or parent_post <> new.post_id or parent_parent is not null then
    raise exception 'Replies must be attached to a comment in the same discussion and can be nested one level.';
  end if;
  return new;
end;
$$;

drop trigger if exists community_comments_parent_valid on public.community_comments;
create trigger community_comments_parent_valid before insert or update of parent_comment_id, post_id
  on public.community_comments for each row execute function public.validate_community_comment_parent();

drop trigger if exists community_posts_validate on public.community_posts;
create trigger community_posts_validate before insert or update of body
  on public.community_posts for each row execute function public.validate_community_content();
drop trigger if exists community_comments_validate on public.community_comments;
create trigger community_comments_validate before insert or update of body
  on public.community_comments for each row execute function public.validate_community_content();

create or replace function public.notify_community_reply()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare
  post_author uuid;
  parent_author uuid;
begin
  select author_id into post_author from public.community_posts where id = new.post_id;
  if new.parent_comment_id is not null then
    select author_id into parent_author from public.community_comments where id = new.parent_comment_id;
  end if;
  if post_author is not null and post_author <> new.author_id then
    insert into public.community_notifications(user_id, actor_id, post_id, comment_id, kind)
    values (post_author, new.author_id, new.post_id, new.id, 'reply');
  end if;
  if parent_author is not null and parent_author <> new.author_id and parent_author <> post_author then
    insert into public.community_notifications(user_id, actor_id, post_id, comment_id, kind)
    values (parent_author, new.author_id, new.post_id, new.id, 'reply');
  end if;
  insert into public.community_notifications(user_id, actor_id, post_id, comment_id, kind)
  select f.user_id, new.author_id, new.post_id, new.id, 'followed_post_update'
    from public.community_follows f
   where f.post_id = new.post_id and f.user_id <> new.author_id and f.user_id <> post_author;
  return new;
end;
$$;

create or replace function public.update_community_support_count()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    update public.community_posts set support_count = support_count + 1 where id = new.post_id;
    return new;
  end if;
  update public.community_posts set support_count = greatest(0, support_count - 1) where id = old.post_id;
  return old;
end;
$$;

drop trigger if exists community_reaction_count on public.community_reactions;
create trigger community_reaction_count
  after insert or delete on public.community_reactions
  for each row execute function public.update_community_support_count();

create or replace function public.notify_community_reaction()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare
  post_author uuid;
begin
  select author_id into post_author from public.community_posts where id = new.post_id;
  if post_author is not null and post_author <> new.user_id then
    insert into public.community_notifications(user_id, actor_id, post_id, kind)
    values (post_author, new.user_id, new.post_id, 'reaction');
  end if;
  return new;
end;
$$;

drop trigger if exists community_reaction_notifications on public.community_reactions;
create trigger community_reaction_notifications after insert on public.community_reactions
  for each row execute function public.notify_community_reaction();

drop trigger if exists community_comment_notifications on public.community_comments;
create trigger community_comment_notifications after insert on public.community_comments
  for each row execute function public.notify_community_reply();

alter table public.community_profiles enable row level security;
alter table public.community_moderators enable row level security;
alter table public.community_posts enable row level security;
alter table public.community_comments enable row level security;
alter table public.community_reactions enable row level security;
alter table public.community_follows enable row level security;
alter table public.community_reports enable row level security;
alter table public.community_notifications enable row level security;

create policy "Profiles are public, private auth data is not stored here"
  on public.community_profiles for select using (true);
create policy "Users manage their own public profile"
  on public.community_profiles for insert to authenticated with check (user_id = (select auth.uid()));
create policy "Users update their own public profile"
  on public.community_profiles for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "Users can see their moderator grant"
  on public.community_moderators for select to authenticated using (user_id = (select auth.uid()));

create policy "Published posts and own posts are readable"
  on public.community_posts for select
  using (visibility = 'published' or author_id = (select auth.uid()) or (select public.is_civicx_moderator()));
create policy "Authenticated users create their own posts"
  on public.community_posts for insert to authenticated with check (author_id = (select auth.uid()));
create policy "Authors and moderators update posts"
  on public.community_posts for update to authenticated
  using (author_id = (select auth.uid()) or (select public.is_civicx_moderator()))
  with check (author_id = (select auth.uid()) or (select public.is_civicx_moderator()));
create policy "Authors and moderators delete posts"
  on public.community_posts for delete to authenticated
  using (author_id = (select auth.uid()) or (select public.is_civicx_moderator()));

create policy "Published replies and own replies are readable"
  on public.community_comments for select
  using (visibility = 'published' or author_id = (select auth.uid()) or (select public.is_civicx_moderator()));
create policy "Authenticated users create their own replies"
  on public.community_comments for insert to authenticated with check (author_id = (select auth.uid()));
create policy "Authors and moderators update replies"
  on public.community_comments for update to authenticated
  using (author_id = (select auth.uid()) or (select public.is_civicx_moderator()))
  with check (author_id = (select auth.uid()) or (select public.is_civicx_moderator()));
create policy "Authors and moderators delete replies"
  on public.community_comments for delete to authenticated
  using (author_id = (select auth.uid()) or (select public.is_civicx_moderator()));

create policy "Users can see their own reaction state"
  on public.community_reactions for select to authenticated using (user_id = (select auth.uid()));
create policy "Users add their own reaction"
  on public.community_reactions for insert to authenticated with check (user_id = (select auth.uid()));
create policy "Users remove their own reaction"
  on public.community_reactions for delete to authenticated using (user_id = (select auth.uid()));
create policy "Follows are private to the follower"
  on public.community_follows for select to authenticated using (user_id = (select auth.uid()));
create policy "Users follow discussions"
  on public.community_follows for insert to authenticated with check (user_id = (select auth.uid()));
create policy "Users unfollow discussions"
  on public.community_follows for delete to authenticated using (user_id = (select auth.uid()));

create policy "Users submit and view their own reports; moderators review all"
  on public.community_reports for select to authenticated
  using (reporter_id = (select auth.uid()) or (select public.is_civicx_moderator()));
create policy "Authenticated users report content"
  on public.community_reports for insert to authenticated with check (reporter_id = (select auth.uid()));
create policy "Moderators review reports"
  on public.community_reports for update to authenticated
  using ((select public.is_civicx_moderator()))
  with check ((select public.is_civicx_moderator()));
create policy "Users read their own notifications"
  on public.community_notifications for select to authenticated using (user_id = (select auth.uid()));
create policy "Users mark their own notifications read"
  on public.community_notifications for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

grant select on public.community_profiles, public.community_posts, public.community_comments, public.community_reactions to anon, authenticated;
grant insert, update on public.community_profiles to authenticated;
grant insert, update, delete on public.community_posts, public.community_comments to authenticated;
grant select, insert, delete on public.community_reactions, public.community_follows to authenticated;
grant select, insert, update on public.community_reports to authenticated;
grant select, update on public.community_notifications to authenticated;
grant select on public.community_moderators to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('civicx-community', 'civicx-community', true, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set public = true, file_size_limit = 5242880, allowed_mime_types = excluded.allowed_mime_types;

create policy "Community images are publicly readable"
  on storage.objects for select using (bucket_id = 'civicx-community');
create policy "Users upload community images to their own folder"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'civicx-community'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );
create policy "Users remove their own community images"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'civicx-community'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'community_posts'
  ) then alter publication supabase_realtime add table public.community_posts; end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'community_comments'
  ) then alter publication supabase_realtime add table public.community_comments; end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'community_notifications'
  ) then alter publication supabase_realtime add table public.community_notifications; end if;
end $$;
