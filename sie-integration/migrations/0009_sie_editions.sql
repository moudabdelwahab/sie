-- 0009_sie_editions.sql
-- ============================================================
-- إصدارات SIE — المجاني / برو / ماكس — في قاعدة البيانات.
--
-- NOT APPLIED TO PRODUCTION BY THE CHANGE THAT ADDS IT. The engine already
-- runs correctly without it: every customer answers as `default_edition`
-- (Free unless staff change it), which is today's behaviour exactly. Apply
-- it when the per-customer edition, the per-edition rate limit and the
-- per-edition monthly cap are wanted — in that order of risk, it changes
-- nothing for anyone until an admin sets a value.
--
-- ------------------------------------------------------------
-- WHAT IT ADDS
--
--   1. customer_sie_access.edition (NULL = "use default_edition") plus the
--      two columns the monthly cap needs.
--   2. sie_consume_message() now also returns the customer's edition, and
--      enforces the edition's monthly cap when one is configured
--      (`edition_<id>_monthly_messages` > 0). Its existing four branches
--      (not_enabled / disabled / expired / quota_exceeded) are unchanged
--      and run first, in the same order.
--   3. sie_rate_limit_hit(), sie_api_rate_limit_hit() and
--      sie_admin_rate_limit_status() take the edition's rate when one is
--      configured (`edition_<id>_rate_limit_per_minute` > 0): customer
--      override > edition > global, computed once in
--      sie_rl_effective_limits(). The on/off switch stays global + customer
--      only — an edition cannot switch the limiter off.
--   4. sie_admin_set_access() accepts p_edition.
--
-- ------------------------------------------------------------
-- WHO CAN SET AN EDITION
--
-- customer_sie_access is writable only by is_sie_admin() (policy
-- sie_access_write) and readable by its owner. A customer therefore cannot
-- raise their own edition; the column check additionally keeps a corrupted
-- write to the three real ids. The engine treats anything else as Free
-- (editions.resolveCustomerEdition), so a bad value can only LOSE scope.
--
-- Edition settings live in sie_settings, writable by is_chat_engine_staff()
-- — the same people who can already switch the engine off.

-- ============================================================
-- 1. Columns
-- ============================================================
alter table public.customer_sie_access
    add column if not exists edition text
        check (edition is null or edition in ('free', 'pro', 'max'));

-- The monthly cap counts calendar months in UTC. Separate from
-- messages_used, which is the lifetime counter the `quota` access mode
-- spends and the Review Center reports; mixing the two would make a
-- monthly reset silently refund a lifetime quota.
alter table public.customer_sie_access
    add column if not exists edition_period_start date,
    add column if not exists edition_period_used integer not null default 0;

comment on column public.customer_sie_access.edition is
    'SIE edition (free/pro/max). NULL = the sie_settings default_edition applies.';

-- ============================================================
-- 2. Reading one edition setting
-- ============================================================
-- One definition of "the configured number for this edition's knob", so
-- the two enforcement functions cannot read it differently. NULL when not
-- configured or not a number: callers fall back, never fail.
create or replace function public.sie_edition_setting_int(p_edition text, p_suffix text)
returns integer
language plpgsql
stable
security definer
set search_path = public
as $$
declare
    v_raw jsonb;
