-- Provider API keys and settings entered by an admin in the dashboard.
-- Secrets are AES-256-GCM encrypted by the app (key from APP_ENCRYPTION_KEY); the database never sees plaintext.
create table provider_credentials (
  provider_id text primary key,
  secrets_enc text,                              -- encrypted JSON {field: value}
  hints_json jsonb not null default '{}'::jsonb, -- {field: "last 4 characters"} for display only
  settings_json jsonb not null default '{}'::jsonb, -- non-secret settings, e.g. price per request
  updated_by uuid references users(id) on delete set null,
  updated_at timestamptz not null default now()
);

alter table provider_credentials enable row level security;
