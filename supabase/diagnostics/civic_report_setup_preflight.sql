-- Strictly read-only preflight. Run this in the SQL Editor of CivicX's configured
-- Supabase project. It reads catalogs and rows, and emits NOTICE counts only.
-- Do not run the repair unless all schema/data/policy findings have been reviewed.
-- Jurisdiction registry, report assignments, and authority assignments are not
-- seeded by the repair; missing or inactive records intentionally deny authority access.

-- 0. PostgREST exposure. public must be exposed for the app's public tables.
select
  current_setting('pgrst.db_schemas', true) as postgrest_exposed_schemas,
  case
    when current_setting('pgrst.db_schemas', true) is null then 'STOP_CANNOT_VERIFY_POSTGREST_EXPOSURE'
    when not (string_to_array(current_setting('pgrst.db_schemas', true), ',') @> array['public'])
      then 'STOP_PUBLIC_SCHEMA_NOT_EXPOSED'
    else 'PUBLIC_SCHEMA_EXPOSED'
  end as result;

-- 0a. The repair creates pgcrypto if it is absent. This only inspects the
-- extension catalog and whether the current SQL role can create extensions.
select
  expected.extension_name,
  n.nspname as installed_schema,
  has_database_privilege(current_user, current_database(), 'CREATE') as can_create_in_database,
  case
    when e.oid is null then 'MISSING_REPAIR_ATTEMPTS_CREATE_REVIEW_PRIVILEGE'
    when n.nspname <> 'public' then 'PRESENT_NONPUBLIC_SCHEMA_REVIEW'
    else 'PRESENT'
  end as result
from (values ('pgcrypto'::text)) expected(extension_name)
left join pg_extension e on e.extname = expected.extension_name
left join pg_namespace n on n.oid = e.extnamespace;

-- 1. Locate target names in every schema, including the authority allowlist and
-- jurisdiction registry/assignment tables.
with expected(relation_name) as (
  values
    ('complaint_tracking'),
    ('civic_reports'),
    ('civic_report_events'),
    ('civic_authorities'),
    ('civic_jurisdictions'),
    ('civic_authority_jurisdictions')
)
select
  e.relation_name,
  n.nspname as schema_name,
  c.relkind as relation_kind,
  c.relrowsecurity as rls_enabled,
  c.relforcerowsecurity as rls_forced,
  case
    when c.oid is null then 'MISSING_REPAIR_CREATES_PUBLIC_TABLE'
    when n.nspname <> 'public' then 'STOP_SAME_NAME_OUTSIDE_PUBLIC'
    when c.relkind not in ('r', 'p') then 'STOP_PUBLIC_OBJECT_IS_NOT_A_TABLE'
    else 'PUBLIC_TABLE_REVIEW_SCHEMA'
  end as result
from expected e
left join pg_class c
  on c.relname = e.relation_name
  and c.relkind in ('r', 'p', 'v', 'm', 'f')
left join pg_namespace n on n.oid = c.relnamespace
order by e.relation_name, n.nspname;

-- 2. Compare existing public columns with the repair's expected type/nullability.
with expected(table_name, column_name, udt_name, is_nullable) as (
  values
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
)
select
  e.table_name,
  e.column_name,
  e.udt_name as expected_udt_name,
  e.is_nullable as expected_is_nullable,
  c.udt_name as actual_udt_name,
  c.is_nullable as actual_is_nullable,
  c.column_default,
  case
    when to_regclass(format('public.%I', e.table_name)) is null then 'TABLE_MISSING'
    when c.column_name is null and e.table_name = 'civic_reports'
        and e.column_name = 'jurisdiction_key' then 'MISSING_COLUMN_REPAIR_ADDS_IT'
    when c.column_name is null then 'MISSING_COLUMN'
    when c.udt_name <> e.udt_name or c.is_nullable <> e.is_nullable then 'TYPE_OR_NULLABILITY_MISMATCH'
    else 'OK'
  end as result
from expected e
left join information_schema.columns c
  on c.table_schema = 'public'
  and c.table_name = e.table_name
  and c.column_name = e.column_name
order by e.table_name, e.column_name;

with expected(table_name, column_name) as (
  select 'complaint_tracking', unnest(array[
    'id','user_id','report_id','city','portal','registration_number','portal_status',
    'status_remarks','status_date','official_document_url','checked_at','created_at','updated_at'
  ]::text[])
  union all
  select 'civic_reports', unnest(array[
    'id','user_id','category','title','city','location','area','description','latitude',
    'longitude','status','priority','registration_number','submission_state','status_source',
    'portal','official_portal_url','official_registration','photo_path','jurisdiction_key',
    'resolution_evidence_url','created_at','updated_at'
  ]::text[])
  union all
  select 'civic_report_events', unnest(array[
    'id','report_id','actor_user_id','actor_kind','event_type','summary','details','metadata','created_at'
  ]::text[])
  union all
  select 'civic_authorities', unnest(array['user_id','is_active','created_at']::text[])
  union all
  select 'civic_jurisdictions', unnest(array[
    'jurisdiction_key','display_name','is_active','created_at'
  ]::text[])
  union all
  select 'civic_authority_jurisdictions', unnest(array[
    'authority_user_id','jurisdiction_key','created_at'
  ]::text[])
)
select
  c.table_name,
  c.column_name,
  c.udt_name,
  c.is_nullable,
  c.column_default,
  'REVIEW_EXTRA_COLUMN_REPAIR_PRESERVES_IT_AND_IT_MAY_AFFECT_WRITES' as result
from information_schema.columns c
where c.table_schema = 'public'
  and c.table_name in (
    'complaint_tracking', 'civic_reports', 'civic_report_events', 'civic_authorities',
    'civic_jurisdictions', 'civic_authority_jurisdictions'
  )
  and not exists (
    select 1
    from expected e
    where e.table_name = c.table_name
      and e.column_name = c.column_name
  )
order by c.table_name, c.column_name;

-- 3. All existing constraints, including checks, uniqueness, PKs and FK actions.
select
  n.nspname as schema_name,
  rel.relname as table_name,
  con.conname as constraint_name,
  con.contype as constraint_type,
  con.convalidated as is_validated,
  pg_get_constraintdef(con.oid, true) as definition
from pg_constraint con
join pg_class rel on rel.oid = con.conrelid
join pg_namespace n on n.oid = rel.relnamespace
where rel.relname in (
  'complaint_tracking', 'civic_reports', 'civic_report_events', 'civic_authorities',
  'civic_jurisdictions', 'civic_authority_jurisdictions'
)
order by n.nspname, rel.relname, con.conname;

-- 3a. Expected key/check/unique constraints. For every existing definition,
-- compare it with the local migration; any mismatch is a STOP because this
-- repair does not replace these constraints.
with expected(table_name, constraint_name, constraint_type) as (
  values
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
)
select
  e.table_name,
  e.constraint_name,
  case
    when rel.oid is null then 'TABLE_MISSING'
    when con.oid is null then 'STOP_MISSING_CONSTRAINT_MIGRATION_PREFLIGHT_ABORTS'
    when not con.convalidated then 'STOP_CONSTRAINT_NOT_VALIDATED'
    when con.contype::text <> e.constraint_type then 'STOP_CONSTRAINT_TYPE_MISMATCH'
    else 'STOP_IF_DEFINITION_DIFFERS_REPAIR_DOES_NOT_REPLACE_CONSTRAINT'
  end as result,
  pg_get_constraintdef(con.oid, true) as actual_definition
from expected e
left join pg_class rel
  on rel.oid = to_regclass(format('public.%I', e.table_name))
left join pg_constraint con
  on con.conrelid = rel.oid
  and con.conname = e.constraint_name
order by e.table_name, e.constraint_name;

-- Any other constraint is preserved by the repair and can still block writes.
select
  n.nspname as schema_name,
  rel.relname as table_name,
  con.conname as constraint_name,
  con.contype as constraint_type,
  con.convalidated as is_validated,
  pg_get_constraintdef(con.oid, true) as definition,
  'REVIEW_UNEXPECTED_CONSTRAINT_REPAIR_DOES_NOT_REMOVE_IT' as result
