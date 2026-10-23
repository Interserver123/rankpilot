-- The workspace owner: always an admin, cannot be removed, demoted or have their password reset by others.
alter table organizations add column if not exists owner_user_id uuid references users(id) on delete set null;
