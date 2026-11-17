begin;

do $$
begin
  if to_regclass('public.civic_reports') is null
    or to_regclass('public.civic_report_events') is null
    or to_regclass('public.civic_authorities') is null
    or to_regclass('public.civic_jurisdictions') is null
    or to_regclass('public.civic_authority_jurisdictions') is null then
    raise exception 'Apply and verify the CivicX report schema repair before granting portal read access.';
  end if;
end;
$$;

grant select on public.civic_reports,
  public.civic_report_events,
  public.civic_authorities,
  public.civic_jurisdictions,
  public.civic_authority_jurisdictions
to service_role;

commit;
