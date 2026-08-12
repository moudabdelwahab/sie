-- 0008_add_api_rate_limiting.sql
-- ============================================================
-- حد لمعدل الطلبات على sie-api، مصدره قاعدة البيانات مش ذاكرة الدالة.
--
-- ------------------------------------------------------------
-- WHY THE COUNTER LIVES IN POSTGRES
--
-- sie-api is a Supabase Edge Function. Supabase runs as many instances
-- of it as traffic needs and recycles them freely, so a counter held in
-- a module-level Map is not one limit — it is N independent limits that
-- reset at unpredictable times. A customer capped at 100/min would get
-- 100 per instance, and the cap would silently loosen exactly when load
-- (and therefore instance count) went up. That is the opposite of what a
-- rate limit is for, which is why the state is a table.
--
-- ------------------------------------------------------------
-- WHY TOKEN BUCKET AND NOT A FIXED WINDOW
--
-- A fixed per-minute counter has the boundary problem: 100 requests at
-- 11:59:59 and 100 more at 12:00:00 is 200 requests in one second, all
-- within limits. It is also unforgiving in the other direction — a
-- client that legitimately fires ten calls to render one screen looks
-- like abuse.
--
-- A token bucket fixes both from one pair of numbers. The bucket refills
-- at limit/60 tokens per second and holds at most (limit + burst), so
-- the sustained rate is exactly the configured limit while a client that
-- has been quiet may spend up to `burst` immediately. No boundary to
-- game, because there is no boundary.
--
-- Storage is O(1) per key — two numbers and a timestamp — rather than a
-- row per request, so this does not become a write-amplification problem
-- at the volume it exists to survive.
--
-- ------------------------------------------------------------
-- WHY ONE STATEMENT
--
-- Read-then-write across two statements is a lost update under
-- concurrency: two simultaneous requests both read the same token count
-- and both decide they are allowed. The whole check is therefore a
-- single INSERT ... ON CONFLICT DO UPDATE, where the refill arithmetic
-- happens inside the UPDATE against the row's own stored values. One
-- statement means one row lock held by Postgres for its duration, so
-- concurrent callers serialise on the row and each sees the previous
-- one's decrement. The RETURNING clause hands back the post-decrement
-- state, which is what the headers report.
--
-- ------------------------------------------------------------
-- WHERE CONFIGURATION LIVES
--
-- Global defaults are three ordinary rows in `sie_settings`, the table
-- the settings console already writes and the engine already reads
-- through a 60-second cache. That is what makes "changes take effect
-- without a deployment" true here rather than aspirational: an admin
-- flips a switch and the next bucket read sees it.
--
-- Per-customer exceptions live in their own table with NULL meaning
-- "inherit". A row of all-NULLs is therefore indistinguishable from no
-- row, which keeps "this customer is special" a deliberate statement
-- instead of a side effect of having once opened the drawer.

-- ============================================================
-- 1. Per-customer overrides
-- ============================================================
create table if not exists public.sie_rate_limit_overrides (
    user_id             uuid primary key references auth.users(id) on delete cascade,
    -- Every column below is nullable ON PURPOSE: NULL = inherit the global
    -- setting. Only a non-NULL value is an override.
    is_enabled          boolean,
    requests_per_minute integer check (requests_per_minute is null or requests_per_minute between 1 and 100000),
    burst               integer check (burst is null or burst between 0 and 100000),
    notes               text,
    updated_at          timestamptz not null default now(),
    updated_by          uuid references auth.users(id) on delete set null
);

comment on table public.sie_rate_limit_overrides is
    'Per-customer rate-limit exceptions. NULL in any column means inherit the global sie_settings value.';

alter table public.sie_rate_limit_overrides enable row level security;

