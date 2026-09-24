-- 0011_sie_self_service.sql
-- ============================================================
-- SIE للجميع على الخطة المجانية، وتنزيل الخطة بيد العميل، ومصدر واحد
-- للاستخدام والحدود — كله مفروض في قاعدة البيانات.
--
-- Requires 0009 (editions, sie_effective_edition), 0010 (owner-only
-- editions, sie_edition_available) and Mad3oom 052/053 (preview_mode,
-- log_privileged), which production has.
--
-- ------------------------------------------------------------
-- WHY
--
--   The chat widget's "traditional" engine is being retired. SIE then has
--   to answer EVERY customer, and the customer has to be able to see their
--   plan and usage and step down from a plan they no longer want. Before
--   this migration:
--     • only customers an admin had enabled had a customer_sie_access row
--       (4 of 33 in production) — everyone else had no SIE at all;
--     • the edition was the owner's alone (0010), in both directions;
--     • the customer could read their raw row, but not the effective
--       edition, the edition's limits, or when a limit resets — the widget
--       would have had to re-derive the rules in JavaScript.
--
-- ------------------------------------------------------------
-- WHAT IT ADDS
--
--   1. Free for everyone. Every profile without an access row gets one
--      (is_enabled, access_mode 'unlimited', edition NULL = default_edition,
--      which is 'free'), and every NEW profile gets one on insert. An admin
--      can still disable a customer or put them on a quota, exactly as
--      before. The trigger swallows its own failure: a signup must never
--      fail because SIE could not be provisioned.
--
--   2. Self-service DOWNGRADE, never upgrade. sie_customer_downgrade(target)
--      allows exactly Max → Pro, Max → Free and Pro → Free, measured against
--      the edition the customer RUNS AS (sie_effective_edition), to an
--      edition that is available. Upgrades and every edition setting stay
--      the owner's (0010). The 0010 guard gains one narrow exception: the
--      row's own customer, lowering their own effective edition. A direct
--      UPDATE still cannot reach it (RLS lets only SIE admins write the
--      table), so in practice only this RPC does. Every attempt is audited.
--
--   3. sie_my_entitlement(): the caller's effective plan, whether SIE is
--      usable and why not, the downgrades the server allows, and every limit
--      that applies with its usage and reset time. The widget renders this
--      and nothing else — it holds no plan rules of its own.
--
-- QUOTA AFTER A PLAN CHANGE (unchanged, and why that is right): the
-- edition is resolved on EVERY message by sie_consume_message() through
-- sie_effective_edition(). After a downgrade the next message is checked
-- against the NEW edition's monthly cap, using the same month counter
-- (edition_period_used) — usage is not reset, and the old plan's larger
-- allowance is not kept. Proven by tests/sql/self-service.test.sql.
-- ============================================================

do $$
begin
    if to_regprocedure('public.sie_effective_edition(text)') is null
       or to_regprocedure('public.sie_edition_available(text)') is null then
        raise exception '0011 requires 0009 and 0010';
    end if;
    if to_regprocedure('public.log_privileged(text, uuid, jsonb, jsonb)') is null
       or to_regprocedure('public.preview_mode()') is null then
        raise exception '0011 requires Mad3oom migrations 052 and 053 (log_privileged, preview_mode)';
    end if;
end $$;

-- ============================================================
-- 1. Edition order (one definition)
-- ============================================================
create or replace function public.sie_edition_rank(p_edition text)
returns integer
language sql
immutable
as $$
    select case p_edition when 'free' then 1 when 'pro' then 2 when 'max' then 3 else 0 end;
$$;

-- ============================================================
-- 2. The 0010 guard, with the self-service downgrade exception
-- ============================================================
create or replace function public.guard_sie_edition_column()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
    if tg_op = 'INSERT' and new.edition is null then
        return new;
    end if;
    if tg_op = 'UPDATE' and new.edition is not distinct from old.edition then
        return new;
    end if;
    if public.sie_edition_write_allowed() then
        return new;
    end if;
    -- The customer lowering their own plan: strictly below what they run as
    -- now, to an explicit edition that is available. Nothing else.
    if tg_op = 'UPDATE'
       and auth.uid() is not null
       and new.user_id = auth.uid() and old.user_id = new.user_id
       and not public.preview_mode()
       and new.edition in ('free', 'pro')
       and public.sie_edition_available(new.edition)
       and public.sie_edition_rank(new.edition) < public.sie_edition_rank(public.sie_effective_edition(old.edition)) then
        return new;
    end if;
    raise exception 'تغيير إصدار SIE لعميل لمالك المنصة وحده' using errcode = '42501';
