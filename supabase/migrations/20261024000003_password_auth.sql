-- Built-in email + password authentication (used when Supabase Auth is not configured).
alter table users add column if not exists password_hash text;
alter table users add column if not exists password_updated_at timestamptz;

-- Server-side sessions so sign-out and password changes revoke access immediately.
-- Only a SHA-256 hash of the session token is stored.
create table auth_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  token_hash text not null unique,
  created_at timestamptz not null default now(),
  last_used_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  user_agent text,
  ip text
);
create index auth_sessions_user_idx on auth_sessions (user_id) where revoked_at is null;

alter table auth_sessions enable row level security;