from pg_constraint con
join pg_class rel on rel.oid = con.conrelid
join pg_namespace n on n.oid = rel.relnamespace
where n.nspname = 'public'
  and rel.relname in (
    'complaint_tracking', 'civic_reports', 'civic_report_events', 'civic_authorities',
    'civic_jurisdictions', 'civic_authority_jurisdictions'
  )
  and con.conname not in (
    'complaint_tracking_pkey',
    'complaint_tracking_report_id_check',
    'complaint_tracking_city_check',
    'complaint_tracking_portal_check',
    'complaint_tracking_registration_number_check',
    'complaint_tracking_portal_status_check',
    'complaint_tracking_status_remarks_check',
    'complaint_tracking_official_document_url_check',
    'complaint_tracking_user_id_portal_registration_number_key',
    'complaint_tracking_user_id_fkey',
    'civic_reports_pkey',
    'civic_reports_id_check',
    'civic_reports_category_check',
    'civic_reports_title_check',
    'civic_reports_city_check',
    'civic_reports_location_check',
    'civic_reports_area_check',
    'civic_reports_description_check',
    'civic_reports_latitude_check',
    'civic_reports_longitude_check',
    'civic_reports_priority_check',
    'civic_reports_resolution_evidence_url_check',
    'civic_reports_user_id_fkey',
    'civic_reports_jurisdiction_key_fkey',
    'civic_report_events_pkey',
    'civic_report_events_actor_kind_check',
    'civic_report_events_event_type_check',
    'civic_report_events_summary_check',
    'civic_report_events_details_check',
    'civic_report_events_report_id_fkey',
    'civic_report_events_actor_user_id_fkey',
    'civic_authorities_pkey',
    'civic_authorities_user_id_fkey',
    'civic_jurisdictions_pkey',
    'civic_jurisdictions_jurisdiction_key_check',
    'civic_jurisdictions_display_name_check',
    'civic_authority_jurisdictions_pkey',
    'civic_authority_jurisdictions_authority_user_id_fkey',
    'civic_authority_jurisdictions_jurisdiction_key_fkey'
  )
order by n.nspname, rel.relname, con.conname;

-- 3b. Match the migration's exact FK behavior: it inspects single-column FKs
-- on each expected source column, aborts on a different referenced relation,
-- replaces same-relation FKs only when ON DELETE is not RESTRICT, and otherwise
-- leaves them untouched. Any replacement can change existing referential behavior.
with expected(table_name, column_name, target_schema, target_table, target_column) as (
  values
    ('complaint_tracking','user_id','auth','users','id'),
    ('civic_reports','user_id','auth','users','id'),
    ('civic_report_events','report_id','public','civic_reports','id'),
    ('civic_report_events','actor_user_id','auth','users','id'),
    ('civic_authorities','user_id','auth','users','id'),
    ('civic_reports','jurisdiction_key','public','civic_jurisdictions','jurisdiction_key'),
    ('civic_authority_jurisdictions','authority_user_id','public','civic_authorities','user_id'),
    ('civic_authority_jurisdictions','jurisdiction_key','public','civic_jurisdictions','jurisdiction_key')
)
select
  e.table_name,
  e.column_name,
  e.target_schema,
  e.target_table,
  e.target_column,
  con.conname as actual_constraint,
  con.conkey = array[source_col.attnum]::smallint[] as is_single_column_fk,
  ref_ns.nspname as actual_target_schema,
  ref.relname as actual_target_table,
  ref_col.attname as actual_target_column,
  con.convalidated as is_validated,
  con.confdeltype as delete_action_code,
  con.confupdtype as update_action_code,
  con.confmatchtype as match_type_code,
  con.condeferrable as is_deferrable,
  pg_get_constraintdef(con.oid, true) as actual_definition,
  case
    when to_regclass(format('public.%I', e.table_name)) is null then 'TABLE_MISSING'
    when con.oid is null then 'MISSING_FOREIGN_KEY_REPAIR_CREATES_IT'
    when con.conkey <> array[source_col.attnum]::smallint[]
      then 'STOP_MANUAL_REVIEW_COMPOSITE_FK_IS_NOT_HANDLED_BY_REPAIR_LOOP'
    when ref_ns.nspname <> e.target_schema
      or ref.relname <> e.target_table then 'STOP_FOREIGN_KEY_TARGET_MISMATCH_REPAIR_ABORTS'
    when con.confdeltype <> 'r'
      then 'REPAIR_REPLACES_SAME_RELATION_FK_REVIEW_REFERENTIAL_BEHAVIOR_CHANGE'
    when ref_col.attname <> e.target_column then 'STOP_WRONG_REFERENCED_COLUMN_REPAIR_LEAVES_RESTRICT_FK_UNCHANGED'
    when not con.convalidated then 'STOP_UNVALIDATED_RESTRICT_FK_REPAIR_LEAVES_IT_UNCHANGED'
    when con.confupdtype <> 'a'
      or con.confmatchtype <> 's'
      or con.condeferrable then 'STOP_ACTION_OR_DEFERRABILITY_MISMATCH_REPAIR_LEAVES_RESTRICT_FK_UNCHANGED'
    else 'COMPATIBLE_RESTRICT_FK_REPAIR_LEAVES_IT_UNCHANGED'
  end as result
from expected e
left join pg_class source_rel
  on source_rel.oid = to_regclass(format('public.%I', e.table_name))
left join pg_attribute source_col
  on source_col.attrelid = source_rel.oid
  and source_col.attname = e.column_name
  and not source_col.attisdropped
left join lateral (
  select c.*
  from pg_constraint c
  where c.conrelid = source_rel.oid
    and c.contype = 'f'
    and source_col.attnum = any(c.conkey)
) con on true
left join pg_class ref on ref.oid = con.confrelid
left join pg_namespace ref_ns on ref_ns.oid = ref.relnamespace
left join pg_attribute ref_col
  on ref_col.attrelid = ref.oid
  and ref_col.attnum = con.confkey[1]
  and not ref_col.attisdropped
order by e.table_name, e.column_name, con.conname;

-- 4. Existing and expected indexes. A same-named index with a different definition
-- must be reviewed because CREATE INDEX IF NOT EXISTS will not correct it.
select schemaname, tablename, indexname, indexdef
from pg_indexes
where tablename in (
  'complaint_tracking', 'civic_reports', 'civic_report_events', 'civic_jurisdictions',
  'civic_authority_jurisdictions'
)
order by schemaname, tablename, indexname;

with expected(table_name, index_name, expected_definition) as (
  values
    ('complaint_tracking','complaint_tracking_user_updated_idx',
      'create index complaint_tracking_user_updated_idx on public.complaint_tracking using btree (user_id, updated_at desc)'),
    ('civic_reports','civic_reports_user_created_idx',
      'create index civic_reports_user_created_idx on public.civic_reports using btree (user_id, created_at desc)'),
    ('civic_report_events','civic_report_events_report_created_idx',
      'create index civic_report_events_report_created_idx on public.civic_report_events using btree (report_id, created_at)')
)
select
  e.table_name,
  e.index_name,
  e.expected_definition,
  tbl.relname as actual_table,
  pg_get_indexdef(idx.oid) as actual_definition,
  ix.indisvalid as is_valid,
  ix.indisready as is_ready,
  ix.indislive as is_live,
  case
    when idx.oid is not null and tbl.relname <> e.table_name then 'STOP_INDEX_ON_WRONG_TABLE'
    when to_regclass(format('public.%I', e.table_name)) is null then 'TABLE_MISSING'
    when idx.oid is null then 'MISSING_INDEX'
    when not ix.indisvalid or not ix.indisready or not ix.indislive then 'STOP_INDEX_NOT_USABLE'
    when regexp_replace(lower(pg_get_indexdef(idx.oid)), '[[:space:]]', '', 'g')
      <> regexp_replace(e.expected_definition, '[[:space:]]', '', 'g')
      then 'STOP_INDEX_DEFINITION_MISMATCH_REPAIR_WILL_NOT_REPLACE_IT'
    else 'PRESENT_AS_EXPECTED'
  end as result
from expected e
left join pg_class idx
  on idx.relnamespace = 'public'::regnamespace
  and idx.relname = e.index_name
  and idx.relkind = 'i'
left join pg_index ix on ix.indexrelid = idx.oid
left join pg_class tbl on tbl.oid = ix.indrelid
order by e.table_name, e.index_name;

select
  expected.index_name,
  c.relkind as conflicting_relation_kind,
  'STOP_INDEX_NAME_OCCUPIED_BY_NONINDEX_REPAIR_IF_NOT_EXISTS_WILL_NOT_CREATE_INDEX' as result
from (values
  ('complaint_tracking_user_updated_idx'::text),
  ('civic_reports_user_created_idx'::text),
  ('civic_report_events_report_created_idx'::text)
) expected(index_name)
join pg_class c
  on c.relnamespace = 'public'::regnamespace
  and c.relname = expected.index_name
where c.relkind <> 'i';