-- Same shape as customer_sie_access: a customer may read their own row so
-- the UI can explain their limit, and only the SIE admin may write.
drop policy if exists "Customers can read their own rate limit" on public.sie_rate_limit_overrides;
create policy "Customers can read their own rate limit"
    on public.sie_rate_limit_overrides for select
    using (auth.uid() = user_id or is_sie_admin() or is_chat_engine_staff());

drop policy if exists "Only the SIE admin can write rate limits" on public.sie_rate_limit_overrides;
create policy "Only the SIE admin can write rate limits"
    on public.sie_rate_limit_overrides for all
    using (is_sie_admin()) with check (is_sie_admin());

-- ============================================================
-- 2. Bucket state
-- ============================================================
create table if not exists public.sie_rate_limit_buckets (
    bucket_key        text primary key,
    tokens            double precision not null,
    updated_at        timestamptz not null default now(),
    -- Observability only — the limit decision never reads these. They are
    -- what the Review Center shows so an admin can see whether a limit is
    -- actually biting before they change it.
    window_started_at timestamptz not null default now(),
    window_requests   integer not null default 0,
    window_rejected   integer not null default 0,
    total_requests    bigint not null default 0,
    total_rejected    bigint not null default 0,
    last_request_at   timestamptz,
    -- The decision this row's last update made. Needed because the token
    -- count alone cannot express it: an ALLOWED request that leaves 0.4
    -- tokens and a DENIED one that found 0.4 tokens both store 0.4. The
    -- flag is written inside the same statement as the decrement, so
    -- RETURNING it is still one atomic read.
    last_allowed      boolean not null default true
);

comment on table public.sie_rate_limit_buckets is
    'Token-bucket state per caller. Source of truth for rate limiting across all Edge Function instances.';

create index if not exists sie_rate_limit_buckets_last_request_idx
    on public.sie_rate_limit_buckets (last_request_at desc);

alter table public.sie_rate_limit_buckets enable row level security;

-- No policy grants direct access: the bucket is written only by the
-- SECURITY DEFINER function below, and read by staff through the
-- reporting function. RLS with no permissive policy denies everyone,
-- which is the intent — a customer must not be able to edit their own
-- token count.
drop policy if exists "Staff can read rate limit buckets" on public.sie_rate_limit_buckets;
create policy "Staff can read rate limit buckets"
    on public.sie_rate_limit_buckets for select
    using (is_sie_admin() or is_chat_engine_staff());

-- ============================================================
-- 3. Global defaults, as ordinary settings rows
-- ============================================================
insert into public.sie_settings (key, value) values
    ('rate_limit_enabled', 'true'::jsonb),
    ('rate_limit_requests_per_minute', '100'::jsonb),
    ('rate_limit_burst', '20'::jsonb)
on conflict (key) do nothing;

-- ============================================================
-- 4. The check itself
-- ============================================================
--
-- The refill is a helper rather than an inline expression because the
-- UPDATE below needs the same value in four places (the new token count,
-- the allow flag, and two counters). All four SET expressions see the OLD
-- row, so the value genuinely has to be recomputed each time — and four
-- hand-copied arithmetic expressions that must never drift apart is a bug
-- waiting to be introduced by the next person to touch it.
create or replace function public.sie_rl_available(
    p_tokens     double precision,
    p_updated_at timestamptz,
    p_capacity   double precision,
    p_refill_per_sec double precision
)
returns double precision
language sql
stable
set search_path = public
as $$
    select least(
        p_capacity,
        p_tokens + greatest(extract(epoch from (now() - p_updated_at)), 0) * p_refill_per_sec
    );
$$;

comment on function public.sie_rl_available(double precision, timestamptz, double precision, double precision) is
    'Tokens available right now for a bucket, capped at capacity. One definition of the refill curve.';

