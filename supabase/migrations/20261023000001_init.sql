-- RankPilot initial schema.
-- Conventions: UUID keys, UTC timestamptz, explicit organization ownership,
-- nullable optional metrics (never defaulted to 0 when unknown).

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Tenancy and users
-- ---------------------------------------------------------------------------

create table organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  plan text not null default 'internal',
  status text not null default 'active' check (status in ('active', 'suspended')),
  created_at timestamptz not null default now()
);

create table users (
  id uuid primary key default gen_random_uuid(),
  authentication_user_id text unique,
  name text,
  email text not null,
  status text not null default 'active' check (status in ('active', 'disabled')),
  created_at timestamptz not null default now()
);
create unique index users_email_key on users (lower(email));

create table organization_members (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  role text not null check (role in ('admin', 'manager', 'member')),
  created_at timestamptz not null default now(),
  unique (organization_id, user_id)
);

create table clients (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  name text not null,
  contact_email text,
  logo_url text,
  notes text,
  created_at timestamptz not null default now()
);
create index clients_org_idx on clients (organization_id);

-- ---------------------------------------------------------------------------
-- Projects
-- ---------------------------------------------------------------------------

create table projects (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  client_id uuid not null references clients(id) on delete restrict,
  name text not null,
  domain text not null,
  business_category text,
  timezone text not null,
  country text not null,
  language text not null,
  notes text,
  status text not null default 'active' check (status in ('active', 'paused', 'archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index projects_org_idx on projects (organization_id, status);

-- Members (role 'member') only see projects they are assigned to.
create table project_assignments (
  project_id uuid not null references projects(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (project_id, user_id)
);

create table project_locations (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  name text not null,
  business_name text,
  address text,
  phone text,
  website text,
  -- Search targeting. City-level targeting is NOT an exact physical point.
  country_code text not null,
  region text,
  city text,
  postal_code text,
  latitude double precision check (latitude between -90 and 90),
  longitude double precision check (longitude between -180 and 180),
  google_domain text not null default 'google.com',
  google_business_profile_reference text,
  is_primary boolean not null default false,
  created_at timestamptz not null default now()
);
create unique index project_locations_one_primary on project_locations (project_id) where is_primary;
create index project_locations_project_idx on project_locations (project_id);

create table competitors (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  name text not null,
  domain text,
  business_profile_reference text,
  created_at timestamptz not null default now()
);
create unique index competitors_domain_key on competitors (project_id, lower(domain)) where domain is not null;

create table keywords (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  keyword text not null,
  -- Normalized form used for deduplication (lower-case, collapsed whitespace).
  keyword_normalized text not null,
  location_id uuid not null references project_locations(id) on delete restrict,
  search_engine text not null default 'google' check (search_engine in ('google')),
  language text not null,
  device text not null default 'desktop' check (device in ('desktop', 'mobile')),
  target_url text,
  tags text[] not null default '{}',
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);
-- The same keyword at a different location/device/engine/language is a different configuration.
create unique index keywords_config_key
  on keywords (project_id, keyword_normalized, location_id, search_engine, language, device);
create index keywords_tags_idx on keywords using gin (tags);

-- ---------------------------------------------------------------------------
-- Scheduling and jobs
-- ---------------------------------------------------------------------------

create table tracking_configs (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  module text not null check (module in ('organic', 'maps', 'llm', 'citations', 'gsc', 'ga4')),
  -- Validated target type instead of an unrestricted polymorphic reference.
  target_type text not null default 'project'
    check (target_type in ('project', 'keyword_tag', 'map_grid', 'llm_prompt_group', 'citation_set')),
  target_id uuid,
  target_tag text,
  enabled boolean not null default true,
  interval_value integer not null default 7 check (interval_value between 1 and 365),
  interval_unit text not null default 'day' check (interval_unit in ('day', 'week', 'month')),
  preferred_run_time time not null default '06:00',
  timezone text not null,
  next_run_at timestamptz,
  last_run_at timestamptz,
  last_success_at timestamptz,
  settings_json jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (target_type <> 'project' or (target_id is null and target_tag is null)),
  check (target_type <> 'keyword_tag' or target_tag is not null)
);
create unique index tracking_configs_target_key
  on tracking_configs (project_id, module, target_type, coalesce(target_id, '00000000-0000-0000-0000-000000000000'::uuid), coalesce(target_tag, ''));
create index tracking_configs_due_idx on tracking_configs (next_run_at) where enabled;

create table tracking_jobs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  project_id uuid not null references projects(id) on delete cascade,
  tracking_config_id uuid references tracking_configs(id) on delete set null,
  module text not null,
  job_type text not null check (job_type in (
    'serp_collection', 'maps_scan', 'llm_collection', 'citation_discovery',
    'citation_verification', 'gsc_sync', 'ga4_sync', 'report_generation', 'alert_evaluation')),
  provider text not null,
  trigger text not null check (trigger in ('scheduled', 'manual', 'initial', 'recovery')),
  status text not null default 'queued' check (status in (
    'awaiting_approval', 'queued', 'running', 'completed', 'partial', 'failed', 'cancelled')),
  priority integer not null default 100,
  idempotency_key text not null,
  requested_by_user_id uuid references users(id) on delete set null,
  scheduled_for timestamptz not null default now(),
  run_after timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz,
  locked_by text,
  locked_at timestamptz,
  attempts integer not null default 0,
  max_attempts integer not null default 4,
  estimated_cost numeric(12, 4),
  actual_cost numeric(12, 4),
  currency text not null default 'USD',
  payload_json jsonb not null default '{}',
  result_summary_json jsonb not null default '{}',
  error_code text,
  error_message text,
  created_at timestamptz not null default now()
);
-- Only one active job per idempotency key: repeated clicks never duplicate provider requests.
create unique index tracking_jobs_active_idempotency
  on tracking_jobs (idempotency_key) where status in ('awaiting_approval', 'queued', 'running');
create index tracking_jobs_claim_idx on tracking_jobs (status, run_after, priority);
create index tracking_jobs_project_idx on tracking_jobs (project_id, created_at desc);

-- Per-target progress so partial batches show exactly what succeeded, failed or is pending.
create table tracking_job_targets (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references tracking_jobs(id) on delete cascade,
  target_type text not null check (target_type in ('keyword', 'map_point', 'llm_prompt', 'citation')),
  target_id uuid not null,
  -- in_flight: request sent, outcome unknown. uncertain: the worker lost track of an
  -- in-flight billable request; it is NOT retried automatically.
  status text not null default 'pending'
    check (status in ('pending', 'in_flight', 'succeeded', 'failed', 'uncertain', 'skipped')),
  attempts integer not null default 0,
  error_code text,
  error_message text,
  provider_request_id text,
  updated_at timestamptz not null default now(),
  unique (job_id, target_type, target_id)
);
create index tracking_job_targets_job_idx on tracking_job_targets (job_id, status);

-- ---------------------------------------------------------------------------
-- Organic SERP observations
-- ---------------------------------------------------------------------------

create table serp_observations (
  id uuid primary key default gen_random_uuid(),
  keyword_id uuid not null references keywords(id) on delete cascade,
  job_id uuid not null references tracking_jobs(id) on delete restrict,
  provider text not null,
  -- Exactly what was sent to the provider (e.g. "city: Austin,Texas,United States").
  requested_location text not null,
  device text not null,
  result_depth integer not null,
  collected_at timestamptz not null,
  -- 'ranked': found at position. 'not_found': verified absent within result_depth.
  -- Failed collections produce no observation (see tracking_job_targets).
  result_status text not null check (result_status in ('ranked', 'not_found')),
  position integer check (position > 0),
  ranking_url text,
  ranking_title text,
  serp_features_json jsonb not null default '[]',
  result_metadata_json jsonb not null default '{}',
  check ((result_status = 'ranked') = (position is not null)),
  unique (job_id, keyword_id)
);
create index serp_observations_keyword_idx on serp_observations (keyword_id, collected_at desc);

create table serp_competitor_observations (
  id uuid primary key default gen_random_uuid(),
  observation_id uuid not null references serp_observations(id) on delete cascade,
  competitor_id uuid not null references competitors(id) on delete cascade,
  position integer check (position > 0),
  ranking_url text,
  unique (observation_id, competitor_id)
);

-- ---------------------------------------------------------------------------
-- Maps geo-grid (Phase 3)
-- ---------------------------------------------------------------------------

create table map_grids (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  location_id uuid not null references project_locations(id) on delete restrict,
  name text not null,
  center_latitude double precision not null,
  center_longitude double precision not null,
  grid_rows integer not null check (grid_rows between 1 and 21),
  grid_columns integer not null check (grid_columns between 1 and 21),
  spacing_meters double precision not null check (spacing_meters > 0),
  result_depth integer not null default 20,
  settings_json jsonb not null default '{}',
  created_at timestamptz not null default now()
);

create table map_grid_points (
  id uuid primary key default gen_random_uuid(),
  map_grid_id uuid not null references map_grids(id) on delete cascade,
  latitude double precision not null,
  longitude double precision not null,
  row_index integer not null,
  column_index integer not null,
  unique (map_grid_id, row_index, column_index)
);

create table map_scans (
  id uuid primary key default gen_random_uuid(),
  map_grid_id uuid not null references map_grids(id) on delete cascade,
  keyword text not null,
  provider text not null,
  status text not null check (status in ('queued', 'running', 'completed', 'partial', 'failed')),
  result_depth integer not null,
  started_at timestamptz,
  completed_at timestamptz,
  job_id uuid references tracking_jobs(id) on delete set null
);

create table map_observations (
  id uuid primary key default gen_random_uuid(),
  map_scan_id uuid not null references map_scans(id) on delete cascade,
  grid_point_id uuid not null references map_grid_points(id) on delete cascade,
  business_reference text,
  position integer check (position > 0),
  -- 'failed' is distinct from 'not_found' and is never averaged as a ranking.
  result_status text not null check (result_status in ('ranked', 'not_found', 'failed')),
  collected_at timestamptz not null,
  metadata_json jsonb not null default '{}',
  unique (map_scan_id, grid_point_id)
);

-- ---------------------------------------------------------------------------
-- LLM visibility (Phase 5)
-- ---------------------------------------------------------------------------

create table llm_prompts (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  prompt text not null,
  language text not null,
  location_context text,
  category text,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table llm_observations (
  id uuid primary key default gen_random_uuid(),
  prompt_id uuid not null references llm_prompts(id) on delete cascade,
  provider text not null,
  collection_method text not null,
  model_identifier text,
  collected_at timestamptz not null,
  raw_response text not null,
  brand_mentioned boolean,
  mention_count integer,
  prominence text,
  extraction_status text not null check (extraction_status in ('automatic', 'manually_corrected', 'failed')),
  job_id uuid references tracking_jobs(id) on delete set null
);

create table llm_citations (
  id uuid primary key default gen_random_uuid(),
  observation_id uuid not null references llm_observations(id) on delete cascade,
  cited_url text not null,
  cited_domain text not null,
  citation_type text
);

-- ---------------------------------------------------------------------------
-- Local citations (Phase 6)
-- ---------------------------------------------------------------------------

create table citations (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  location_id uuid references project_locations(id) on delete set null,
  source_name text not null,
  listing_url text,
  expected_business_data_json jsonb not null default '{}',
  found_business_data_json jsonb not null default '{}',
  discovered_at timestamptz not null default now(),
  last_verified_at timestamptz,
  verification_status text not null default 'discovered' check (verification_status in (
    'discovered', 'pending_verification', 'verified_live', 'inconsistent', 'duplicate_suspected',
    'not_found', 'verification_failed', 'needs_manual_review')),
  verification_method text,
  evidence_json jsonb not null default '{}',
  follow_up_status text,
  notes text
);

-- ---------------------------------------------------------------------------
-- Google integrations (Phase 4)
-- ---------------------------------------------------------------------------

create table integration_connections (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  project_id uuid references projects(id) on delete cascade,
  provider text not null check (provider in ('gsc', 'ga4')),
  external_property_id text,
  connection_status text not null check (connection_status in ('connected', 'needs_authorization', 'not_connected', 'error')),
  scopes_json jsonb not null default '[]',
  -- Encrypted server-side (AES-GCM, key outside the database). Never sent to browsers.
  encrypted_credentials bytea,
  last_sync_at timestamptz,
  last_error text,
  created_at timestamptz not null default now()
);

create table gsc_daily_metrics (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  property_id text not null,
  date date not null,
  query text,
  page text,
  country text,
  device text,
  clicks integer not null,
  impressions integer not null,
  ctr double precision,
  average_position double precision,
  dimensions_json jsonb not null default '{}'
);
create index gsc_daily_metrics_idx on gsc_daily_metrics (project_id, date);

create table ga4_daily_metrics (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  property_id text not null,
  date date not null,
  landing_page text,
  channel_group text,
  sessions integer,
  active_users integer,
  engaged_sessions integer,
  key_events double precision,
  revenue numeric(14, 2),
  dimensions_json jsonb not null default '{}'
);
create index ga4_daily_metrics_idx on ga4_daily_metrics (project_id, date);

-- ---------------------------------------------------------------------------
-- Usage, budgets, access, reports, audit
-- ---------------------------------------------------------------------------

create table provider_usage (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  project_id uuid references projects(id) on delete set null,
  job_id uuid references tracking_jobs(id) on delete set null,
  provider text not null,
  module text not null,
  units_requested numeric(12, 4) not null default 0,
  units_consumed numeric(12, 4),
  estimated_cost numeric(12, 6),
  actual_cost numeric(12, 6),
  currency text not null default 'USD',
  recorded_at timestamptz not null default now()
);
create index provider_usage_period_idx on provider_usage (organization_id, recorded_at);
create index provider_usage_project_idx on provider_usage (project_id, recorded_at);

create table budgets (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  -- Null project/module = organization-wide (global) budget.
  project_id uuid references projects(id) on delete cascade,
  module text check (module in ('organic', 'maps', 'llm', 'citations')),
  monthly_limit numeric(12, 2) not null check (monthly_limit >= 0),
  currency text not null default 'USD',
  alert_threshold_pct integer not null default 80 check (alert_threshold_pct between 1 and 100),
  -- What happens to new paid jobs once the limit is reached.
  on_limit text not null default 'require_approval' check (on_limit in ('block', 'require_approval')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index budgets_scope_key on budgets (
  organization_id,
  coalesce(project_id, '00000000-0000-0000-0000-000000000000'::uuid),
  coalesce(module, ''));

create table client_project_access (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  role text not null default 'viewer' check (role in ('viewer', 'viewer_with_refresh')),
  granted_by uuid references users(id) on delete set null,
  expires_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);
create index client_project_access_user_idx on client_project_access (user_id) where revoked_at is null;

create table report_exports (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  requested_by uuid references users(id) on delete set null,
  date_range_start date not null,
  date_range_end date not null,
  format text not null check (format in ('pdf', 'csv')),
  status text not null check (status in ('queued', 'running', 'completed', 'failed')),
  storage_reference text,
  created_at timestamptz not null default now()
);

create table audit_logs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  actor_user_id uuid references users(id) on delete set null,
  action text not null,
  entity_type text not null,
  entity_id uuid,
  metadata_json jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create index audit_logs_entity_idx on audit_logs (entity_type, entity_id, created_at desc);
create index audit_logs_org_idx on audit_logs (organization_id, created_at desc);
