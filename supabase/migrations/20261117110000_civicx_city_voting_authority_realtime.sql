begin;

do $$
begin
  if to_regclass('public.civic_reports') is null
      or to_regclass('public.civic_jurisdictions') is null
      or to_regclass('public.civic_authority_jurisdictions') is null
      or to_regclass('public.civic_report_events') is null
      or to_regclass('public.civic_authorities') is null then
    raise exception 'Apply the CivicX report-repair migration before this feature migration.';
  end if;
  if to_regclass('public.community_posts') is null
      or to_regclass('public.community_reactions') is null then
    raise exception 'Apply the CivicX community migration before this feature migration.';
  end if;
end
$$;

alter table public.civic_jurisdictions
  add column if not exists center_latitude double precision,
  add column if not exists center_longitude double precision;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.civic_jurisdictions'::regclass
      and conname = 'civic_jurisdictions_center_coordinates_check'
  ) then
    alter table public.civic_jurisdictions
      add constraint civic_jurisdictions_center_coordinates_check check (
        (center_latitude is null and center_longitude is null)
        or (
          center_latitude is not null
          and center_longitude is not null
          and
          center_latitude between -90 and 90
          and center_longitude between -180 and 180
        )
      );
  end if;
end
$$;

create index if not exists civic_jurisdictions_active_display_name_idx
  on public.civic_jurisdictions (display_name)
  where is_active;

grant select on public.civic_reports, public.civic_report_events,
  public.civic_authorities, public.civic_authority_jurisdictions,
  public.civic_jurisdictions to service_role;

create or replace function public.validate_civic_report_submission()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  verified_jurisdiction_key text;
  matching_jurisdiction_count integer;
begin
  if auth.role() = 'authenticated' then
    if new.user_id is distinct from auth.uid() then
      raise exception 'A report must be linked to the signed-in account.';
    end if;

    if new.jurisdiction_key is null then
      select count(*), min(j.jurisdiction_key)
      into matching_jurisdiction_count, verified_jurisdiction_key
      from public.civic_jurisdictions j
      where j.is_active and j.display_name = btrim(new.city);
      if matching_jurisdiction_count <> 1 then
        raise exception 'Choose one active registered CivicX jurisdiction.';
      end if;
    else
      select j.jurisdiction_key
      into verified_jurisdiction_key
      from public.civic_jurisdictions j
      where j.jurisdiction_key = new.jurisdiction_key
        and j.display_name = btrim(new.city)
        and j.is_active;
      if verified_jurisdiction_key is null then
        raise exception 'The selected city and jurisdiction do not match an active registry entry.';
      end if;
    end if;
    new.jurisdiction_key := verified_jurisdiction_key;

    if new.status <> 'Prepared (awaiting user filing)'
        or new.registration_number is distinct from new.id
        or new.submission_state <> 'awaiting_user_filing'
        or new.status_source <> 'CivicX report preparation; not filed with an authority'
        or new.portal <> 'CPGRAMS'
        or new.official_portal_url <> 'https://pgportal.gov.in/Home/LodgeGrievance'
        or new.official_registration is not null
        or new.resolution_evidence_url is not null then
      raise exception 'CivicX reports must begin in the prepared state and cannot claim authority action.';
    end if;
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
        or p_status not in (
          'Pending', 'Submitted', 'Verified', 'Assigned', 'In progress', 'Resolved',
          'Cannot be Resolved', 'Closed', 'Rejected'
        )
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

alter table public.community_reactions
  add column if not exists vote smallint not null default 1;
alter table public.community_posts
  add column if not exists upvote_count integer not null default 0,
  add column if not exists downvote_count integer not null default 0;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.community_reactions'::regclass
      and conname = 'community_reactions_vote_check'
  ) then
    alter table public.community_reactions
      add constraint community_reactions_vote_check check (vote in (-1, 1));
  end if;
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.community_posts'::regclass
      and conname = 'community_posts_upvote_count_check'
  ) then
    alter table public.community_posts
      add constraint community_posts_upvote_count_check check (upvote_count >= 0);
  end if;
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.community_posts'::regclass
      and conname = 'community_posts_downvote_count_check'
  ) then
    alter table public.community_posts
      add constraint community_posts_downvote_count_check check (downvote_count >= 0);
  end if;
end
$$;

update public.community_posts p
set upvote_count = counts.upvotes,
    downvote_count = counts.downvotes,
    support_count = counts.upvotes
from (
  select p0.id,
    (count(r.post_id) filter (where r.vote = 1))::integer as upvotes,
    (count(r.post_id) filter (where r.vote = -1))::integer as downvotes
  from public.community_posts p0
  left join public.community_reactions r on r.post_id = p0.id
  group by p0.id
) counts
where p.id = counts.id;

create or replace function public.update_community_vote_counts()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    update public.community_posts
    set upvote_count = upvote_count + case when new.vote = 1 then 1 else 0 end,
        downvote_count = downvote_count + case when new.vote = -1 then 1 else 0 end,
        support_count = support_count + case when new.vote = 1 then 1 else 0 end
    where id = new.post_id;
    return new;
  elsif tg_op = 'DELETE' then
    update public.community_posts
    set upvote_count = greatest(0, upvote_count - case when old.vote = 1 then 1 else 0 end),
        downvote_count = greatest(0, downvote_count - case when old.vote = -1 then 1 else 0 end),
        support_count = greatest(0, support_count - case when old.vote = 1 then 1 else 0 end)
    where id = old.post_id;
    return old;
  end if;

  update public.community_posts
  set upvote_count = greatest(0, upvote_count - case when old.vote = 1 then 1 else 0 end)
      + case when new.vote = 1 then 1 else 0 end,
      downvote_count = greatest(0, downvote_count - case when old.vote = -1 then 1 else 0 end)
      + case when new.vote = -1 then 1 else 0 end,
      support_count = greatest(0, support_count - case when old.vote = 1 then 1 else 0 end)
      + case when new.vote = 1 then 1 else 0 end
  where id = new.post_id and new.post_id = old.post_id;
  if new.post_id is distinct from old.post_id then
    update public.community_posts
    set upvote_count = greatest(0, upvote_count - case when old.vote = 1 then 1 else 0 end),
        downvote_count = greatest(0, downvote_count - case when old.vote = -1 then 1 else 0 end),
        support_count = greatest(0, support_count - case when old.vote = 1 then 1 else 0 end)
    where id = old.post_id;
    update public.community_posts
    set upvote_count = upvote_count + case when new.vote = 1 then 1 else 0 end,
        downvote_count = downvote_count + case when new.vote = -1 then 1 else 0 end,
        support_count = support_count + case when new.vote = 1 then 1 else 0 end
    where id = new.post_id;
  end if;
  return new;
end;
$$;
revoke all on function public.update_community_vote_counts() from public, anon, authenticated;

drop trigger if exists community_reaction_count on public.community_reactions;
drop trigger if exists community_reaction_vote_counts on public.community_reactions;
create trigger community_reaction_vote_counts
  after insert or update of post_id, vote or delete on public.community_reactions
  for each row execute function public.update_community_vote_counts();

drop policy if exists "Users change their own reaction" on public.community_reactions;
create policy "Users change their own reaction"
  on public.community_reactions for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
grant select, insert, update, delete on public.community_reactions to authenticated;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'civic_reports'
  ) then
    alter publication supabase_realtime add table public.civic_reports;
  end if;
end
$$;

notify pgrst, 'reload schema';
commit;