-- 5. Non-internal triggers. The repair replaces three named civic_reports triggers;
-- other triggers need review because they can change writes or audit behavior.
select
  n.nspname as schema_name,
  rel.relname as table_name,
  trg.tgname as trigger_name,
  pg_get_triggerdef(trg.oid, true) as definition,
  case
    when n.nspname <> 'public' then 'STOP_TRIGGER_ON_SAME_NAME_OUTSIDE_PUBLIC'
    when rel.relname = 'civic_reports'
      and trg.tgname in (
        'civic_report_submission_valid',
        'civic_report_submission_history',
        'civic_report_authority_history'
      ) then 'REPAIR_REPLACES_TRIGGER_REVIEW_DEFINITION'
    else 'STOP_UNEXPECTED_TRIGGER_MIGRATION_PREFLIGHT_ABORTS'
  end as result
from pg_trigger trg
join pg_class rel on rel.oid = trg.tgrelid
join pg_namespace n on n.oid = rel.relnamespace
where not trg.tgisinternal
  and rel.relname in (
    'complaint_tracking', 'civic_reports', 'civic_report_events', 'civic_authorities',
    'civic_jurisdictions', 'civic_authority_jurisdictions'
  )
order by n.nspname, rel.relname, trg.tgname;

with expected(table_name, trigger_name) as (
  values
    ('civic_reports','civic_report_submission_valid'),
    ('civic_reports','civic_report_submission_history'),
    ('civic_reports','civic_report_authority_history')
)
select
  e.table_name,
  e.trigger_name,
  case
    when to_regclass(format('public.%I', e.table_name)) is null then 'TABLE_MISSING'
    when trg.oid is null then 'MISSING_TRIGGER_REPAIR_CREATES_IT'
    else 'PRESENT_REPAIR_REPLACES_IT'
  end as result,
  pg_get_triggerdef(trg.oid, true) as actual_definition
from expected e
left join pg_trigger trg
  on trg.tgrelid = to_regclass(format('public.%I', e.table_name))
  and trg.tgname = e.trigger_name
  and not trg.tgisinternal
order by e.table_name, e.trigger_name;

-- 5a. Functions the repair creates or replaces. CREATE OR REPLACE cannot
-- change an existing function's return type, and it retains owner/ACL details
-- that are not explicitly changed by the migration. Do not output function bodies.
with expected(
  function_name, signature, result_type, security_definer, volatility, service_role_execute
) as (
  values
    ('validate_civic_report_submission','public.validate_civic_report_submission()','trigger',false,'v',false),
    ('record_civic_report_submission','public.record_civic_report_submission()','trigger',true,'v',false),
    ('record_civic_report_authority_update','public.record_civic_report_authority_update()','trigger',true,'v',false),
    ('civic_authority_can_access_report','public.civic_authority_can_access_report(uuid,text)','boolean',true,'s',true),
    ('apply_civic_report_authority_action',
      'public.apply_civic_report_authority_action(text,uuid,text,text,text,text,text)','jsonb',true,'v',true)
)
select
  e.function_name,
  e.signature as expected_signature,
  e.result_type as expected_result_type,
  e.security_definer as expected_security_definer,
  e.volatility as expected_volatility_code,
  e.service_role_execute as expected_service_role_execute,
  p.oid::regprocedure as actual_signature,
  pg_get_function_result(p.oid) as actual_result_type,
  l.lanname as actual_language,
  p.prosecdef as actual_security_definer,
  p.provolatile as actual_volatility_code,
  pg_get_userbyid(p.proowner) as current_owner,
  current_user as preflight_role,
  p.proconfig as actual_function_settings,
  p.proacl as current_acl,
  coalesce((
    select bool_or(a.grantee = 0 and a.privilege_type = 'EXECUTE')
    from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
  ), false) as public_can_execute,
  coalesce((
    select array_agg(r.rolname order by r.rolname)
    from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
    join pg_roles r on r.oid = a.grantee
    where a.privilege_type = 'EXECUTE'
      and a.grantee not in (
        p.proowner,
        (select oid from pg_roles where rolname = 'anon'),
        (select oid from pg_roles where rolname = 'authenticated'),
        (select oid from pg_roles where rolname = 'service_role')
      )
  ), array[]::name[]) as other_execute_grantees,
  has_function_privilege('anon', p.oid, 'EXECUTE') as anon_can_execute,
  has_function_privilege('authenticated', p.oid, 'EXECUTE') as authenticated_can_execute,
  has_function_privilege('service_role', p.oid, 'EXECUTE') as service_role_can_execute,
  coalesce((
    select count(*)
    from pg_proc other_proc
    join pg_namespace other_ns on other_ns.oid = other_proc.pronamespace
    where other_ns.nspname = 'public'
      and other_proc.proname = e.function_name
  ), 0) as overload_count,
  case
    when p.oid is null and coalesce((
      select count(*)
      from pg_proc other_proc
      join pg_namespace other_ns on other_ns.oid = other_proc.pronamespace
      where other_ns.nspname = 'public'
        and other_proc.proname = e.function_name
    ), 0) > 0 then 'STOP_SIGNATURE_MISMATCH_EXISTING_OVERLOAD_REVIEW'
    when p.oid is null then 'MISSING_REPAIR_CREATES_FUNCTION'
    when (
      select count(*)
      from pg_proc other_proc
      join pg_namespace other_ns on other_ns.oid = other_proc.pronamespace
      where other_ns.nspname = 'public'
        and other_proc.proname = e.function_name
    ) > 1 then 'STOP_OVERLOADED_PUBLIC_FUNCTION_NAME'
    when pg_get_function_result(p.oid) <> e.result_type
      then 'STOP_RETURN_TYPE_MISMATCH_CREATE_OR_REPLACE_WILL_FAIL'
    when p.prosecdef <> e.security_definer
      then 'STOP_SECURITY_MODE_MISMATCH_REVIEW_BEFORE_REPLACEMENT'
    when p.provolatile <> e.volatility
      then 'STOP_VOLATILITY_MISMATCH_REVIEW_BEFORE_REPLACEMENT'
    when l.lanname <> 'plpgsql'
      then 'STOP_LANGUAGE_MISMATCH_REVIEW_REPLACEMENT'
    when p.proconfig is distinct from array['search_path=""']::text[]
      then 'STOP_FUNCTION_SETTINGS_DIFFER_REPAIR_REPLACES_SETTINGS'
    when p.proowner <> (select oid from pg_roles where rolname = current_user)
      then 'STOP_FUNCTION_OWNER_DIFFERS_REPAIR_RETAINS_EXISTING_OWNER'
    when coalesce((
      select bool_or(a.grantee = 0 and a.privilege_type = 'EXECUTE')
      from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
    ), false)
      or has_function_privilege('anon', p.oid, 'EXECUTE')
      or has_function_privilege('authenticated', p.oid, 'EXECUTE')
      then 'STOP_BROWSER_EXECUTE_REVIEW_MIGRATION_ACL_EFFECT'
    when cardinality(coalesce((
      select array_agg(r.rolname order by r.rolname)
      from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
      join pg_roles r on r.oid = a.grantee
      where a.privilege_type = 'EXECUTE'
        and a.grantee not in (
          p.proowner,
          (select oid from pg_roles where rolname = 'anon'),
          (select oid from pg_roles where rolname = 'authenticated'),
          (select oid from pg_roles where rolname = 'service_role')
        )
    ), array[]::name[])) > 0
      then 'STOP_UNEXPECTED_FUNCTION_EXECUTE_GRANT_IS_RETAINED'
    when e.service_role_execute and not has_function_privilege('service_role', p.oid, 'EXECUTE')
      then 'MIGRATION_GRANTS_SERVICE_ROLE_EXECUTE'
    when not e.service_role_execute and has_function_privilege('service_role', p.oid, 'EXECUTE')
      then 'STOP_SERVICE_ROLE_EXECUTE_GRANT_IS_RETAINED'
    else 'FUNCTION_SIGNATURE_SECURITY_SETTINGS_OWNER_AND_EFFECTIVE_ACL_MATCH'
  end as result
from expected e
left join pg_proc p on p.oid = to_regprocedure(e.signature)::oid
left join pg_language l on l.oid = p.prolang
order by e.function_name;

-- 6. Effective table grants. Compare with the intended permissions before applying.
select table_schema, table_name, grantee, privilege_type, is_grantable
from information_schema.role_table_grants
where table_schema = 'public'
  and table_name in (
    'complaint_tracking', 'civic_reports', 'civic_report_events', 'civic_authorities',
    'civic_jurisdictions', 'civic_authority_jurisdictions'
  )
order by table_name, grantee, privilege_type;

-- Table-level REVOKE does not remove column-specific grants. These persist
-- unless explicitly revoked, so every existing grant needs review.
select
  table_schema,
  table_name,
  column_name,
  grantee,
  privilege_type,
  is_grantable,
  'STOP_REVIEW_COLUMN_GRANT_REPAIR_TABLE_REVOKE_DOES_NOT_REMOVE_IT' as result
