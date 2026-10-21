-- Free plan. A licence row can now exist without Stripe.
-- plan: free | monthly | yearly. Free rows have no subscription and no period end.

alter table public.licenses
  drop constraint if exists licenses_plan_check;
alter table public.licenses
  add constraint licenses_plan_check check (plan in ('free', 'monthly', 'yearly'));

-- One free key per email, so a lapsed subscriber cannot farm free keys.
create unique index if not exists licenses_free_email_idx
  on public.licenses (lower(email)) where plan = 'free';

-- Rate limit for free-signup: one row per request, pruned by the function.
create table if not exists public.signup_attempts (
  id          uuid primary key default gen_random_uuid(),
  ip_hash     text not null,
  email       text not null,
  created_at  timestamptz not null default now()
);
create index if not exists signup_attempts_created_idx on public.signup_attempts (created_at);
alter table public.signup_attempts enable row level security;
