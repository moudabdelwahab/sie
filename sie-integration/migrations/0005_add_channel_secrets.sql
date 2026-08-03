-- 0005_add_channel_secrets.sql
-- ============================================================================
-- STATUS: APPLIED to the shared Mad3oom/SIE project (srnelrdpqkcntbgudyto).
--
-- Secrets a channel webhook needs but that cannot be set as environment
-- variables from the management API (there is no set-secrets endpoint).
--
-- An environment variable remains the preferred home for a shared secret:
-- the function reads TELEGRAM_WEBHOOK_SECRET first and only falls back to
-- this table. This exists so the channel can be brought up without CLI
-- access, not to replace env vars.
--
-- Security posture: RLS is on with NO policies at all, which denies every
-- role except service_role (which bypasses RLS). That is the same authority
-- that already holds the bot token, so this is not a weaker store for this
-- threat model — it is a more visible one, which is why the env var wins
-- when present. Spelling "no policies" out because it otherwise reads as an
-- oversight.
-- ============================================================================

create table if not exists public.channel_secrets (
    key        text primary key,
    value      text not null,
    updated_at timestamptz not null default now()
);

alter table public.channel_secrets enable row level security;
revoke all on public.channel_secrets from anon, authenticated;

-- 32 random bytes, base64url — inside Telegram's allowed alphabet for
-- secret_token (A-Z a-z 0-9 _ -) and far beyond guessable.
insert into public.channel_secrets (key, value)
values (
    'telegram_webhook_secret',
    translate(encode(gen_random_bytes(32), 'base64'), '+/=', '-_')
)
on conflict (key) do nothing;

-- One-time bootstrap flag. The function registers its own webhook with
-- Telegram only while this is true, and clears it on success — so a cold
-- start can never silently repoint a webhook configured by hand.
insert into public.channel_secrets (key, value)
values ('telegram_autoregister', 'true')
on conflict (key) do update set value = 'true', updated_at = now();
