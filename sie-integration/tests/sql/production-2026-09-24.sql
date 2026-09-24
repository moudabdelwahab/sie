-- production-2026-09-24.sql
-- Rate-limit functions as DEPLOYED in production on 2026-09-24
-- (pg_get_functiondef, read-only), which no migration in this repository
-- defines: production gained them after 0008 through changes made outside
-- this repository. Applied after 0008 by scripts/test-migrations.sh so 0009
-- is tested against the database it will actually meet. NOT a migration.
CREATE OR REPLACE FUNCTION public.sie_rl_spend(p_key text, p_limit integer, p_burst integer)
 RETURNS TABLE(tokens double precision, allowed boolean)
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
declare
    v_capacity double precision := p_limit::double precision + greatest(p_burst, 0)::double precision;
    v_refill   double precision := p_limit::double precision / 60.0;
begin
    return query
    with hit as (
        insert into public.sie_rate_limit_buckets as b (
            bucket_key, tokens, updated_at, window_started_at,
            window_requests, window_rejected, total_requests, total_rejected,
            last_request_at, last_allowed
        )
        values (p_key, v_capacity - 1, now(), now(), 1, 0, 1, 0, now(), true)
        on conflict (bucket_key) do update set
            tokens = case
                when public.sie_rl_available(b.tokens, b.updated_at, v_capacity, v_refill) >= 1
                then public.sie_rl_available(b.tokens, b.updated_at, v_capacity, v_refill) - 1
                else public.sie_rl_available(b.tokens, b.updated_at, v_capacity, v_refill)
            end,
            last_allowed = public.sie_rl_available(b.tokens, b.updated_at, v_capacity, v_refill) >= 1,
            updated_at = now(),
            last_request_at = now(),
            window_started_at = case
                when now() - b.window_started_at >= interval '1 minute' then now()
                else b.window_started_at end,
            window_requests = case
                when now() - b.window_started_at >= interval '1 minute' then 1
                else b.window_requests + 1 end,
            window_rejected = case
                when now() - b.window_started_at >= interval '1 minute'
                    then case when public.sie_rl_available(b.tokens, b.updated_at, v_capacity, v_refill) >= 1 then 0 else 1 end
                else b.window_rejected
                    + case when public.sie_rl_available(b.tokens, b.updated_at, v_capacity, v_refill) >= 1 then 0 else 1 end
            end,
            total_requests = b.total_requests + 1,
            total_rejected = b.total_rejected
                + case when public.sie_rl_available(b.tokens, b.updated_at, v_capacity, v_refill) >= 1 then 0 else 1 end
        returning b.tokens, b.last_allowed
    )
    select hit.tokens, hit.last_allowed from hit;
end;
$function$;

CREATE OR REPLACE FUNCTION public.sie_rate_limit_hit(p_client_ip text DEFAULT NULL::text)
 RETURNS TABLE(allowed boolean, enabled boolean, limit_per_min integer, remaining integer, reset_seconds integer, retry_after integer, key_used text)
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
declare
    v_uid       uuid := auth.uid();
    v_key       text;
    v_enabled   boolean;
    v_limit     integer;
    v_burst     integer;
    v_o_enabled boolean;
    v_o_limit   integer;
    v_o_burst   integer;
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
    select coalesce((value #>> '{}')::boolean, true) into v_enabled from public.sie_settings where key = 'rate_limit_enabled';
    v_enabled := coalesce(v_enabled, true);
    select coalesce((value #>> '{}')::integer, 100) into v_limit from public.sie_settings where key = 'rate_limit_requests_per_minute';
    v_limit := coalesce(v_limit, 100);
    select coalesce((value #>> '{}')::integer, 20) into v_burst from public.sie_settings where key = 'rate_limit_burst';
    v_burst := coalesce(v_burst, 20);
    if v_uid is not null then
        select o.is_enabled, o.requests_per_minute, o.burst into v_o_enabled, v_o_limit, v_o_burst
          from public.sie_rate_limit_overrides o where o.user_id = v_uid;
        v_enabled := coalesce(v_o_enabled, v_enabled);
        v_limit   := coalesce(v_o_limit, v_limit);
        v_burst   := coalesce(v_o_burst, v_burst);
    end if;
    if v_enabled is not true then
        return query select true, false, v_limit, v_limit, 0, 0, v_key;
        return;
    end if;
    select s.tokens, s.allowed into v_tokens, v_allowed from public.sie_rl_spend(v_key, v_limit, v_burst) s;
    v_capacity := v_limit::double precision + greatest(v_burst, 0)::double precision;
    v_refill   := v_limit::double precision / 60.0;
    return query select v_allowed, true, v_limit, greatest(floor(v_tokens)::integer, 0),
        greatest(ceil((v_capacity - v_tokens) / v_refill)::integer, 0),
        case when v_allowed then 0 else greatest(ceil((1 - v_tokens) / v_refill)::integer, 1) end, v_key;
end;
$function$;