from information_schema.column_privileges
where table_schema = 'public'
  and table_name in (
    'complaint_tracking', 'civic_reports', 'civic_report_events', 'civic_authorities',
    'civic_jurisdictions', 'civic_authority_jurisdictions'
  )
order by table_name, column_name, grantee, privilege_type;

-- Future tables inherit the migration role's default ACLs. The repair revokes
-- known roles, but custom-role grants may remain on newly created tables.
select
  pg_get_userbyid(d.defaclrole) as default_acl_owner,
  coalesce(n.nspname, '<all schemas>') as default_acl_schema,
  case when acl.grantee = 0 then 'PUBLIC' else grantee_role.rolname end as grantee,
  acl.privilege_type,
  acl.is_grantable,
  case
    when acl.grantee = 0
      or grantee_role.rolname in ('anon', 'authenticated', 'service_role')
      then 'REVIEW_KNOWN_ROLE_DEFAULT_REVOKED_BY_REPAIR'
    else 'STOP_CUSTOM_ROLE_DEFAULT_GRANT_MAY_REMAIN'
  end as result
from pg_default_acl d
cross join lateral aclexplode(d.defaclacl) acl
left join pg_namespace n on n.oid = d.defaclnamespace
left join pg_roles grantee_role on grantee_role.oid = acl.grantee
where d.defaclrole = (select oid from pg_roles where rolname = current_user)
  and d.defaclobjtype = 'r'
  and (d.defaclnamespace = 0 or n.nspname = 'public')
order by default_acl_schema, grantee, acl.privilege_type;

select
  table_name,
  grantee,
  privilege_type,
  is_grantable,
  'STOP_REVIEW_BROWSER_OR_SERVICE_ROLE_TABLE_GRANT' as result
from information_schema.role_table_grants
where table_schema = 'public'
  and table_name in ('civic_jurisdictions', 'civic_authority_jurisdictions')
  and grantee in ('anon', 'authenticated', 'service_role', 'PUBLIC')
  and not (grantee = 'service_role' and privilege_type = 'SELECT')
order by table_name, grantee, privilege_type;

with expected(table_name, grantee, privilege_type) as (
  values
    ('complaint_tracking','authenticated','SELECT'),
    ('complaint_tracking','authenticated','INSERT'),
    ('complaint_tracking','authenticated','UPDATE'),
    ('civic_reports','authenticated','SELECT'),
    ('civic_reports','authenticated','INSERT'),
    ('civic_report_events','authenticated','SELECT'),
    ('civic_report_events','authenticated','INSERT'),
    ('civic_authorities','service_role','SELECT'),
    ('civic_reports','service_role','SELECT'),
    ('civic_report_events','service_role','SELECT'),
    ('civic_jurisdictions','service_role','SELECT'),
    ('civic_authority_jurisdictions','service_role','SELECT')
)
select
  e.table_name,
  e.grantee as expected_grantee,
  e.privilege_type as expected_privilege,
  g.grantee as actual_grantee,
  g.privilege_type as actual_privilege,
  case
    when g.table_name is null then 'MISSING_REPAIR_GRANTS_PRIVILEGE'
    else 'EXPECTED_PRIVILEGE_REVIEW'
  end as result
from expected e
left join information_schema.role_table_grants g
  on g.table_schema = 'public'
  and g.table_name = e.table_name
  and g.grantee = e.grantee
  and g.privilege_type = e.privilege_type
order by e.table_name, e.grantee, e.privilege_type;

with expected(table_name, grantee, privilege_type) as (
  values
    ('complaint_tracking','authenticated','SELECT'),
    ('complaint_tracking','authenticated','INSERT'),
    ('complaint_tracking','authenticated','UPDATE'),
    ('civic_reports','authenticated','SELECT'),
    ('civic_reports','authenticated','INSERT'),
    ('civic_report_events','authenticated','SELECT'),
    ('civic_report_events','authenticated','INSERT'),
    ('civic_authorities','service_role','SELECT'),
    ('civic_reports','service_role','SELECT'),
    ('civic_report_events','service_role','SELECT'),
    ('civic_jurisdictions','service_role','SELECT'),
    ('civic_authority_jurisdictions','service_role','SELECT')
)
select
  g.table_name,
  g.grantee,
  g.privilege_type,
  case
    when g.grantee in ('anon', 'authenticated', 'service_role', 'PUBLIC')
      then 'REPAIR_REVOKES_OR_RESETS_KNOWN_ROLE_GRANT_REVIEW'
    else 'STOP_UNEXPECTED_ROLE_GRANT_REPAIR_DOES_NOT_REVOKE_THIS_ROLE'
  end as result
from information_schema.role_table_grants g
where g.table_schema = 'public'
  and g.table_name in (
    'complaint_tracking', 'civic_reports', 'civic_report_events', 'civic_authorities',
    'civic_jurisdictions', 'civic_authority_jurisdictions'
  )
  and not exists (
    select 1
    from expected e
    where e.table_name = g.table_name
      and e.grantee = g.grantee
      and e.privilege_type = g.privilege_type
  )
order by g.table_name, g.grantee, g.privilege_type;

-- 7. RLS state.
select
  n.nspname as schema_name,
  c.relname as table_name,
  c.relrowsecurity as rls_enabled,
  c.relforcerowsecurity as rls_forced
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relname in (
    'complaint_tracking', 'civic_reports', 'civic_report_events', 'civic_authorities',
    'civic_jurisdictions', 'civic_authority_jurisdictions'
  )
order by c.relname;

select
  expected.table_name,
  c.relrowsecurity as rls_enabled,
  c.relforcerowsecurity as rls_forced,
  case
    when c.oid is null then 'TABLE_MISSING'
    when not c.relrowsecurity then 'STOP_RLS_DISABLED'
    when expected.require_force and not c.relforcerowsecurity then 'STOP_FORCE_RLS_DISABLED'
    else 'RLS_ENABLED'
  end as result
from (values
  ('complaint_tracking'::text, false),
  ('civic_reports'::text, false),
  ('civic_report_events'::text, false),
  ('civic_authorities'::text, true),
  ('civic_jurisdictions'::text, true),
  ('civic_authority_jurisdictions'::text, true)
) expected(table_name, require_force)
left join pg_class c
  on c.oid = to_regclass(format('public.%I', expected.table_name))
order by expected.table_name;

-- 8. Report policies. Check both the policy name and the actual predicates.
select
  schemaname,
  tablename,
  policyname,
  permissive,
  roles,
  cmd,
  qual,
  with_check,
  case
    when tablename = 'complaint_tracking'
      and policyname in (
        'Users read their own complaint tracking records',
        'Users create their own complaint tracking records',
        'Users update their own complaint tracking records',
        'Users delete their own complaint tracking records'
      ) then 'REPAIR_REPLACES_OR_REMOVES_NAMED_POLICY_REVIEW_PREDICATES'
    when tablename = 'civic_reports'
      and policyname in (
        'Users read their own civic reports',
        'Users create civic reports for their own account'
      ) then 'REPAIR_REPLACES_NAMED_POLICY_REVIEW_PREDICATES'
    when tablename = 'civic_report_events'
      and policyname in (
        'Users read history for their own civic reports',
        'Users append citizen actions to their own report history'
      ) then 'REPAIR_REPLACES_NAMED_POLICY_REVIEW_PREDICATES'
    else 'STOP_UNEXPECTED_POLICY_MIGRATION_PREFLIGHT_ABORTS'
  end as migration_effect
from pg_policies
where schemaname = 'public'
  and tablename in (
    'complaint_tracking', 'civic_reports', 'civic_report_events', 'civic_authorities',
    'civic_jurisdictions', 'civic_authority_jurisdictions'
  )
order by tablename, policyname;

-- 8a. Jurisdiction tables must have no browser-facing policies. The access
-- function must be SECURITY DEFINER and executable only by service_role.
select
  p.tablename,
  p.policyname,
  p.cmd,
  p.roles,
  p.qual,
  p.with_check,
  'STOP_UNEXPECTED_JURISDICTION_POLICY' as result
from pg_policies p
where p.schemaname = 'public'
  and p.tablename in ('civic_jurisdictions', 'civic_authority_jurisdictions')
order by p.tablename, p.policyname;