begin
    if p_edition not in ('free', 'pro', 'max') then
        return null;
    end if;
    select value into v_raw from public.sie_settings
     where key = 'edition_' || p_edition || p_suffix;
    if v_raw is null or jsonb_typeof(v_raw) <> 'number' then
        return null;
    end if;
    return floor((v_raw #>> '{}')::numeric)::integer;
end;
$$;

-- Internal: only the SECURITY DEFINER functions in this file call it.
revoke all on function public.sie_edition_setting_int(text, text) from public, anon, authenticated;

-- The edition a customer actually runs as: their row, then default_edition,
-- then free. Mirrors editions.resolveCustomerEdition exactly.
create or replace function public.sie_effective_edition(p_row_edition text)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
    v_default text;
begin
    if p_row_edition in ('free', 'pro', 'max') then
        return p_row_edition;
    end if;
    select value #>> '{}' into v_default from public.sie_settings where key = 'default_edition';
    if v_default in ('free', 'pro', 'max') then
        return v_default;
    end if;
    return 'free';
end;
$$;

revoke all on function public.sie_effective_edition(text) from public, anon, authenticated;

-- ============================================================
-- 3. sie_consume_message — returns the edition, enforces the monthly cap
-- ============================================================
-- The return type changes (a fourth column), which CREATE OR REPLACE cannot
-- do, hence drop + create inside this migration's transaction. Callers read
-- columns by name (sie-entitlement.js), so the extra column is additive.
drop function if exists public.sie_consume_message(uuid);

create function public.sie_consume_message(p_user_id uuid)
returns table (allowed boolean, reason text, remaining integer, edition text)
language plpgsql
security definer
set search_path = public
as $$
declare
    v_row     public.customer_sie_access%rowtype;
    v_edition text;
    v_cap     integer;
    v_month   date := date_trunc('month', timezone('utc', now()))::date;
    v_used    integer;
begin
    if p_user_id is null then
        return query select false, 'unauthorized'::text, null::integer, null::text;
        return;
    end if;

    -- Either the caller IS this user, or the caller is the service role
    -- acting for them from a channel webhook. (Unchanged from 0004.)
    if p_user_id <> coalesce(auth.uid(), p_user_id) or
       (auth.uid() is null and coalesce(auth.role(), '') <> 'service_role') then
        return query select false, 'unauthorized'::text, null::integer, null::text;
        return;
    end if;

    select * into v_row
    from public.customer_sie_access
    where user_id = p_user_id
    for update;

    if not found then
        return query select false, 'not_enabled'::text, null::integer, null::text;
        return;
    end if;

    v_edition := sie_effective_edition(v_row.edition);

    if not v_row.is_enabled then
        return query select false, 'disabled'::text, null::integer, v_edition;
        return;
    end if;

    if v_row.access_mode = 'expiration' and v_row.expires_at is not null and v_row.expires_at < now() then
        return query select false, 'expired'::text, null::integer, v_edition;
        return;
    end if;

    if v_row.access_mode = 'quota' and v_row.messages_used >= coalesce(v_row.message_quota, 0) then
        return query select false, 'quota_exceeded'::text, 0, v_edition;
        return;
    end if;

    -- The edition's monthly cap. 0 or unset = no edition cap (the default,
    -- which is why applying this migration changes nothing on its own).
    v_cap := sie_edition_setting_int(v_edition, '_monthly_messages');
    v_used := case when v_row.edition_period_start = v_month then v_row.edition_period_used else 0 end;
    if v_cap is not null and v_cap > 0 and v_used >= v_cap then
        return query select false, 'edition_monthly_limit'::text, 0, v_edition;
        return;
    end if;

    update public.customer_sie_access
    set messages_used = messages_used + 1,
        edition_period_start = v_month,
        edition_period_used = v_used + 1,
        last_used_at = now()
    where user_id = p_user_id
    returning messages_used into v_row.messages_used;

    if v_row.access_mode = 'quota' then
        return query select true, null::text,
            least(greatest(v_row.message_quota - v_row.messages_used, 0),
                  case when v_cap > 0 then greatest(v_cap - v_used - 1, 0) else 2147483647 end),
            v_edition;
    elsif v_cap is not null and v_cap > 0 then
        return query select true, null::text, greatest(v_cap - v_used - 1, 0), v_edition;
    else
        return query select true, null::text, null::integer, v_edition;
    end if;
end;
$$;

-- anon could execute the old function and was always refused inside it
-- ('unauthorized'); it is not granted here at all.
revoke all on function public.sie_consume_message(uuid) from public, anon;
grant execute on function public.sie_consume_message(uuid) to authenticated, service_role;

-- ============================================================
-- 4. Rate limits — override > edition > global, in ONE place
-- ============================================================
-- Based on the functions DEPLOYED in production on 2026-09-24, not on this
-- repository's 0008: production has since gained sie_rl_spend(), a
-- service-role twin sie_api_rate_limit_hit(), and a fix for 0008's
-- "no override row wipes the global limit" bug (SELECT ... INTO with no row
-- sets every target to NULL; 0008 as written in this repository leaves any
-- customer without an override row unlimited). Those deployed definitions
-- are reproduced in tests/sql/production-2026-09-24.sql so this migration
-- is tested against what it actually replaces.
--
-- Three functions used to repeat the same inheritance code
-- (sie_rate_limit_hit, sie_api_rate_limit_hit, sie_admin_rate_limit_status).
-- They now share sie_rl_effective_limits(), so the limit the console shows
-- and the limit enforced cannot drift apart when a tier is added — which is
-- exactly what adding the edition tier would otherwise have risked.
create or replace function public.sie_rl_effective_limits(p_user_id uuid)
returns table (enabled boolean, limit_per_min integer, burst integer)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
    v_enabled   boolean;
    v_limit     integer;
    v_burst     integer;
    v_edition   text;
    v_ed_limit  integer;
    v_ed_burst  integer;
    v_o_enabled boolean;
    v_o_limit   integer;
    v_o_burst   integer;
begin
    select coalesce((value #>> '{}')::boolean, true) into v_enabled
      from public.sie_settings where key = 'rate_limit_enabled';
    v_enabled := coalesce(v_enabled, true);

    select coalesce((value #>> '{}')::integer, 100) into v_limit
      from public.sie_settings where key = 'rate_limit_requests_per_minute';
    v_limit := coalesce(v_limit, 100);

    select coalesce((value #>> '{}')::integer, 20) into v_burst
      from public.sie_settings where key = 'rate_limit_burst';
    v_burst := coalesce(v_burst, 20);

    if p_user_id is not null then
        -- Edition: a configured rate (> 0) replaces the global rate and
        -- brings its own burst, clamped to the console's hard limits
        -- (10–5000, 0–500) so a hand-written row cannot size a bucket of 0.
        -- The on/off switch is NOT an edition knob: an edition cannot turn
        -- the limiter off.
        select sie_effective_edition(a.edition) into v_edition
          from public.customer_sie_access a where a.user_id = p_user_id;
        v_edition := coalesce(v_edition, sie_effective_edition(null));
        v_ed_limit := sie_edition_setting_int(v_edition, '_rate_limit_per_minute');
        if v_ed_limit is not null and v_ed_limit > 0 then
            v_limit := least(greatest(v_ed_limit, 10), 5000);
            v_ed_burst := sie_edition_setting_int(v_edition, '_rate_limit_burst');
            if v_ed_burst is not null then
                v_burst := least(greatest(v_ed_burst, 0), 500);
            end if;
        end if;

        -- The customer's own override wins, column by column. Separate
        -- variables: "no row" must not wipe the values above.
        select o.is_enabled, o.requests_per_minute, o.burst
          into v_o_enabled, v_o_limit, v_o_burst
          from public.sie_rate_limit_overrides o
         where o.user_id = p_user_id;
        v_enabled := coalesce(v_o_enabled, v_enabled);
        v_limit   := coalesce(v_o_limit, v_limit);
        v_burst   := coalesce(v_o_burst, v_burst);
    end if;

    return query select v_enabled, v_limit, v_burst;
end;
$$;

-- Called only from the SECURITY DEFINER functions below, which run as the
-- owner; nobody else needs it (it would tell a caller another customer's
-- limits).
revoke all on function public.sie_rl_effective_limits(uuid) from public, anon, authenticated;

-- The two enforcement entry points: identical to production except that
-- the limits come from the helper.
create or replace function public.sie_rate_limit_hit(p_client_ip text default null)
returns table (
    allowed        boolean,
    enabled        boolean,
    limit_per_min  integer,
    remaining      integer,
    reset_seconds  integer,
    retry_after    integer,
    key_used       text
)
language plpgsql
security definer
set search_path = public
as $$
declare
    v_uid       uuid := auth.uid();
    v_key       text;
    v_enabled   boolean;
    v_limit     integer;
    v_burst     integer;
    v_capacity  double precision;
    v_refill    double precision;
    v_tokens    double precision;
    v_allowed   boolean;
begin
    if v_uid is not null then
        v_key := 'user:' || v_uid::text;
    elsif p_client_ip is not null and length(trim(p_client_ip)) > 0 then
        v_key := 'ip:' || left(trim(p_client_ip), 100);
    else
        v_key := 'anon:unknown';
    end if;

    select e.enabled, e.limit_per_min, e.burst into v_enabled, v_limit, v_burst
      from public.sie_rl_effective_limits(v_uid) e;

    if v_enabled is not true then
        return query select true, false, v_limit, v_limit, 0, 0, v_key;
        return;
    end if;

    select s.tokens, s.allowed into v_tokens, v_allowed
      from public.sie_rl_spend(v_key, v_limit, v_burst) s;

    v_capacity := v_limit::double precision + greatest(v_burst, 0)::double precision;
    v_refill   := v_limit::double precision / 60.0;

    return query select
        v_allowed,
        true,
        v_limit,
        greatest(floor(v_tokens)::integer, 0),
        greatest(ceil((v_capacity - v_tokens) / v_refill)::integer, 0),
        case when v_allowed then 0
             else greatest(ceil((1 - v_tokens) / v_refill)::integer, 1) end,
        v_key;
end;
$$;

create or replace function public.sie_api_rate_limit_hit(p_user_id uuid, p_client_ip text default null)
returns table (
    allowed        boolean,
    enabled        boolean,
    limit_per_min  integer,
    remaining      integer,
    reset_seconds  integer,
    retry_after    integer,
    key_used       text
)
language plpgsql
security definer
set search_path = public
as $$
declare
    v_key       text;
    v_enabled   boolean;
    v_limit     integer;
    v_burst     integer;
    v_capacity  double precision;
    v_refill    double precision;
    v_tokens    double precision;
    v_allowed   boolean;
begin
    if coalesce(auth.role(), '') <> 'service_role' then
        raise exception 'access denied' using errcode = '42501';
    end if;

    if p_user_id is not null then
        v_key := 'user:' || p_user_id::text;
    elsif p_client_ip is not null and length(trim(p_client_ip)) > 0 then
        v_key := 'ip:' || left(trim(p_client_ip), 100);
    else
        v_key := 'anon:unknown';
    end if;

    select e.enabled, e.limit_per_min, e.burst into v_enabled, v_limit, v_burst
      from public.sie_rl_effective_limits(p_user_id) e;

    if v_enabled is not true then
        return query select true, false, v_limit, v_limit, 0, 0, v_key;
        return;
    end if;

    select s.tokens, s.allowed into v_tokens, v_allowed
      from public.sie_rl_spend(v_key, v_limit, v_burst) s;

    v_capacity := v_limit::double precision + greatest(v_burst, 0)::double precision;
    v_refill   := v_limit::double precision / 60.0;

    return query select
        v_allowed,
        true,
        v_limit,
        greatest(floor(v_tokens)::integer, 0),
        greatest(ceil((v_capacity - v_tokens) / v_refill)::integer, 0),
        case when v_allowed then 0
             else greatest(ceil((1 - v_tokens) / v_refill)::integer, 1) end,
        v_key;
end;
$$;

-- What the Review Center shows. Same columns as production; the effective
-- values now include the edition tier, so the console reports the limit
-- that is enforced rather than the global one.
create or replace function public.sie_admin_rate_limit_status(p_user_id uuid default null)
returns table (
    user_id uuid, is_overridden boolean, effective_enabled boolean, effective_limit integer,
    effective_burst integer, override_enabled boolean, override_limit integer, override_burst integer,
    notes text, window_requests integer, window_rejected integer, total_requests bigint,
    total_rejected bigint, last_request_at timestamptz, tokens_remaining integer
)
language plpgsql
security definer
set search_path = public
as $$
begin
    if not (is_sie_admin() or is_chat_engine_staff()) then
        raise exception 'access denied';
    end if;

    return query
    select
        a.user_id,
        (o.user_id is not null and (o.is_enabled is not null or o.requests_per_minute is not null or o.burst is not null)),
        e.enabled,
        e.limit_per_min,
        e.burst,
        o.is_enabled,
        o.requests_per_minute,
        o.burst,
        o.notes,
        coalesce(case when now() - b.window_started_at >= interval '1 minute' then 0 else b.window_requests end, 0),
        coalesce(case when now() - b.window_started_at >= interval '1 minute' then 0 else b.window_rejected end, 0),
        coalesce(b.total_requests, 0::bigint),
        coalesce(b.total_rejected, 0::bigint),
        b.last_request_at,
        coalesce(
            least(
                e.limit_per_min + e.burst,
                floor(b.tokens + extract(epoch from (now() - b.updated_at)) * (e.limit_per_min / 60.0))
            )::integer,
            e.limit_per_min + e.burst
        )
      from public.customer_sie_access a
      cross join lateral public.sie_rl_effective_limits(a.user_id) e
      left join public.sie_rate_limit_overrides o on o.user_id = a.user_id
      left join public.sie_rate_limit_buckets  b on b.bucket_key = 'user:' || a.user_id::text
     where p_user_id is null or a.user_id = p_user_id;
end;
$$;

-- ============================================================
-- 5. sie_admin_set_access — accepts the edition
-- ============================================================
-- p_edition defaults to NULL = "leave the edition as it is" for existing
-- rows, so every current caller (named arguments, no p_edition) keeps
-- working and cannot reset an edition by accident. To clear an edition
-- back to the default, pass 'default'.
drop function if exists public.sie_admin_set_access(uuid, boolean, text, integer, timestamptz, text);

create function public.sie_admin_set_access(
    p_user_id       uuid,
    p_is_enabled    boolean,
    p_access_mode   text,
    p_message_quota integer,
    p_expires_at    timestamptz,
    p_notes         text,
    p_edition       text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
    if not is_sie_admin() then
        raise exception 'access denied: sie admin privileges required';
    end if;

    if p_access_mode not in ('unlimited', 'quota', 'expiration') then
        raise exception 'invalid access_mode: %, must be unlimited/quota/expiration', p_access_mode;
    end if;

    if p_access_mode = 'quota' and (p_message_quota is null or p_message_quota < 1) then
        raise exception 'message_quota must be a positive integer when access_mode is quota';
    end if;

    if p_access_mode = 'expiration' and p_expires_at is null then
        raise exception 'expires_at is required when access_mode is expiration';
    end if;

    if p_edition is not null and p_edition not in ('free', 'pro', 'max', 'default') then
        raise exception 'invalid edition: %, must be free/pro/max/default', p_edition;
    end if;

    if not exists (select 1 from public.profiles where id = p_user_id) then
        raise exception 'no profile found for user %', p_user_id;
    end if;

    insert into public.customer_sie_access (
        user_id, is_enabled, access_mode, message_quota, expires_at, notes, edition, created_by, updated_by
    )
    values (
        p_user_id,
        p_is_enabled,
        p_access_mode,
        case when p_access_mode = 'quota' then p_message_quota else null end,
        case when p_access_mode = 'expiration' then p_expires_at else null end,
        p_notes,
        case when p_edition in ('free', 'pro', 'max') then p_edition else null end,
        auth.uid(),
        auth.uid()
    )
    on conflict (user_id) do update
    set is_enabled = excluded.is_enabled,
        access_mode = excluded.access_mode,
        message_quota = excluded.message_quota,
        expires_at = excluded.expires_at,
        notes = excluded.notes,
        edition = case
            when p_edition is null then customer_sie_access.edition
            when p_edition = 'default' then null
            else p_edition end,
        updated_by = auth.uid(),
        updated_at = now();
end;
$$;

revoke all on function public.sie_admin_set_access(uuid, boolean, text, integer, timestamptz, text, text) from public, anon;
grant execute on function public.sie_admin_set_access(uuid, boolean, text, integer, timestamptz, text, text) to authenticated, service_role;

-- ============================================================
-- 6. Settings rows
-- ============================================================
-- Only the default edition is seeded, at today's behaviour. The per-edition
-- knobs are not seeded: an absent row IS the default (the engine's
-- mergeStoredSettings and the functions above both fall back), and a
-- seeded row would look like a decision somebody made.
insert into public.sie_settings (key, value) values
    ('default_edition', '"free"'::jsonb)
on conflict (key) do nothing;
