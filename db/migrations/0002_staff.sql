-- 0002 Staff: roles, permissions, staff accounts, sessions and the activity log.

create table roles (
  id         bigint generated always as identity primary key,
  name       citext not null unique,
  -- The owner role can do everything and cannot be edited or removed.
  is_owner   boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index roles_one_owner on roles (is_owner) where is_owner;
create trigger roles_updated before update on roles for each row execute function set_updated_at();

-- What a role may see and change, per area of the admin.
create table role_permissions (
  role_id    bigint not null references roles (id) on delete cascade,
  area       text not null check (area in ('orders', 'returns', 'products', 'customers', 'discounts', 'settings', 'reports')),
  can_view   boolean not null default false,
  can_change boolean not null default false,
  primary key (role_id, area),
  check (can_view or not can_change)
);

create table staff (
  id              bigint generated always as identity primary key,
  name            text not null check (length(trim(name)) > 0),
  email           citext not null unique,
  -- scrypt hash; empty until the invited person sets a password.
  password_hash   text,
  role_id         bigint not null references roles (id),
  -- Two-step verification secret, encrypted with a key from the server settings.
  totp_secret_enc bytea,
  totp_enabled_at timestamptz,
  status          text not null default 'invited' check (status in ('invited', 'active', 'disabled')),
  last_sign_in_at timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  -- Nobody is active without both a password and two-step verification.
  check (status <> 'active' or (password_hash is not null and totp_enabled_at is not null))
);
create index staff_role on staff (role_id);
create trigger staff_updated before update on staff for each row execute function set_updated_at();

create table staff_invites (
  id          bigint generated always as identity primary key,
  staff_id    bigint not null references staff (id) on delete cascade,
  token_hash  bytea not null unique,
  invited_by  bigint references staff (id) on delete set null,
  expires_at  timestamptz not null,
  accepted_at timestamptz,
  created_at  timestamptz not null default now()
);
create index staff_invites_staff on staff_invites (staff_id);

-- Only a hash of the session token is stored, so a copy of the database
-- cannot be used to sign in.
create table staff_sessions (
  id           bigint generated always as identity primary key,
  staff_id     bigint not null references staff (id) on delete cascade,
  token_hash   bytea not null unique,
  ip           inet,
  user_agent   text,
  created_at   timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  expires_at   timestamptz not null,
  revoked_at   timestamptz
);
create index staff_sessions_staff on staff_sessions (staff_id);

-- Every change made in the admin. Rows are never edited or deleted.
create table activity_log (
  id          bigint generated always as identity primary key,
  staff_id    bigint references staff (id) on delete set null,
  staff_name  text not null,
  area        text not null,
  summary     text not null,
  entity_type text,
  entity_id   text,
  details     jsonb not null default '{}',
  ip          inet,
  created_at  timestamptz not null default now()
);
create index activity_log_time on activity_log (created_at desc);
create index activity_log_area on activity_log (area, created_at desc);
create index activity_log_staff on activity_log (staff_id, created_at desc);
create index activity_log_entity on activity_log (entity_type, entity_id);

insert into roles (name, is_owner) values ('Owner', true);
insert into role_permissions (role_id, area, can_view, can_change)
select r.id, a.area, true, true
from roles r
cross join (values ('orders'), ('returns'), ('products'), ('customers'), ('discounts'), ('settings'), ('reports')) as a (area)
where r.is_owner;