with expected(function_oid) as (
  values (to_regprocedure('public.civic_authority_can_access_report(uuid,text)'))
)
select
  p.oid::regprocedure as function_name,
  p.prosecdef as is_security_definer,
  has_function_privilege('anon', p.oid, 'EXECUTE') as anon_can_execute,
  has_function_privilege('authenticated', p.oid, 'EXECUTE') as authenticated_can_execute,
  has_function_privilege('service_role', p.oid, 'EXECUTE') as service_role_can_execute,
  case
    when p.oid is null then 'MISSING_FUNCTION_REPAIR_CREATES_IT'
    when not p.prosecdef then 'STOP_FUNCTION_NOT_SECURITY_DEFINER'
    when has_function_privilege('anon', p.oid, 'EXECUTE')
      or has_function_privilege('authenticated', p.oid, 'EXECUTE')
      then 'STOP_FUNCTION_EXPOSED_TO_BROWSER'
    when not has_function_privilege('service_role', p.oid, 'EXECUTE')
      then 'STOP_SERVICE_ROLE_CANNOT_EXECUTE'
    else 'OK'
  end as result
from expected e
left join pg_proc p on p.oid = e.function_oid;

with expected(table_name, policy_name, command_name, repair_creates) as (
  values
    ('complaint_tracking','Users read their own complaint tracking records','SELECT',true),
    ('complaint_tracking','Users create their own complaint tracking records','INSERT',true),
    ('complaint_tracking','Users update their own complaint tracking records','UPDATE',true),
    ('complaint_tracking','Users delete their own complaint tracking records','DELETE',false),
    ('civic_reports','Users read their own civic reports','SELECT',true),
    ('civic_reports','Users create civic reports for their own account','INSERT',true),
    ('civic_report_events','Users read history for their own civic reports','SELECT',true),
    ('civic_report_events','Users append citizen actions to their own report history','INSERT',true)
)
select
  e.table_name,
  e.policy_name,
  e.command_name as expected_command,
  p.cmd as actual_command,
  p.roles as actual_roles,
  p.qual as actual_using,
  p.with_check as actual_with_check,
  case
    when to_regclass(format('public.%I', e.table_name)) is null then 'TABLE_MISSING'
    when p.policyname is null and e.repair_creates then 'MISSING_REPAIR_CREATES_POLICY'
    when p.policyname is null then 'EXPECTED_ABSENT_REPAIR_REMOVES_CITIZEN_DELETE'
    when p.cmd <> e.command_name then 'STOP_POLICY_COMMAND_MISMATCH'
    else 'REPAIR_REPLACES_POLICY_REVIEW_ACTUAL_PREDICATES_AND_ROLES'
  end as result
from expected e
left join pg_policies p
  on p.schemaname = 'public'
  and p.tablename = e.table_name
  and p.policyname = e.policy_name
order by e.table_name, e.policy_name;

-- 9. Current attachment bucket configuration.
do $bucket_status$
declare
  bucket_row record;
begin
  if to_regclass('storage.buckets') is null then
    raise notice 'Storage buckets catalog unavailable; STOP and inspect the Supabase Storage setup.';
  else
    execute $query$
      select
        expected.id as expected_id,
        b.name,
        b.public,
        b.file_size_limit,
        b.allowed_mime_types,
        case
          when b.id is null then 'BUCKET_MISSING'
          when b.name <> expected.id then 'STOP_BUCKET_NAME_ID_MISMATCH'
          when b.public then 'STOP_REVIEW_PUBLIC_TO_PRIVATE_VISIBILITY_CHANGE'
          when b.allowed_mime_types is distinct from array['image/jpeg']::text[]
            or b.file_size_limit is distinct from 10485760
            then 'STOP_REVIEW_UPLOAD_RESTRICTION_CHANGE'
          else 'OK'
        end as review_result
      from (values ('civic-report-attachments'::text)) expected(id)
      left join storage.buckets b on b.id = expected.id
    $query$ into bucket_row;
    raise notice 'Attachment bucket: id %, name %, public %, byte limit %, MIME types %, review %',
      bucket_row.expected_id, bucket_row.name, bucket_row.public,
      bucket_row.file_size_limit, bucket_row.allowed_mime_types, bucket_row.review_result;
  end if;
end
$bucket_status$;

-- 9a. Explicit preservation check: the repair's bucket upsert names only
-- civic-report-attachments and must not alter civicx-community.
do $community_bucket_status$
declare
  bucket_row record;
begin
  if to_regclass('storage.buckets') is null then
    raise notice 'civicx-community bucket check unavailable; STOP and inspect Storage before repair.';
  else
    execute $query$
      select
        b.id,
        b.name,
        b.public,
        b.file_size_limit,
        b.allowed_mime_types,
        case
          when b.id is null then 'NOT_PRESENT_REPAIR_DOES_NOT_CREATE_IT'
          else 'PRESENT_REPAIR_DOES_NOT_TARGET_THIS_BUCKET'
        end as preservation_result
      from (values ('civicx-community'::text)) expected(id)
      left join storage.buckets b on b.id = expected.id
    $query$ into bucket_row;
    raise notice 'Community bucket preservation: id %, name %, public %, byte limit %, MIME types %, result %',
      bucket_row.id, bucket_row.name, bucket_row.public,
      bucket_row.file_size_limit, bucket_row.allowed_mime_types,
      bucket_row.preservation_result;
  end if;
end
$community_bucket_status$;

-- 10. Storage policies. RLS policies are OR-combined, so textual searches for
-- one bucket_id spelling cannot prove isolation. Show every actual expression
-- beside the intended replacement expression; require manual review for every
-- present policy, including policies not replaced by this migration.
with expected(
  policy_name, command_name, permissive_mode, expected_roles,
  expected_using, expected_with_check, expected_scope
) as (
  values
    ('Users read their own civic report photos','SELECT','PERMISSIVE',
      array['authenticated']::name[],
      'bucket_id = ''civic-report-attachments'' AND (storage.foldername(name))[1] = (SELECT auth.uid())::text',
      null::text,
      'Replacement must limit SELECT to the private target bucket and the authenticated owner folder.'),
    ('Users upload civic report photos to their own folder','INSERT','PERMISSIVE',
      array['authenticated']::name[],
      null::text,
      'bucket_id = ''civic-report-attachments'' AND (storage.foldername(name))[1] = (SELECT auth.uid())::text',
      'Replacement must limit INSERT to the private target bucket and the authenticated owner folder.'),
    ('Users remove only unattached civic report photos','DELETE','PERMISSIVE',
      array['authenticated']::name[],
      'bucket_id = ''civic-report-attachments'' AND (storage.foldername(name))[1] = (SELECT auth.uid())::text AND NOT EXISTS (SELECT 1 FROM public.civic_reports WHERE civic_reports.photo_path = storage.objects.name AND civic_reports.user_id = (SELECT auth.uid()))',
      null::text,
      'Replacement must limit DELETE to the private target bucket, owner folder, and unattached objects.')
)
select
  coalesce(p.policyname, e.policy_name) as policy_name,
  p.permissive as actual_permissive,
  p.roles as actual_roles,
  e.command_name as expected_command,
  e.permissive_mode as expected_permissive,
  e.expected_roles,
  p.cmd as actual_command,
  p.qual as actual_using,
  p.with_check as actual_with_check,
  e.expected_using,
  e.expected_with_check,
  e.expected_scope,
  case
    when e.policy_name is not null and p.policyname is not null
      then 'REPAIR_REPLACES_NAMED_POLICY_MANUALLY_VERIFY_CIVICX_COMMUNITY_EFFECT'
    when e.policy_name is not null
      then 'MISSING_REPAIR_CREATES_POLICY'
    else 'REPAIR_DOES_NOT_REPLACE_POLICY_MANUALLY_VERIFY_SCOPE_AND_COMMUNITY_PRESERVATION'
  end as migration_effect,
  case
    when p.policyname is null then 'MISSING_REPAIR_CREATES_POLICY'
    else 'STOP_MANUAL_POLICY_REVIEW'
  end as result
from expected e
full join pg_policies p
  on p.schemaname = 'storage'
  and p.tablename = 'objects'
  and p.policyname = e.policy_name
where (p.schemaname = 'storage' and p.tablename = 'objects')
   or e.policy_name is not null
order by coalesce(p.policyname, e.policy_name);

-- 11. Object inventory for the target bucket. Unlinked objects must be reviewed
-- before the repair changes the bucket to private and JPEG-only.
do $object_inventory$
declare
  total_objects bigint;
  non_jpeg_objects bigint;
  oversized_size_metadata bigint;
  invalid_size_metadata bigint;
  unlinked_objects bigint;
