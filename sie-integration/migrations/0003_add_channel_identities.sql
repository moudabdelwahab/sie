-- 0003_add_channel_identities.sql
-- ============================================================================
-- STATUS: APPLIED to the shared Mad3oom/SIE project (srnelrdpqkcntbgudyto).
--
-- Ties a conversation on an external channel (Telegram, WhatsApp, Messenger)
-- to a Mad3oom account, so a channel message can be metered and attributed.
--
-- Without this there is no safe way to answer a Telegram sender at all: they
-- are a number in Telegram's id space, and SIE meters per account. Answering
-- anyone who writes in would let a stranger spend a paying customer's quota
-- and file tickets in their name.
--
-- See channels/README.md for why this is a new table rather than a reuse of
-- profiles.telegram_chat_id (that column carries the account owner's 2FA
-- codes and ticket alerts; overloading it would redirect them).
-- ============================================================================

create table if not exists public.channel_identities (
    id              uuid primary key default gen_random_uuid(),
    user_id         uuid not null references auth.users (id) on delete cascade,
    channel         text not null check (channel in ('website','telegram','whatsapp','messenger','api')),
    channel_user_id text not null,
    channel_chat_id text,
    display_name    text,
    is_active       boolean not null default true,
    linked_at       timestamptz not null default now(),
    last_seen_at    timestamptz,
    -- One account per channel identity. Without this a second link would
    -- silently move someone's conversations onto another account's quota.
    unique (channel, channel_user_id)
);

create index if not exists channel_identities_user_idx on public.channel_identities (user_id, channel);

alter table public.channel_identities enable row level security;

drop policy if exists channel_identities_select on public.channel_identities;
create policy channel_identities_select on public.channel_identities
    for select to authenticated
    using (user_id = auth.uid() or public.is_chat_engine_staff());

drop policy if exists channel_identities_delete on public.channel_identities;
create policy channel_identities_delete on public.channel_identities
    for delete to authenticated
    using (user_id = auth.uid() or public.is_sie_admin());

-- No INSERT/UPDATE policy on purpose: rows are only ever written by
-- channel_redeem_link_code() below, which is SECURITY DEFINER. A customer
-- must not be able to insert a link for a chat id they have not proved they
-- control.

-- ---------------------------------------------------------------------------
-- Single-use, expiring codes proving one person controls both an account and
-- a chat.
-- ---------------------------------------------------------------------------
create table if not exists public.channel_link_codes (
    code        text primary key,
    user_id     uuid not null references auth.users (id) on delete cascade,
    channel     text not null check (channel in ('telegram','whatsapp','messenger')),
    expires_at  timestamptz not null,
    redeemed_at timestamptz,
    created_at  timestamptz not null default now()
);

create index if not exists channel_link_codes_user_idx on public.channel_link_codes (user_id);

alter table public.channel_link_codes enable row level security;

drop policy if exists channel_link_codes_select on public.channel_link_codes;
create policy channel_link_codes_select on public.channel_link_codes
    for select to authenticated
    using (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- Mints a code for the calling user. SECURITY DEFINER so the row is written
-- with a user_id the caller cannot choose — it is always auth.uid().
-- ---------------------------------------------------------------------------
create or replace function public.channel_create_link_code(p_channel text)
returns table (code text, expires_at timestamptz)
language plpgsql
security definer
set search_path to 'public'
as $$
declare
    v_code text;
    v_expires timestamptz;
begin
    if auth.uid() is null then
        raise exception 'authentication required';
    end if;
    if p_channel not in ('telegram','whatsapp','messenger') then
        raise exception 'unsupported channel: %', p_channel;
    end if;

    -- An alphabet without 0/O/1/I/L: these codes are read off a screen and
    -- typed into a phone, and those are the pairs people get wrong.
    select string_agg(substr('ABCDEFGHJKMNPQRSTUVWXYZ23456789',
                             (floor(random() * 31)::int) + 1, 1), '')
      into v_code
      from generate_series(1, 8);

    v_expires := now() + interval '15 minutes';

    -- Supersede any code still outstanding for this user and channel, so a
    -- code visible in an old screenshot stops working the moment a new one
    -- is requested.
    delete from public.channel_link_codes
     where user_id = auth.uid() and channel = p_channel and redeemed_at is null;

    insert into public.channel_link_codes (code, user_id, channel, expires_at)
    values (v_code, auth.uid(), p_channel, v_expires);

    return query select v_code, v_expires;
end;
$$;

-- ---------------------------------------------------------------------------
-- Redeems a code and creates the link, atomically.
--
-- Called by the channel webhook with the service-role key: there is no user
-- session to act as, because the person is on Telegram, not on the platform.
-- The code IS the proof of identity, which is why it is single-use and
-- consumed under a row lock — two racing redemptions must not both succeed.
-- ---------------------------------------------------------------------------
create or replace function public.channel_redeem_link_code(
    p_code            text,
    p_channel         text,
    p_channel_user_id text,
    p_channel_chat_id text default null,
    p_display_name    text default null
)
returns table (success boolean, user_id uuid, reason text)
language plpgsql
security definer
set search_path to 'public'
as $$
declare
    v_row public.channel_link_codes%rowtype;
begin
    select * into v_row from public.channel_link_codes
     where code = upper(p_code) for update;

    if not found then
        return query select false, null::uuid, 'unknown_code'::text; return;
    end if;
    if v_row.redeemed_at is not null then
        return query select false, null::uuid, 'already_used'::text; return;
    end if;
    if v_row.expires_at < now() then
        return query select false, null::uuid, 'expired'::text; return;
    end if;
    if v_row.channel <> p_channel then
        return query select false, null::uuid, 'wrong_channel'::text; return;
    end if;

    update public.channel_link_codes set redeemed_at = now() where code = v_row.code;

    -- Re-linking the same chat to a different account simply moves it; that
    -- is the only sane behaviour when someone changes which account they
    -- support from.
    insert into public.channel_identities (user_id, channel, channel_user_id, channel_chat_id, display_name)
    values (v_row.user_id, p_channel, p_channel_user_id, p_channel_chat_id, p_display_name)
    on conflict (channel, channel_user_id)
    do update set user_id = excluded.user_id,
                  channel_chat_id = excluded.channel_chat_id,
                  display_name = excluded.display_name,
                  is_active = true,
                  linked_at = now();

    return query select true, v_row.user_id, null::text;
end;
$$;

-- ---------------------------------------------------------------------------
-- Grants.
--
-- `revoke ... from public` does NOT remove Supabase's default per-role grants
-- to anon and authenticated — they must be revoked by name. Without this, any
-- visitor holding the public anon key could hammer channel_redeem_link_code()
-- to brute-force an 8-character code.
-- ---------------------------------------------------------------------------
revoke all on function public.channel_create_link_code(text) from public;
revoke execute on function public.channel_create_link_code(text) from anon;
grant execute on function public.channel_create_link_code(text) to authenticated;

revoke all on function public.channel_redeem_link_code(text, text, text, text, text) from public;
revoke execute on function public.channel_redeem_link_code(text, text, text, text, text) from anon, authenticated;
grant execute on function public.channel_redeem_link_code(text, text, text, text, text) to service_role;