end;
$$;

revoke all on function public.guard_sie_edition_column() from public, anon, authenticated;

-- ============================================================
-- 3. Customer RPC — step down to a lower plan
-- ============================================================
create or replace function public.sie_customer_downgrade(p_target text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    v_uid     uuid := auth.uid();
    v_row     public.customer_sie_access%rowtype;
    v_current text;
    v_ask     jsonb := jsonb_build_object('requested', p_target);
begin
    if v_uid is null or public.preview_mode() then
        perform public.log_privileged('sie.edition.self_downgrade.denied', v_uid, null, v_ask || '{"result":"forbidden"}');
        return jsonb_build_object('ok', false, 'error', 'forbidden');
    end if;

    if p_target is null or p_target not in ('free', 'pro') then
        perform public.log_privileged('sie.edition.self_downgrade.failed', v_uid, null, v_ask || '{"result":"invalid_target"}');
        return jsonb_build_object('ok', false, 'error', 'invalid_target');
    end if;

    select * into v_row from public.customer_sie_access where user_id = v_uid for update;
    if not found then
        perform public.log_privileged('sie.edition.self_downgrade.failed', v_uid, null, v_ask || '{"result":"no_access"}');
        return jsonb_build_object('ok', false, 'error', 'no_access');
    end if;

    v_current := public.sie_effective_edition(v_row.edition);
    if public.sie_edition_rank(p_target) >= public.sie_edition_rank(v_current) then
        perform public.log_privileged('sie.edition.self_downgrade.failed', v_uid,
            jsonb_build_object('effective', v_current), v_ask || '{"result":"not_a_downgrade"}');
        return jsonb_build_object('ok', false, 'error', 'not_a_downgrade', 'current', v_current);
    end if;
    if not public.sie_edition_available(p_target) then
        perform public.log_privileged('sie.edition.self_downgrade.failed', v_uid,
            jsonb_build_object('effective', v_current), v_ask || '{"result":"edition_unavailable"}');
        return jsonb_build_object('ok', false, 'error', 'edition_unavailable', 'current', v_current);
    end if;

    update public.customer_sie_access
       set edition = p_target, updated_by = v_uid, updated_at = now()
     where user_id = v_uid;

    perform public.log_privileged('sie.edition.self_downgrade', v_uid,
        jsonb_build_object('edition', v_row.edition, 'effective', v_current),
        jsonb_build_object('edition', p_target, 'effective', public.sie_effective_edition(p_target), 'result', 'success'));

    return jsonb_build_object('ok', true, 'previous', v_current, 'edition', p_target,
                              'effective', public.sie_effective_edition(p_target));
end;
$$;

revoke all on function public.sie_customer_downgrade(text) from public, anon;
grant execute on function public.sie_customer_downgrade(text) to authenticated;

-- ============================================================
-- 4. Customer RPC — my plan, my usage, my limits
-- ============================================================
-- Mirrors sie_consume_message()'s branch order exactly, so what the widget
-- shows is what the next message will meet. Read-only: never consumes.
create or replace function public.sie_my_entitlement()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
    v_uid       uuid := auth.uid();
    v_row       public.customer_sie_access%rowtype;
    v_edition   text;
    v_reason    text;
    v_month     date := date_trunc('month', timezone('utc', now()))::date;
    v_reset     timestamptz := (date_trunc('month', timezone('utc', now())) + interval '1 month') at time zone 'utc';
    v_cap       integer;
    v_period    integer;
    v_limits    jsonb := '[]'::jsonb;
    v_primary   jsonb;
    v_down      jsonb := '[]'::jsonb;
    v_e         text;
begin
    if v_uid is null then
        return jsonb_build_object('signed_in', false);
    end if;

    select * into v_row from public.customer_sie_access where user_id = v_uid;
    if not found then
        return jsonb_build_object('signed_in', true, 'has_access', false, 'reason', 'not_enabled',
            'edition', public.sie_effective_edition(null), 'assigned_edition', null,
            'downgrade_to', '[]'::jsonb, 'limits', '[]'::jsonb, 'primary', null);
    end if;

    v_edition := public.sie_effective_edition(v_row.edition);
    v_cap := coalesce(public.sie_edition_setting_int(v_edition, '_monthly_messages'), 0);
    v_period := case when v_row.edition_period_start = v_month then v_row.edition_period_used else 0 end;

    if v_row.access_mode = 'quota' then
        v_limits := v_limits || jsonb_build_array(jsonb_build_object(
            'kind', 'lifetime', 'used', v_row.messages_used, 'limit', v_row.message_quota,
            'remaining', greatest(coalesce(v_row.message_quota, 0) - v_row.messages_used, 0), 'resets_at', null));
    end if;
    if v_cap > 0 then
        v_limits := v_limits || jsonb_build_array(jsonb_build_object(
            'kind', 'monthly', 'used', v_period, 'limit', v_cap,
            'remaining', greatest(v_cap - v_period, 0), 'resets_at', v_reset));
    end if;

    -- The binding limit is the one with the least left.
    select l into v_primary from jsonb_array_elements(v_limits) l
     order by (l ->> 'remaining')::int asc limit 1;
    if v_primary is null then
        v_primary := jsonb_build_object('kind', 'unlimited', 'used', v_period, 'limit', null,
                                        'remaining', null, 'resets_at', v_reset);
    end if;

    -- The same order as sie_consume_message().
    if not v_row.is_enabled then
        v_reason := 'disabled';
    elsif v_row.access_mode = 'expiration' and v_row.expires_at is not null and v_row.expires_at < now() then
        v_reason := 'expired';
    elsif v_row.access_mode = 'quota' and v_row.messages_used >= coalesce(v_row.message_quota, 0) then
        v_reason := 'quota_exceeded';
    elsif v_cap > 0 and v_period >= v_cap then
        v_reason := 'edition_monthly_limit';
    end if;

    if not public.preview_mode() then
        foreach v_e in array array['pro', 'free'] loop
            if public.sie_edition_rank(v_e) < public.sie_edition_rank(v_edition) and public.sie_edition_available(v_e) then
                v_down := v_down || to_jsonb(v_e);
            end if;
        end loop;
    end if;

    return jsonb_build_object(
        'signed_in', true,
        'has_access', v_reason is null,
        'reason', v_reason,
        'edition', v_edition,
        'assigned_edition', v_row.edition,
        'access_mode', v_row.access_mode,
        'expires_at', v_row.expires_at,
        'downgrade_to', v_down,
        'limits', v_limits,
        'primary', v_primary
    );
end;
$$;

revoke all on function public.sie_my_entitlement() from public, anon;
grant execute on function public.sie_my_entitlement() to authenticated;

-- ============================================================
-- 5. Free for everyone
-- ============================================================
create or replace function public.sie_provision_free_access()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
    begin
        insert into public.customer_sie_access (user_id, is_enabled, access_mode, notes)
        values (new.id, true, 'unlimited', 'SIE Free — provisioned automatically')
        on conflict (user_id) do nothing;
    exception when others then
        -- Never fail a signup over SIE: the widget reports "not enabled"
        -- and support can enable the customer by hand.
        raise warning 'sie_provision_free_access(%): %', new.id, sqlerrm;
    end;
    return new;
end;
$$;

revoke all on function public.sie_provision_free_access() from public, anon, authenticated;

drop trigger if exists trg_sie_provision_free_access on public.profiles;
create trigger trg_sie_provision_free_access
    after insert on public.profiles
    for each row execute function public.sie_provision_free_access();

-- Everyone who exists today. Existing rows (an admin's decision, a quota,
-- a disabled customer) are left exactly as they are.
insert into public.customer_sie_access (user_id, is_enabled, access_mode, notes)
select p.id, true, 'unlimited', 'SIE Free — provisioned automatically'
  from public.profiles p
 where not exists (select 1 from public.customer_sie_access a where a.user_id = p.id)
on conflict (user_id) do nothing;

-- ============================================================
-- 6. Self-check
-- ============================================================
do $$
begin
    if exists (select 1 from public.profiles p
                where not exists (select 1 from public.customer_sie_access a where a.user_id = p.id)) then
        raise exception '0011: a profile was left without SIE access';
    end if;
    if not exists (select 1 from pg_trigger where tgname = 'trg_sie_provision_free_access') then
        raise exception '0011: the provisioning trigger is missing';
    end if;
    raise notice '0011: every customer has SIE Free; customers may step down, never up';
end $$;