begin
  if to_regclass('storage.objects') is null
      or not exists (
        select 1 from information_schema.columns
        where table_schema = 'storage'
          and table_name = 'objects'
          and column_name = 'bucket_id'
          and udt_name = 'text'
      )
      or not exists (
        select 1 from information_schema.columns
        where table_schema = 'storage'
          and table_name = 'objects'
          and column_name = 'name'
          and udt_name = 'text'
      )
      or not exists (
        select 1 from information_schema.columns
        where table_schema = 'storage'
          and table_name = 'objects'
          and column_name = 'metadata'
          and udt_name = 'jsonb'
      ) then
    raise notice 'STOP_STORAGE_OBJECT_SCHEMA_INCOMPATIBLE: cannot safely inventory bucket objects or file-size metadata.';
  elsif to_regclass('public.civic_reports') is null or not exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'civic_reports'
      and column_name = 'photo_path'
      and udt_name = 'text'
      and is_nullable = 'YES'
  ) then
    execute $query$
      select
        count(*),
        count(*) filter (where coalesce(mime_type, '') <> 'image/jpeg'),
        count(*) filter (where size_state = 'OVERSIZED'),
        count(*) filter (where size_state = 'INVALID')
      from (
        select
          metadata->>'mimetype' as mime_type,
          metadata->>'size' as size_text,
          case
            when metadata->>'size' is null or metadata->>'size' !~ '^[0-9]+$' then 'INVALID'
            when char_length(coalesce(nullif(ltrim(metadata->>'size', '0'), ''), '0')) > 8 then 'OVERSIZED'
            when coalesce(nullif(ltrim(metadata->>'size', '0'), ''), '0')::bigint > 10485760 then 'OVERSIZED'
            else 'VALID'
          end as size_state
        from storage.objects
        where bucket_id = 'civic-report-attachments'
      ) inventory
    $query$ into total_objects, non_jpeg_objects, oversized_size_metadata, invalid_size_metadata;
    raise notice 'STOP_REVIEW_TARGET_BUCKET: total %, non-JPEG %, oversized size metadata >10 MiB %, missing/invalid/non-numeric size metadata %; no compatible report schema is available to establish ownership.',
      total_objects, non_jpeg_objects, oversized_size_metadata, invalid_size_metadata;
  else
    execute $query$
      select
        count(*),
        count(*) filter (where coalesce(inventory.mime_type, '') <> 'image/jpeg'),
        count(*) filter (where inventory.size_state = 'OVERSIZED'),
        count(*) filter (where inventory.size_state = 'INVALID'),
        count(*) filter (
          where not exists (
            select 1 from public.civic_reports r where r.photo_path = inventory.name
          )
        )
      from (
        select
          o.name,
          o.metadata->>'mimetype' as mime_type,
          o.metadata->>'size' as size_text,
          case
            when o.metadata->>'size' is null or o.metadata->>'size' !~ '^[0-9]+$' then 'INVALID'
            when char_length(coalesce(nullif(ltrim(o.metadata->>'size', '0'), ''), '0')) > 8 then 'OVERSIZED'
            when coalesce(nullif(ltrim(o.metadata->>'size', '0'), ''), '0')::bigint > 10485760 then 'OVERSIZED'
            else 'VALID'
          end as size_state
        from storage.objects o
        where o.bucket_id = 'civic-report-attachments'
      ) inventory
    $query$ into total_objects, non_jpeg_objects, oversized_size_metadata, invalid_size_metadata, unlinked_objects;
    raise notice 'STOP_REVIEW_TARGET_BUCKET before privacy/size/MIME changes: total %, non-JPEG %, oversized size metadata >10 MiB %, missing/invalid/non-numeric size metadata %, not linked to reports %.',
      total_objects, non_jpeg_objects, oversized_size_metadata, invalid_size_metadata, unlinked_objects;
  end if;
end
$object_inventory$;

-- 12. Read-only data compatibility counts. No row contents are returned.
do $data_audit$
declare
  issue_count bigint;
  column_count integer;
  legacy_column_count integer;
  type_mismatch_count integer;
  incompatible_schema_columns integer;
  jurisdiction_issue_count bigint;
  non_jpeg_objects bigint;
  oversized_size_metadata bigint;
  invalid_size_metadata bigint;