--
-- Returns the decision AND the numbers the response headers need, so the
-- caller never has to compute a limit a second time and get it slightly
-- different from the one that was enforced.
create or replace function public.sie_rate_limit_hit(p_client_ip text default null)
returns table (
    allowed        boolean,
    enabled        boolean,
    limit_per_min  integer,
    remaining      integer,
    reset_seconds  integer,
    retry_after    integer,
    -- NOT named bucket_key: a RETURNS TABLE column of that name shadows the
    -- real column inside `on conflict (bucket_key)` below, and Postgres
    -- rejects the function body as ambiguous.
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
    -- The key is derived here, never accepted from the caller, so a client
    -- cannot spend someone else's budget or mint itself a fresh one by
    -- claiming a different identity.
    --
    -- Anonymous callers fall back to their IP. That bucket is spoofable by
    -- forging the header, but an anonymous caller can reach nothing except
    -- /health anyway — every other route resolves identity in the database
    -- and fails closed. It is depth, not the primary control.
    if v_uid is not null then
        v_key := 'user:' || v_uid::text;
    elsif p_client_ip is not null and length(trim(p_client_ip)) > 0 then
        v_key := 'ip:' || left(trim(p_client_ip), 100);
    else
        v_key := 'anon:unknown';
    end if;

    -- Global defaults, then the customer's override for whichever columns
    -- they actually set. coalesce() is what makes NULL mean "inherit".
    select
        coalesce((value #>> '{}')::boolean, true)
      into v_enabled
      from public.sie_settings where key = 'rate_limit_enabled';
    v_enabled := coalesce(v_enabled, true);

    select coalesce((value #>> '{}')::integer, 100) into v_limit
      from public.sie_settings where key = 'rate_limit_requests_per_minute';
    v_limit := coalesce(v_limit, 100);

    select coalesce((value #>> '{}')::integer, 20) into v_burst
      from public.sie_settings where key = 'rate_limit_burst';
    v_burst := coalesce(v_burst, 20);

    if v_uid is not null then
        select
            coalesce(o.is_enabled, v_enabled),
            coalesce(o.requests_per_minute, v_limit),
            coalesce(o.burst, v_burst)
          into v_enabled, v_limit, v_burst
          from public.sie_rate_limit_overrides o
         where o.user_id = v_uid;
    end if;

    -- Switched off: report the configuration honestly and spend nothing.
    -- Deliberately does not touch the bucket, so turning the limiter off
    -- and on again does not hand out a surprise full bucket mid-incident.
    if v_enabled is not true then
        return query select true, false, v_limit, v_limit, 0, 0, v_key;
        return;
    end if;

    v_capacity := v_limit::double precision + greatest(v_burst, 0)::double precision;
    v_refill   := v_limit::double precision / 60.0;

    -- One statement. The refill is computed from the row's own updated_at
    -- inside the UPDATE, so two concurrent callers cannot both read the
    -- same pre-decrement token count.
    with hit as (
        insert into public.sie_rate_limit_buckets as b (
            bucket_key, tokens, updated_at, window_started_at,
            window_requests, window_rejected, total_requests, total_rejected,
            last_request_at, last_allowed
        )
        -- A first request always has a full bucket to spend from.
        values (v_key, v_capacity - 1, now(), now(), 1, 0, 1, 0, now(), true)
        on conflict (bucket_key) do update set
            tokens = case
                when sie_rl_available(b.tokens, b.updated_at, v_capacity, v_refill) >= 1
                then sie_rl_available(b.tokens, b.updated_at, v_capacity, v_refill) - 1
                else sie_rl_available(b.tokens, b.updated_at, v_capacity, v_refill)
            end,
            last_allowed = sie_rl_available(b.tokens, b.updated_at, v_capacity, v_refill) >= 1,
            updated_at = now(),
            last_request_at = now(),
            -- A rolling minute for display. Reset by age rather than by
            -- clock minute so the number always means "the last 60s".
            window_started_at = case
                when now() - b.window_started_at >= interval '1 minute' then now()
                else b.window_started_at end,
            window_requests = case
                when now() - b.window_started_at >= interval '1 minute' then 1
                else b.window_requests + 1 end,
            window_rejected = case
                when now() - b.window_started_at >= interval '1 minute'
                    then case when sie_rl_available(b.tokens, b.updated_at, v_capacity, v_refill) >= 1 then 0 else 1 end
                else b.window_rejected
                    + case when sie_rl_available(b.tokens, b.updated_at, v_capacity, v_refill) >= 1 then 0 else 1 end
            end,
            total_requests = b.total_requests + 1,
            total_rejected = b.total_rejected
                + case when sie_rl_available(b.tokens, b.updated_at, v_capacity, v_refill) >= 1 then 0 else 1 end
        returning b.tokens, b.last_allowed
    )
    select hit.tokens, hit.last_allowed into v_tokens, v_allowed from hit;

    return query select
        v_allowed,
        true,
        v_limit,
        greatest(floor(v_tokens)::integer, 0),
        -- Seconds until the bucket is full again — the window this caller
        -- is being measured over.
        greatest(ceil((v_capacity - v_tokens) / v_refill)::integer, 0),
        -- Seconds until one more request would be allowed. Zero when the
        -- request was allowed, so Retry-After is only ever set on a 429.
        case when v_allowed then 0
             else greatest(ceil((1 - v_tokens) / v_refill)::integer, 1) end,
        v_key;
end;
$$;

revoke all on function public.sie_rate_limit_hit(text) from public;
grant execute on function public.sie_rate_limit_hit(text) to anon;
grant execute on function public.sie_rate_limit_hit(text) to authenticated;
grant execute on function public.sie_rate_limit_hit(text) to service_role;

comment on function public.sie_rate_limit_hit(text) is
    'Atomically spends one token from the caller''s bucket and returns the decision '
    'plus the numbers needed for the RateLimit-* headers. Identity is taken from '
    'auth.uid(), never from an argument.';

-- ============================================================
-- 5. Admin surface
-- ============================================================
--
-- Authorization is inside each function via is_sie_admin(), matching
-- sie_admin_set_access() exactly — the API layer does not get to decide
-- who is an admin.

create or replace function public.sie_admin_set_rate_limit(
    p_user_id             uuid,
    p_is_enabled          boolean default null,
    p_requests_per_minute integer default null,
    p_burst               integer default null,
    p_notes               text    default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
    if not is_sie_admin() then
        raise exception 'access denied';
    end if;
    if p_user_id is null then
        raise exception 'user id is required';
    end if;

    insert into public.sie_rate_limit_overrides as o
        (user_id, is_enabled, requests_per_minute, burst, notes, updated_at, updated_by)
    values
        (p_user_id, p_is_enabled, p_requests_per_minute, p_burst, p_notes, now(), auth.uid())
    on conflict (user_id) do update set
        is_enabled          = excluded.is_enabled,
        requests_per_minute = excluded.requests_per_minute,
        burst               = excluded.burst,
        notes               = excluded.notes,
        updated_at          = now(),
        updated_by          = auth.uid();
end;
$$;

revoke all on function public.sie_admin_set_rate_limit(uuid, boolean, integer, integer, text) from public;
revoke all on function public.sie_admin_set_rate_limit(uuid, boolean, integer, integer, text) from anon;
grant execute on function public.sie_admin_set_rate_limit(uuid, boolean, integer, integer, text) to authenticated;
grant execute on function public.sie_admin_set_rate_limit(uuid, boolean, integer, integer, text) to service_role;

-- Clearing the bucket is separate from changing the limit, because they
-- answer different questions: "this customer should be allowed more" vs
-- "this customer is locked out right now and I want them unstuck".
create or replace function public.sie_admin_reset_rate_limit(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
    if not is_sie_admin() then
        raise exception 'access denied';
    end if;
    delete from public.sie_rate_limit_buckets where bucket_key = 'user:' || p_user_id::text;
end;
$$;

revoke all on function public.sie_admin_reset_rate_limit(uuid) from public;
revoke all on function public.sie_admin_reset_rate_limit(uuid) from anon;
grant execute on function public.sie_admin_reset_rate_limit(uuid) to authenticated;
grant execute on function public.sie_admin_reset_rate_limit(uuid) to service_role;

-- One read for the Review Center: the effective limit for a customer
-- (after inheritance) next to what they are actually using. Computed here
-- rather than in JavaScript so the console cannot describe a limit
-- differently from the one being enforced.
create or replace function public.sie_admin_rate_limit_status(p_user_id uuid default null)
returns table (
    user_id             uuid,
    is_overridden       boolean,
    effective_enabled   boolean,
    effective_limit     integer,
    effective_burst     integer,
    override_enabled    boolean,
    override_limit      integer,
    override_burst      integer,
    notes               text,
    window_requests     integer,
    window_rejected     integer,
    total_requests      bigint,
    total_rejected      bigint,
    last_request_at     timestamptz,
    tokens_remaining    integer
)
language plpgsql
security definer
set search_path = public
as $$
declare
    v_enabled boolean;
    v_limit   integer;
    v_burst   integer;
begin
    if not (is_sie_admin() or is_chat_engine_staff()) then
        raise exception 'access denied';
    end if;

    select coalesce((value #>> '{}')::boolean, true) into v_enabled
      from public.sie_settings where key = 'rate_limit_enabled';
    select coalesce((value #>> '{}')::integer, 100) into v_limit
      from public.sie_settings where key = 'rate_limit_requests_per_minute';
    select coalesce((value #>> '{}')::integer, 20) into v_burst
      from public.sie_settings where key = 'rate_limit_burst';

    v_enabled := coalesce(v_enabled, true);
    v_limit   := coalesce(v_limit, 100);
    v_burst   := coalesce(v_burst, 20);

    return query
    select
        a.user_id,
        (o.user_id is not null and (o.is_enabled is not null or o.requests_per_minute is not null or o.burst is not null)),
        coalesce(o.is_enabled, v_enabled),
        coalesce(o.requests_per_minute, v_limit),
        coalesce(o.burst, v_burst),
        o.is_enabled,
        o.requests_per_minute,
        o.burst,
        o.notes,
        coalesce(case when now() - b.window_started_at >= interval '1 minute' then 0 else b.window_requests end, 0),
        coalesce(case when now() - b.window_started_at >= interval '1 minute' then 0 else b.window_rejected end, 0),
        coalesce(b.total_requests, 0::bigint),
        coalesce(b.total_rejected, 0::bigint),
        b.last_request_at,
        -- Refilled to "now" for display, so a stale row does not look like
        -- an exhausted customer.
        coalesce(
            least(
                coalesce(o.requests_per_minute, v_limit) + coalesce(o.burst, v_burst),
                floor(b.tokens + extract(epoch from (now() - b.updated_at)) * (coalesce(o.requests_per_minute, v_limit) / 60.0))
            )::integer,
            coalesce(o.requests_per_minute, v_limit) + coalesce(o.burst, v_burst)
        )
      from public.customer_sie_access a
      left join public.sie_rate_limit_overrides o on o.user_id = a.user_id
      left join public.sie_rate_limit_buckets  b on b.bucket_key = 'user:' || a.user_id::text
     where p_user_id is null or a.user_id = p_user_id;
end;
$$;

revoke all on function public.sie_admin_rate_limit_status(uuid) from public;
revoke all on function public.sie_admin_rate_limit_status(uuid) from anon;
grant execute on function public.sie_admin_rate_limit_status(uuid) to authenticated;
grant execute on function public.sie_admin_rate_limit_status(uuid) to service_role;

comment on function public.sie_admin_rate_limit_status(uuid) is
    'Effective rate limit (after global/override inheritance) next to live usage, '
    'for the Review Center. Staff-readable, admin-writable.';
