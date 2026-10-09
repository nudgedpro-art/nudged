-- Nudged app backend (Track B, M1).
-- One Supabase user per person; one Google connection per user; notes are the
-- extracted items only (never message bodies). Google refresh tokens live in
-- Vault and are reachable only through SECURITY DEFINER functions that the
-- service role may call.

create extension if not exists pgcrypto;
create extension if not exists supabase_vault;
create extension if not exists pg_cron;
create extension if not exists pg_net;

-- ---------------------------------------------------------------- profiles
create table if not exists public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  email       text not null,
  timezone    text not null default 'America/Toronto',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz
);
alter table public.profiles enable row level security;
drop policy if exists "profiles: own row" on public.profiles;
create policy "profiles: own row" on public.profiles
  for select using (auth.uid() = id);
drop policy if exists "profiles: update own" on public.profiles;
create policy "profiles: update own" on public.profiles
  for update using (auth.uid() = id) with check (auth.uid() = id);

create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email)
  values (new.id, coalesce(new.email, ''))
  on conflict (id) do update set email = excluded.email;
  return new;
end $$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ------------------------------------------------------ google_connections
create table if not exists public.google_connections (
  user_id            uuid primary key references public.profiles (id) on delete cascade,
  google_sub         text not null,
  email              text not null,
  refresh_secret_id  uuid,                       -- vault.secrets.id
  scopes             text[] not null default '{}',
  history_id         text,                       -- Gmail historyId high-water mark
  last_sync_at       timestamptz,
  watch_expiration   timestamptz,                -- Gmail users.watch expiry, when push is on
  status             text not null default 'active',   -- active | revoked | error
  last_error         text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create unique index if not exists google_connections_sub_idx on public.google_connections (google_sub);
alter table public.google_connections enable row level security;
-- Users may see that a connection exists and its status, never the secret id.
drop policy if exists "google_connections: own row" on public.google_connections;
create policy "google_connections: own row" on public.google_connections
  for select using (auth.uid() = user_id);
revoke all on public.google_connections from anon, authenticated;
grant select (user_id, email, scopes, last_sync_at, status, last_error, created_at, updated_at)
  on public.google_connections to authenticated;

-- ------------------------------------------------------------------ notes
-- Same shape as the plugin's board documents, so the two products stay aligned.
create table if not exists public.notes (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references public.profiles (id) on delete cascade,
  doc_id        text not null,                       -- kebab slug, unique per user
  title         text not null,
  kind          text not null check (kind in ('commitment','event')),
  status        text not null default 'pending'
                check (status in ('pending','scheduled','done','dismissed','cancelled')),
  manual        boolean not null default false,
  needs_me      boolean not null default false,
  who           text not null default '',
  expected      date,
  expected_end  date,
  "time"        text,                                -- HH:MM local
  time_end      text,
  location      text,
  threads       text[] not null default '{}',        -- Gmail thread ids
  msgs          integer not null default 0,
  event         text,                                -- Calendar event id
  event_url     text,
  source_url    text,
  subject       text,
  nudged        date,
  note          text not null default '',
  clips         jsonb not null default '[]'::jsonb,  -- [{at, from, text, subject}]
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  closed_at     timestamptz,
  unique (user_id, doc_id)
);
create index if not exists notes_user_status_idx on public.notes (user_id, status);
alter table public.notes enable row level security;
drop policy if exists "notes: own rows" on public.notes;
create policy "notes: own rows" on public.notes
  for select using (auth.uid() = user_id);
drop policy if exists "notes: insert own" on public.notes;
create policy "notes: insert own" on public.notes
  for insert with check (auth.uid() = user_id);
drop policy if exists "notes: update own" on public.notes;
create policy "notes: update own" on public.notes
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ------------------------------------------------------- processed_messages
-- Replaces the plugin's Gmail "Seen" label: the app never labels a user's mail.
create table if not exists public.processed_messages (
  user_id      uuid not null references public.profiles (id) on delete cascade,
  message_id   text not null,
  thread_id    text,
  processed_at timestamptz not null default now(),
  primary key (user_id, message_id)
);
alter table public.processed_messages enable row level security;   -- service role only

-- --------------------------------------------------------------- sync_runs
create table if not exists public.sync_runs (
  id           bigserial primary key,
  user_id      uuid references public.profiles (id) on delete cascade,
  started_at   timestamptz not null default now(),
  finished_at  timestamptz,
  messages     integer not null default 0,
  created      integer not null default 0,
  updated      integer not null default 0,
  nudges       integer not null default 0,
  error        text
);
alter table public.sync_runs enable row level security;            -- service role only

-- ---------------------------------------------------------------- licences
-- The app shares the plugin's licence table: one row per Google account email.
alter table public.licenses add column if not exists user_id uuid references public.profiles (id) on delete set null;
alter table public.licenses add column if not exists trial_ends_at timestamptz;
alter table public.licenses alter column plan set default 'trial';

-- Called by the connect flow (service role). Links an existing paid licence to
-- the user, or starts a 14-day trial for a new email. Returns the licence row.
create or replace function public.ensure_license_for_user(p_user_id uuid, p_email text)
returns public.licenses
language plpgsql security definer set search_path = public as $$
declare
  lic public.licenses;
begin
  select * into lic from public.licenses where lower(email) = lower(p_email)
    order by (status = 'active') desc, created_at desc limit 1;
  if found then
    update public.licenses set user_id = p_user_id, updated_at = now() where id = lic.id returning * into lic;
    return lic;
  end if;
  insert into public.licenses (license_key, email, plan, status, trial_ends_at, current_period_end, user_id)
  values (public.gen_license_key(), p_email, 'trial', 'active', now() + interval '14 days', now() + interval '14 days', p_user_id)
  returning * into lic;
  return lic;
end $$;
revoke all on function public.ensure_license_for_user(uuid, text) from public, anon, authenticated;

-- What the app may read about its own licence (no key, no Stripe ids).
create or replace view public.my_license as
  select plan, status, current_period_end, trial_ends_at
  from public.licenses where user_id = auth.uid();
grant select on public.my_license to authenticated;

-- ------------------------------------------------------------------- vault
-- Refresh tokens: written once by the connect flow, read per job by the sync
-- function, deleted on disconnect or account deletion. Service role only.
create or replace function public.store_google_refresh_token(p_user_id uuid, p_token text)
returns uuid language plpgsql security definer set search_path = public, vault as $$
declare
  sid uuid;
begin
  select refresh_secret_id into sid from public.google_connections where user_id = p_user_id;
  if sid is not null and exists (select 1 from vault.secrets where id = sid) then
    perform vault.update_secret(sid, p_token);
  else
    sid := vault.create_secret(p_token, 'google_refresh:' || p_user_id::text, 'Nudged Google refresh token');
  end if;
  update public.google_connections set refresh_secret_id = sid, updated_at = now() where user_id = p_user_id;
  return sid;
end $$;

create or replace function public.read_google_refresh_token(p_user_id uuid)
returns text language sql security definer set search_path = public, vault as $$
  select s.decrypted_secret
  from public.google_connections c
  join vault.decrypted_secrets s on s.id = c.refresh_secret_id
  where c.user_id = p_user_id;
$$;

create or replace function public.delete_google_refresh_token(p_user_id uuid)
returns void language plpgsql security definer set search_path = public, vault as $$
declare
  sid uuid;
begin
  select refresh_secret_id into sid from public.google_connections where user_id = p_user_id;
  if sid is not null then
    delete from vault.secrets where id = sid;
    update public.google_connections set refresh_secret_id = null, updated_at = now() where user_id = p_user_id;
  end if;
end $$;

revoke all on function public.store_google_refresh_token(uuid, text) from public, anon, authenticated;
revoke all on function public.read_google_refresh_token(uuid) from public, anon, authenticated;
revoke all on function public.delete_google_refresh_token(uuid) from public, anon, authenticated;

-- ------------------------------------------------------------ account delete
-- Everything a person leaves behind, in one call. Token revocation at Google
-- happens in the account-delete edge function before this runs.
create or replace function public.delete_account(p_user_id uuid)
returns void language plpgsql security definer set search_path = public, vault, auth as $$
begin
  perform public.delete_google_refresh_token(p_user_id);
  delete from public.notes where user_id = p_user_id;
  delete from public.processed_messages where user_id = p_user_id;
  delete from public.sync_runs where user_id = p_user_id;
  delete from public.google_connections where user_id = p_user_id;
  update public.licenses set user_id = null where user_id = p_user_id;
  delete from public.profiles where id = p_user_id;
  delete from auth.users where id = p_user_id;
end $$;
revoke all on function public.delete_account(uuid) from public, anon, authenticated;

-- ------------------------------------------------------------------- cron
-- The sync function is invoked every 15 minutes with a shared secret that is
-- itself kept in Vault (named 'nudged_cron_secret'); see invoke_nudged_sync.
create or replace function public.invoke_nudged_sync()
returns bigint language plpgsql security definer set search_path = public, vault, net as $$
declare
  secret text;
  rid bigint;
begin
  select decrypted_secret into secret from vault.decrypted_secrets where name = 'nudged_cron_secret';
  if secret is null then raise exception 'nudged_cron_secret missing from vault'; end if;
  select net.http_post(
    url := 'https://sdtbdrrcppjeilwhvwbw.supabase.co/functions/v1/nudged-sync',
    headers := jsonb_build_object('content-type', 'application/json', 'x-cron-secret', secret),
    body := '{}'::jsonb,
    timeout_milliseconds := 120000
  ) into rid;
  return rid;
end $$;
revoke all on function public.invoke_nudged_sync() from public, anon, authenticated;