begin
  with expected(table_name, column_name, udt_name, is_nullable) as (
    values
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
  )
  select count(*) into incompatible_schema_columns
  from expected e
  left join information_schema.columns c
    on c.table_schema = 'public'
    and c.table_name = e.table_name
    and c.column_name = e.column_name
  where to_regclass(format('public.%I', e.table_name)) is not null
    and not (
      e.table_name = 'civic_reports'
      and e.column_name = 'jurisdiction_key'
      and c.column_name is null
    )
    and (
      c.column_name is null
      or c.udt_name is distinct from e.udt_name
      or c.is_nullable is distinct from e.is_nullable
    );

  if incompatible_schema_columns > 0 then
    raise notice 'STOP_INCOMPATIBLE_COLUMN_SCHEMA: % missing/type/nullability mismatches in existing CivicX tables; all dependent data audits were skipped. See section 2 for the per-column details.',
      incompatible_schema_columns;
    return;
  end if;

  if to_regclass('public.complaint_tracking') is not null then
    select count(*) into column_count
    from information_schema.columns
    where table_schema = 'public' and table_name = 'complaint_tracking'
      and column_name = any(array[
        'id', 'user_id', 'report_id', 'city', 'portal', 'registration_number',
        'portal_status', 'status_remarks', 'status_date', 'official_document_url',
        'checked_at', 'created_at', 'updated_at'
      ]);
    select count(*) into type_mismatch_count
    from (values
      ('user_id','uuid'),
      ('portal','text'),
      ('registration_number','text')
    ) expected(column_name, udt_name)
    left join information_schema.columns c
      on c.table_schema = 'public'
      and c.table_name = 'complaint_tracking'
      and c.column_name = expected.column_name
    where c.udt_name is distinct from expected.udt_name;
    if column_count = 13 and type_mismatch_count = 0 then
      execute $query$
        select count(*) from public.complaint_tracking t
        left join auth.users u on u.id = t.user_id
        where u.id is null
      $query$ into issue_count;
      raise notice 'complaint_tracking rows without an auth.users owner: %', issue_count;

      execute $query$
        select count(*) from (
          select user_id, portal, registration_number
          from public.complaint_tracking
          group by user_id, portal, registration_number
          having count(*) > 1
        ) duplicates
      $query$ into issue_count;
      raise notice 'duplicate complaint_tracking unique-key groups: %', issue_count;
    else
      raise notice 'Skipped complaint_tracking data checks: expected columns/types are missing or incompatible.';
    end if;
  end if;

  if to_regclass('public.civic_reports') is not null then
    select count(*) into column_count
    from information_schema.columns
    where table_schema = 'public' and table_name = 'civic_reports'
      and column_name = any(array[
        'id', 'user_id', 'category', 'title', 'city', 'location', 'area',
        'description', 'latitude', 'longitude', 'status', 'priority',
        'registration_number', 'submission_state', 'status_source', 'portal',
        'official_portal_url', 'official_registration', 'photo_path',
        'jurisdiction_key', 'resolution_evidence_url', 'created_at', 'updated_at'
      ]);
    select count(*) into legacy_column_count
    from information_schema.columns
    where table_schema = 'public' and table_name = 'civic_reports'
      and column_name = any(array[
        'id', 'user_id', 'category', 'title', 'city', 'location', 'area',
        'description', 'latitude', 'longitude', 'status', 'priority',
        'registration_number', 'submission_state', 'status_source', 'portal',
        'official_portal_url', 'official_registration', 'photo_path',
        'resolution_evidence_url', 'created_at', 'updated_at'
      ]);
    select count(*) into type_mismatch_count
    from (values
      ('id','text'), ('user_id','uuid'), ('category','text'), ('title','text'),
      ('city','text'), ('location','text'), ('area','text'), ('description','text'),
      ('latitude','float8'), ('longitude','float8'), ('priority','text'),
      ('registration_number','text'), ('photo_path','text'),
      ('jurisdiction_key','text'), ('resolution_evidence_url','text')
    ) expected(column_name, udt_name)
    left join information_schema.columns c
      on c.table_schema = 'public'
      and c.table_name = 'civic_reports'
      and c.column_name = expected.column_name
    where c.column_name is not null
      and c.udt_name <> expected.udt_name;
    if (
        column_count = 23
        or (
          column_count = 22
          and legacy_column_count = 22
          and not exists (
            select 1 from information_schema.columns
            where table_schema = 'public'
              and table_name = 'civic_reports'
              and column_name = 'jurisdiction_key'
          )
        )
      )
        and type_mismatch_count = 0 then
      execute $query$
        select count(*) from public.civic_reports r
        left join auth.users u on u.id = r.user_id
        where u.id is null
           or r.category is null
           or r.title is null
           or r.city is null
           or r.location is null
           or r.area is null
           or r.description is null
           or r.latitude is null
           or r.longitude is null
           or r.status is null
           or r.priority is null
           or r.submission_state is null
           or r.status_source is null
           or r.portal is null
           or r.official_portal_url is null
           or r.created_at is null
           or r.updated_at is null
           or r.id !~ '^CX-[A-Za-z0-9-]{1,77}$'
           or r.category not in ('Pothole', 'Garbage', 'Water leakage', 'Streetlight')
           or char_length(r.title) not between 1 and 200
           or char_length(r.city) not between 2 and 120
           or char_length(r.location) not between 2 and 160
           or char_length(r.area) not between 1 and 120
           or char_length(r.description) not between 1 and 2500
           or r.registration_number is distinct from r.id
           or r.latitude not between -90 and 90
           or r.longitude not between -180 and 180
           or r.priority not in ('High', 'Medium', 'Low')
           or (
             r.resolution_evidence_url is not null
             and (
               char_length(r.resolution_evidence_url) > 1000
               or r.resolution_evidence_url !~* '^https://'
             )
           )
      $query$ into issue_count;
      raise notice 'civic_reports rows with owner/reference/category/coordinate/priority incompatibilities: %', issue_count;

      if to_regclass('storage.objects') is not null then
        execute $query$
          select count(*) from public.civic_reports r
          where r.photo_path is not null
            and not exists (
              select 1 from storage.objects o
              where o.bucket_id = 'civic-report-attachments'
                and o.name = r.photo_path
            )
        $query$ into issue_count;
        raise notice 'civic_reports photo paths without a matching Storage object: %', issue_count;

        execute $query$
          select count(*) from public.civic_reports r
          where r.photo_path is not null
            and r.photo_path not like r.user_id::text || '/' || r.id || '/%'
        $query$ into issue_count;
        raise notice 'STOP_REVIEW civic_reports photo paths outside the owner/report folder structure enforced by the trigger: %',
          issue_count;
      else
        raise notice 'Skipped civic_reports photo-path integrity check: Storage objects are unavailable.';
      end if;
    else
      raise notice 'STOP_OR_REVIEW_CIVIC_REPORTS_SCHEMA: expected 23 columns (or 22 legacy columns with only jurisdiction_key absent), found % jurisdiction-inclusive columns and % legacy columns.',
        column_count, legacy_column_count;
    end if;

    if exists (
      select 1 from information_schema.columns
      where table_schema = 'public'
        and table_name = 'civic_reports'
        and column_name = 'jurisdiction_key'
        and udt_name = 'text'
    ) then
      if to_regclass('public.civic_jurisdictions') is not null
          and exists (
            select 1 from information_schema.columns
            where table_schema = 'public'
              and table_name = 'civic_jurisdictions'
              and column_name = 'jurisdiction_key'
              and udt_name = 'text'
          )
          and exists (
            select 1 from information_schema.columns
            where table_schema = 'public'
              and table_name = 'civic_jurisdictions'
              and column_name = 'display_name'
              and udt_name = 'text'
          )
          and exists (
            select 1 from information_schema.columns
            where table_schema = 'public'
              and table_name = 'civic_jurisdictions'
              and column_name = 'is_active'
              and udt_name = 'bool'
          ) then
        execute $query$
          select count(*) from public.civic_reports r
          where r.jurisdiction_key is not null
            and not exists (
               select 1 from public.civic_jurisdictions j
               where j.jurisdiction_key = r.jurisdiction_key
             )
        $query$ into issue_count;
        raise notice 'STOP_UNREGISTERED_REPORT_JURISDICTION_KEYS (repair foreign-key creation may fail): %', issue_count;

        execute $query$
          select count(*) from public.civic_reports r
          where r.jurisdiction_key is null
             or not exists (
               select 1 from public.civic_jurisdictions j
               where j.jurisdiction_key = r.jurisdiction_key
                 and j.is_active
             )
        $query$ into jurisdiction_issue_count;
        raise notice 'Reports lacking an active verified jurisdiction (authority access denied; not by itself a migration blocker): %',
          jurisdiction_issue_count;
      else
        execute 'select count(*) from public.civic_reports where jurisdiction_key is not null'
          into issue_count;
        select count(*) into jurisdiction_issue_count from public.civic_reports;
        raise notice 'STOP_NON_NULL_REPORT_JURISDICTIONS_WITHOUT_REGISTRY (repair foreign-key creation may fail): %',
          issue_count;
        raise notice 'Reports with no jurisdiction registry; authority access denied for all reports: %',
          jurisdiction_issue_count;
      end if;
    elsif exists (
      select 1 from information_schema.columns
      where table_schema = 'public'
        and table_name = 'civic_reports'
        and column_name = 'jurisdiction_key'
    ) then
      raise notice 'STOP_CIVIC_REPORTS_JURISDICTION_KEY_TYPE_MISMATCH: inspect section 2 before repair.';
    else
      raise notice 'civic_reports.jurisdiction_key is absent; the repair will add it, leaving existing reports unassigned and authority access denied.';
    end if;
  end if;

  if to_regclass('public.civic_authorities') is not null
      and exists (
        select 1 from information_schema.columns
        where table_schema = 'public'
          and table_name = 'civic_authorities'
          and column_name = 'user_id'
          and udt_name = 'uuid'
      ) then
    execute $query$
      select count(*) from public.civic_authorities a
      left join auth.users u on u.id = a.user_id
      where u.id is null
    $query$ into issue_count;
    raise notice 'STOP_AUTHORITY_ALLOWLIST_ROWS_WITHOUT_AUTH_USERS (foreign-key creation may fail): %',
      issue_count;
  end if;

  if to_regclass('public.civic_jurisdictions') is not null
      and exists (
        select 1 from information_schema.columns
        where table_schema = 'public'
          and table_name = 'civic_jurisdictions'
          and column_name = 'jurisdiction_key'
          and udt_name = 'text'
      )
      and exists (
        select 1 from information_schema.columns
        where table_schema = 'public'
          and table_name = 'civic_jurisdictions'
          and column_name = 'display_name'
          and udt_name = 'text'
      ) then
    execute $query$
      select count(*) from public.civic_jurisdictions j
      where j.jurisdiction_key !~ '^[a-z0-9][a-z0-9_-]{1,79}$'
         or char_length(btrim(j.display_name)) not between 1 and 120
    $query$ into issue_count;
    raise notice 'STOP_JURISDICTION_REGISTRY_ROWS_INCOMPATIBLE_WITH_REPAIR_CHECKS: %',
      issue_count;
  elsif to_regclass('public.civic_jurisdictions') is not null then
    raise notice 'STOP_JURISDICTION_REGISTRY_SCHEMA_MISMATCH: inspect section 2 before repair.';
  end if;

  if to_regclass('public.civic_authority_jurisdictions') is not null
      and to_regclass('public.civic_authorities') is not null
      and to_regclass('public.civic_jurisdictions') is not null
      and exists (
        select 1 from information_schema.columns
        where table_schema = 'public'
          and table_name = 'civic_authority_jurisdictions'
          and column_name = 'authority_user_id'
          and udt_name = 'uuid'
      )
      and exists (
        select 1 from information_schema.columns
        where table_schema = 'public'
          and table_name = 'civic_authority_jurisdictions'
          and column_name = 'jurisdiction_key'
          and udt_name = 'text'
      )
      and exists (
        select 1 from information_schema.columns
        where table_schema = 'public'
          and table_name = 'civic_authorities'
          and column_name = 'user_id'
          and udt_name = 'uuid'
      )
      and exists (
        select 1 from information_schema.columns
        where table_schema = 'public'
          and table_name = 'civic_authorities'
          and column_name = 'is_active'
          and udt_name = 'bool'
      )
      and exists (
        select 1 from information_schema.columns
        where table_schema = 'public'
          and table_name = 'civic_jurisdictions'
          and column_name = 'jurisdiction_key'
          and udt_name = 'text'
      )
      and exists (
        select 1 from information_schema.columns
        where table_schema = 'public'
          and table_name = 'civic_jurisdictions'
          and column_name = 'is_active'
          and udt_name = 'bool'
      ) then
    execute $query$
      select count(*) from public.civic_authority_jurisdictions aj
      left join public.civic_authorities a
        on a.user_id = aj.authority_user_id
      left join public.civic_jurisdictions j
        on j.jurisdiction_key = aj.jurisdiction_key
      where a.user_id is null or j.jurisdiction_key is null
    $query$ into issue_count;
    raise notice 'STOP_AUTHORITY_JURISDICTION_ASSIGNMENTS_WITH_MISSING_PARENT_ROWS (foreign-key creation may fail): %',
      issue_count;

    execute $query$
      select count(*) from public.civic_authority_jurisdictions aj
      join public.civic_authorities a on a.user_id = aj.authority_user_id
      join public.civic_jurisdictions j on j.jurisdiction_key = aj.jurisdiction_key
      where not a.is_active or not j.is_active
    $query$ into issue_count;
    raise notice 'Assignments with an inactive authority or jurisdiction (authority access denied): %',
      issue_count;

    execute $query$
      select count(*) from public.civic_authorities a
      where a.is_active
        and not exists (
          select 1
          from public.civic_authority_jurisdictions aj
          join public.civic_jurisdictions j
            on j.jurisdiction_key = aj.jurisdiction_key and j.is_active
          where aj.authority_user_id = a.user_id
        )
    $query$ into issue_count;
    raise notice 'Active authorities with no active jurisdiction assignment (access denied): %',
      issue_count;
  else
    if to_regclass('public.civic_authority_jurisdictions') is not null
        and to_regclass('public.civic_authorities') is not null
        and to_regclass('public.civic_jurisdictions') is not null then
      raise notice 'STOP_AUTHORITY_JURISDICTION_ASSIGNMENT_SCHEMA_MISMATCH: inspect section 2 before repair.';
    elsif to_regclass('public.civic_authority_jurisdictions') is not null then
      execute 'select count(*) from public.civic_authority_jurisdictions'
        into issue_count;
      raise notice 'STOP_AUTHORITY_ASSIGNMENT_ROWS_CANNOT_BE_VALIDATED_BECAUSE_PARENT_TABLES_ARE_MISSING: %',
        issue_count;
    else
      raise notice 'Authority jurisdiction assignment table is absent; the repair creates it empty and authority access remains denied until admin assignments exist.';
    end if;
  end if;

  if to_regclass('public.civic_report_events') is not null
      and to_regclass('public.civic_reports') is not null then
    select count(*) into column_count
    from information_schema.columns
    where table_schema = 'public' and table_name = 'civic_report_events'
      and column_name = any(array[
        'id', 'report_id', 'actor_user_id', 'actor_kind', 'event_type',
        'summary', 'details', 'metadata', 'created_at'
      ]);
    select count(*) into type_mismatch_count
    from (values
      ('civic_report_events','report_id','text'),
      ('civic_report_events','actor_user_id','uuid'),
      ('civic_report_events','actor_kind','text'),
      ('civic_report_events','event_type','text'),
      ('civic_report_events','summary','text'),
      ('civic_report_events','details','text'),
      ('civic_reports','id','text'),
      ('civic_reports','user_id','uuid')
    ) expected(table_name, column_name, udt_name)
    left join information_schema.columns c
      on c.table_schema = 'public'
      and c.table_name = expected.table_name
      and c.column_name = expected.column_name
    where c.column_name is not null
      and c.udt_name <> expected.udt_name;
    if column_count = 9 and type_mismatch_count = 0 then
      execute $query$
        select count(*) from public.civic_report_events e
        left join public.civic_reports r on r.id = e.report_id
        left join auth.users u on u.id = e.actor_user_id
        where r.id is null
           or (e.actor_user_id is not null and u.id is null)
           or (e.actor_kind = 'citizen' and e.actor_user_id is distinct from r.user_id)
           or e.actor_kind is null
           or e.event_type is null
           or e.summary is null
           or e.metadata is null
           or e.actor_kind not in ('citizen', 'authority', 'system')
           or e.event_type not in (
             'report_submitted', 'authority_action', 'resolution_evidence',
             'citizen_dispute', 'reopening_requested', 'reopened',
             'portal_reference_saved', 'citizen_status_check'
           )
           or char_length(e.summary) not between 1 and 240
           or (e.details is not null and char_length(e.details) > 2000)
           or (e.event_type in (
             'report_submitted', 'citizen_dispute', 'reopening_requested',
             'portal_reference_saved', 'citizen_status_check'
           ) and e.actor_kind <> 'citizen')
           or (e.event_type in ('authority_action', 'reopened', 'resolution_evidence')
               and e.actor_kind <> 'authority')
      $query$ into issue_count;
      raise notice 'civic_report_events rows with broken report/actor/type references: %', issue_count;

      execute $query$
        select count(*) from public.civic_report_events
        where actor_kind = 'authority' and actor_user_id is null
      $query$ into issue_count;
      raise notice 'legacy authority events without an attributable authority user: %', issue_count;

      if to_regclass('public.civic_authorities') is not null
          and exists (
            select 1 from information_schema.columns
            where table_schema = 'public'
              and table_name = 'civic_authorities'
              and column_name = 'user_id'
              and udt_name = 'uuid'
          ) then
        execute $query$
          select count(*)
          from public.civic_report_events e
          where e.actor_kind = 'authority'
            and e.actor_user_id is not null
            and not exists (
              select 1
              from public.civic_authorities a
              where a.user_id = e.actor_user_id
            )
        $query$ into issue_count;
        raise notice 'Review authority events whose actor is not in the current allowlist (history is retained): %',
          issue_count;
      else
        raise notice 'Review authority event attribution: civic_authorities is unavailable or incompatible.';
      end if;
    else
      raise notice 'Skipped civic_report_events data checks: expected columns/types are missing or incompatible.';
    end if;
  end if;

  if to_regclass('storage.objects') is not null then
    if not exists (
      select 1 from information_schema.columns
      where table_schema = 'storage' and table_name = 'objects'
        and column_name = 'bucket_id' and udt_name = 'text'
    ) or not exists (
      select 1 from information_schema.columns
      where table_schema = 'storage' and table_name = 'objects'
        and column_name = 'name' and udt_name = 'text'
    ) or not exists (
      select 1 from information_schema.columns
      where table_schema = 'storage' and table_name = 'objects'
        and column_name = 'metadata' and udt_name = 'jsonb'
    ) then
      raise notice 'STOP_STORAGE_OBJECT_SCHEMA_INCOMPATIBLE: remaining storage data checks were skipped.';
    else
      execute $query$
        select
          count(*) filter (where coalesce(mime_type, '') <> 'image/jpeg'),
          count(*) filter (where size_state = 'INVALID'),
          count(*) filter (where size_state = 'OVERSIZED')
        from (
          select
            metadata->>'mimetype' as mime_type,
            case
              when metadata->>'size' is null or metadata->>'size' !~ '^[0-9]+$' then 'INVALID'
              when char_length(coalesce(nullif(ltrim(metadata->>'size', '0'), ''), '0')) > 8 then 'OVERSIZED'
              when coalesce(nullif(ltrim(metadata->>'size', '0'), ''), '0')::bigint > 10485760 then 'OVERSIZED'
              else 'VALID'
            end as size_state
          from storage.objects
          where bucket_id = 'civic-report-attachments'
        ) inventory
      $query$ into non_jpeg_objects, invalid_size_metadata, oversized_size_metadata;
      raise notice 'Target-bucket objects with non-JPEG MIME, missing/invalid/non-numeric size, or size over 10 MiB: MIME %, invalid/missing size %, oversized size %.',
        non_jpeg_objects, invalid_size_metadata, oversized_size_metadata;

      if to_regclass('public.civic_reports') is null then
        execute $query$
          select count(*) from storage.objects
          where bucket_id = 'civic-report-attachments'
        $query$ into issue_count;
        raise notice 'Target-bucket objects requiring report-table review: %', issue_count;
      else
        execute $query$
          select count(*) from public.civic_reports r
          where r.photo_path is not null
            and not exists (
              select 1 from storage.objects o
              where o.bucket_id = 'civic-report-attachments'
                and o.name = r.photo_path
            )
        $query$ into issue_count;
        raise notice 'Report rows with missing private attachment objects: %', issue_count;
      end if;
    end if;
  end if;
end
$data_audit$;

-- 13. Migration ledger. This conditional read avoids an error on projects where
-- the CLI migration table is not exposed or has not been created.
do $migration_ledger$
declare
  applied_versions text;
begin
  if to_regclass('supabase_migrations.schema_migrations') is null then
    raise notice 'Migration ledger unavailable; inspect migration history in the Supabase Dashboard.';
  else
    execute $query$
      select string_agg(version::text || ':' || name::text, ', ' order by version)
      from supabase_migrations.schema_migrations
      where version::text = any($1)
    $query$
    into applied_versions
    using array[
      '20261114190000',
      '20261115160000',
      '20261116100000',
      '20261116120000'
    ]::text[];
    raise notice 'Relevant migration ledger rows: %', coalesce(applied_versions, '(none)');
  end if;
end
$migration_ledger$;
