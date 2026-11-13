-- 0010 Sign-in protection: a record of sign-in attempts, used to slow down
-- password guessing, and what is needed to stop a two-step code being used twice.

create table sign_in_attempts (
  id         bigint generated always as identity primary key,
  kind       text not null check (kind in ('customer', 'staff', 'staff_two_step', 'code', 'sign_up')),
  -- The email address tried, whether or not an account exists for it.
  subject    citext not null,
  ip         inet,
  succeeded  boolean not null,
  created_at timestamptz not null default now()
);
create index sign_in_attempts_subject on sign_in_attempts (kind, subject, created_at desc);
create index sign_in_attempts_ip on sign_in_attempts (ip, created_at desc);
create index sign_in_attempts_time on sign_in_attempts (created_at);

-- The time step of the last two-step code a staff member used. A code at or
-- before this step is refused, so a code seen over someone's shoulder is useless.
alter table staff add column totp_last_step bigint;
