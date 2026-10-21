-- Hand-off channels: WhatsApp forwards and share-sheet. See docs/forward-to-nudged.md.

-- Where a note came from. Email notes are the default.
alter table public.notes add column if not exists source text not null default 'email'
  check (source in ('email', 'whatsapp', 'share', 'imessage'));
alter table public.notes add column if not exists source_ref text;      -- inbound_messages.id for hand-off notes

-- A linked external identity per user per channel (today: WhatsApp wa_id).
create table if not exists public.channel_links (
  user_id      uuid not null references public.profiles (id) on delete cascade,
  channel      text not null check (channel in ('whatsapp')),
  external_id  text not null,                      -- WhatsApp wa_id: E.164 digits, no plus
  display      text,                               -- masked number for Settings
  linked_at    timestamptz not null default now(),
  primary key (channel, external_id),
  unique (user_id, channel)
);
alter table public.channel_links enable row level security;
drop policy if exists "channel_links: own rows" on public.channel_links;
create policy "channel_links: own rows" on public.channel_links
  for select using (auth.uid() = user_id);

-- One-time codes the user sends from their own WhatsApp to prove the number is theirs.
create table if not exists public.link_codes (
  code        text primary key,                    -- NUDGED-XXXX
  user_id     uuid not null references public.profiles (id) on delete cascade,
  channel     text not null,
  expires_at  timestamptz not null,
  used_at     timestamptz
);
alter table public.link_codes enable row level security;             -- service role only

-- Every message handed to Nudged. body is nulled once processed (24 h worst case).
create table if not exists public.inbound_messages (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid references public.profiles (id) on delete cascade,
  channel       text not null check (channel in ('whatsapp', 'share')),
  external_id   text,                              -- WhatsApp message id; null for share
  body          text,
  from_hint     text,                              -- "Mike the plumber", if the user told us
  received_at   timestamptz not null default now(),
  processed_at  timestamptz,
  note_id       uuid references public.notes (id) on delete set null,
  outcome       text,                              -- added | updated | nothing_found | needs_from | plan_blocked | unlinked | error
  attempts      integer not null default 0,
  unique (channel, external_id)
);
create index if not exists inbound_messages_user_idx on public.inbound_messages (user_id, received_at desc);
alter table public.inbound_messages enable row level security;
drop policy if exists "inbound: own rows" on public.inbound_messages;
create policy "inbound: own rows" on public.inbound_messages
  for select using (auth.uid() = user_id);

-- Housekeeping for the retry sweep: anything unprocessed for a day loses its body.
create or replace function public.inbound_scrub_stale() returns integer
language sql security definer set search_path = public as $$
  with s as (
    update public.inbound_messages set body = null, outcome = coalesce(outcome, 'error'), processed_at = now()
    where processed_at is null and received_at < now() - interval '24 hours'
    returning 1
  ) select count(*)::int from s;
$$;
revoke all on function public.inbound_scrub_stale() from public, anon, authenticated;

-- Code generator: NUDGED- plus four unambiguous characters.
create or replace function public.gen_link_code() returns text
language plpgsql as $$
declare
  alphabet text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  out text := 'NUDGED-';
  i int;
begin
  for i in 1..4 loop
    out := out || substr(alphabet, 1 + floor(random() * length(alphabet))::int, 1);
  end loop;
  return out;
end $$;
