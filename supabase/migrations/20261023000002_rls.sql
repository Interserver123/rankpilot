-- Row-level security as a defence-in-depth layer.
--
-- All application reads and writes go through server code that enforces
-- organization/project permissions (src/server/authz.ts) using the table-owner
-- connection (owners bypass RLS). Enabling RLS with no permissive policies means the
-- Supabase Data API (anon/authenticated keys) cannot read or write any table
-- directly, so a leaked anon key or a client-side bug cannot bypass those checks.
do $$
declare t text;
begin
  foreach t in array array[
    'organizations','users','organization_members','clients','projects','project_assignments',
    'project_locations','competitors','keywords','tracking_configs','tracking_jobs',
    'tracking_job_targets','serp_observations','serp_competitor_observations','map_grids',
    'map_grid_points','map_scans','map_observations','llm_prompts','llm_observations',
    'llm_citations','citations','integration_connections','gsc_daily_metrics','ga4_daily_metrics',
    'provider_usage','budgets','client_project_access','report_exports','audit_logs'
  ] loop
    execute format('alter table %I enable row level security', t);
  end loop;
end $$;
