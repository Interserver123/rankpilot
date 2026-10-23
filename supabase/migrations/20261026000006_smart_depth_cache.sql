-- Short-lived cache of raw organic results so identical searches are not paid for twice,
-- and per-usage-row savings so the app can show what smart depth and the cache saved.
create table serp_cache (
  cache_key text primary key,
  provider text not null,
  depth integer not null,
  requested_location text not null,
  organic_json jsonb not null,
  features_json jsonb not null default '[]'::jsonb,
  fetched_at timestamptz not null default now()
);
create index serp_cache_fetched_idx on serp_cache (fetched_at);
alter table serp_cache enable row level security;

alter table provider_usage add column saved_units numeric(12, 4) not null default 0;
alter table provider_usage add column saved_cost numeric(12, 6) not null default 0;
