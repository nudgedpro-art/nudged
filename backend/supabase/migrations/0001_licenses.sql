-- Nudged licence store. One row per paying customer. Tables are prefixed nudged_ because they share a Supabase project with Dockhand.
-- Keys are issued by the stripe-webhook function and checked by license-check.

create extension if not exists pgcrypto;

create table if not exists public.nudged_licenses (
  id                    uuid primary key default gen_random_uuid(),
  license_key           text not null unique,              -- ND-XXXX-XXXX-XXXX-XXXX
  email                 text not null,
  stripe_customer_id    text unique,
  stripe_subscription_id text unique,
  plan                  text not null default 'monthly',   -- monthly | yearly
  status                text not null default 'active',    -- active | past_due | cancelled
  current_period_end    timestamptz,
  last_checked_at       timestamptz,
  check_count           integer not null default 0,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

create index if not exists nudged_licenses_email_idx on public.nudged_licenses (email);

-- Nobody reads or writes this table through the public API; only the two
-- edge functions do, with the service role key.
alter table public.nudged_licenses enable row level security;

-- Audit of every webhook we accepted, so a replayed or doubled event is harmless.
create table if not exists public.nudged_stripe_events (
  id          text primary key,            -- Stripe event id (evt_...)
  type        text not null,
  received_at timestamptz not null default now()
);
alter table public.nudged_stripe_events enable row level security;

-- Key generator: 16 unambiguous characters in four groups.
create or replace function public.gen_nudged_license_key() returns text
language plpgsql as $$
declare
  alphabet text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  out text := 'ND';
  i int;
begin
  for i in 1..16 loop
    if (i - 1) % 4 = 0 then out := out || '-'; end if;
    out := out || substr(alphabet, 1 + floor(random() * length(alphabet))::int, 1);
  end loop;
  return out;
end $$;
