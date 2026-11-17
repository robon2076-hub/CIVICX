begin;

do $$
begin
  if to_regclass('public.civic_reports') is null
      or to_regclass('public.community_posts') is null
      or to_regclass('public.community_profiles') is null then
    raise exception 'Apply the CivicX report and Community migrations before the cross-post migration.';
  end if;
end
$$;

alter table public.civic_reports
  drop constraint if exists civic_reports_category_check;

alter table public.civic_reports
  add constraint civic_reports_category_check check (category in (
    'Pothole', 'Garbage', 'Water leakage', 'Streetlight', 'Electricity related problem'
  ));

create or replace function public.create_civic_report_with_community_post(
  p_report jsonb,
  p_community_category text,
  p_community_display_name text,
  p_community_locality text,
  p_community_photo_path text
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  report_input record;
  report_row public.civic_reports%rowtype;
  profile_row public.community_profiles%rowtype;
  existing_post_id uuid;
  community_post_id uuid;
  community_body text;
begin
  if auth.uid() is null then
    raise exception 'Sign in before creating a report and Community post.' using errcode = '42501';
  end if;
  if p_report is null or jsonb_typeof(p_report) <> 'object' then
    raise exception 'A valid report is required.' using errcode = '22023';
  end if;
  if exists (
    select 1
    from jsonb_object_keys(p_report) as fields(field_name)
    where field_name not in (
      'id', 'category', 'title', 'city', 'location', 'area', 'description',
      'latitude', 'longitude', 'priority', 'jurisdiction_key', 'photo_path'
    )
  ) then
    raise exception 'The report contains unsupported fields.' using errcode = '22023';
  end if;

  select *
  into report_input
  from jsonb_to_record(p_report) as input(
    id text,
    category text,
    title text,
    city text,
    location text,
    area text,
    description text,
    latitude double precision,
    longitude double precision,
    priority text,
    jurisdiction_key text,
    photo_path text
  );

  if report_input.id is null
      or report_input.category is null
      or report_input.title is null
      or report_input.city is null
      or report_input.location is null
      or report_input.area is null
      or report_input.description is null
      or report_input.latitude is null
      or report_input.longitude is null
      or report_input.priority is null then
    raise exception 'Complete the report details before cross-posting.' using errcode = '22023';
  end if;
  if report_input.id !~ '^CX-[A-Za-z0-9-]{1,77}$' then
    raise exception 'The report reference is invalid.' using errcode = '22023';
  end if;
  if char_length(btrim(report_input.city)) > 80 then
    raise exception 'The selected city is too long to use in a Community post.' using errcode = '22023';
  end if;
  if report_input.photo_path is not null
      and report_input.photo_path <> (auth.uid()::text || '/' || report_input.id || '/issue-photo.jpg') then
    raise exception 'The report photo path is invalid.' using errcode = '22023';
  end if;
  if report_input.photo_path is null and p_community_photo_path is not null then
    raise exception 'A Community photo must come from the redacted report photo.' using errcode = '22023';
  end if;
  if report_input.photo_path is not null and (
      p_community_photo_path is null
      or p_community_photo_path !~* (
        '^' || auth.uid()::text || '/[A-Za-z0-9-]{36}[.](jpg|png|webp)$'
      )
    ) then
    raise exception 'The public Community photo path is invalid.' using errcode = '22023';
  end if;

  community_body := 'Title: ' || btrim(report_input.title) || E'\n\n' || btrim(report_input.description);
  if char_length(community_body) not between 10 and 3000 then
    raise exception 'The Community post must be between 10 and 3000 characters.' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(report_input.id, 0));
  select *
  into report_row
  from public.civic_reports
  where id = report_input.id
  for update;

  if found then
    if report_row.user_id is distinct from auth.uid() then
      raise exception 'This report reference is already in use.' using errcode = '23505';
    end if;
    select id
    into existing_post_id
    from public.community_posts
    where linked_report_id = report_input.id
      and author_id = auth.uid()
    order by created_at
    limit 1;
    if existing_post_id is not null then
      return jsonb_build_object(
        'report_id', report_row.id,
        'community_post_id', existing_post_id,
        'already_created', true
      );
    end if;
    raise exception 'This report reference has already been used; no duplicate was created.' using errcode = '23505';
  end if;

  select *
  into profile_row
  from public.community_profiles
  where user_id = auth.uid()
  for update;

  if not found then
    if p_community_display_name is null
        or char_length(btrim(p_community_display_name)) not between 2 and 40
        or p_community_locality is null
        or char_length(btrim(p_community_locality)) not between 2 and 80 then
      raise exception 'Enter a Community display name and broad locality.' using errcode = '22023';
    end if;
    insert into public.community_profiles (user_id, display_name, city, locality)
    values (
      auth.uid(),
      btrim(p_community_display_name),
      btrim(report_input.city),
      btrim(p_community_locality)
    )
    returning * into profile_row;
  end if;

  insert into public.civic_reports (
    id, user_id, category, title, city, location, area, description,
    latitude, longitude, priority, registration_number, jurisdiction_key, photo_path
  )
  values (
    btrim(report_input.id),
    auth.uid(),
    btrim(report_input.category),
    btrim(report_input.title),
    btrim(report_input.city),
    btrim(report_input.location),
    btrim(report_input.area),
    btrim(report_input.description),
    report_input.latitude,
    report_input.longitude,
    btrim(report_input.priority),
    btrim(report_input.id),
    nullif(btrim(report_input.jurisdiction_key), ''),
    report_input.photo_path
  );

  insert into public.community_posts (
    author_id, category, city, locality, body, image_path, linked_report_id, visibility
  )
  values (
    auth.uid(),
    btrim(p_community_category),
    btrim(report_input.city),
    profile_row.locality,
    community_body,
    p_community_photo_path,
    btrim(report_input.id),
    'published'
  )
  returning id into community_post_id;

  return jsonb_build_object(
    'report_id', btrim(report_input.id),
    'community_post_id', community_post_id,
    'already_created', false
  );
end;
$$;

revoke all on function public.create_civic_report_with_community_post(jsonb, text, text, text, text)
  from public, anon, service_role;
grant execute on function public.create_civic_report_with_community_post(jsonb, text, text, text, text)
  to authenticated;

notify pgrst, 'reload schema';
commit;
