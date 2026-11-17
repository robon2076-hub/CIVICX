begin;

do $$
begin
  if to_regclass('public.civic_reports') is null
      or to_regclass('public.community_posts') is null
      or to_regclass('public.community_profiles') is null then
    raise exception 'Apply the CivicX report and Community migrations before the public map migration.';
  end if;
end
$$;

create index if not exists civic_reports_map_coordinates_idx
  on public.civic_reports (latitude, longitude)
  where latitude is not null and longitude is not null;

create index if not exists community_posts_public_linked_report_idx
  on public.community_posts (linked_report_id)
  where visibility = 'published' and linked_report_id is not null;

create or replace view public.civicx_public_map_reports
with (security_barrier = true)
as
select distinct on (report.id)
  post.id as community_post_id,
  post.category,
  left(post.body, 600) as description,
  post.city,
  post.locality,
  report.status,
  report.created_at as report_date,
  report.latitude,
  report.longitude,
  coalesce(profile.display_name, 'CivicX neighbour') as display_name,
  (post.image_path is not null) as has_photo
from public.civic_reports as report
join public.community_posts as post
  on post.linked_report_id = report.id
 and post.visibility = 'published'
left join public.community_profiles as profile
  on profile.user_id = post.author_id
where report.latitude is not null
  and report.longitude is not null
order by report.id, post.created_at desc, post.id;

revoke all on public.civicx_public_map_reports from public, anon, authenticated;
grant select on public.civicx_public_map_reports to anon, authenticated;

notify pgrst, 'reload schema';
commit;
