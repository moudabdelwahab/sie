-- 0010_sie_editions_owner_only.sql
-- ============================================================
-- إدارة إصدارات SIE لمالك المنصة وحده — مفروضة في قاعدة البيانات.
--
-- NOT APPLIED TO PRODUCTION BY THE CHANGE THAT ADDS IT. Requires 0009 (the
-- edition column and sie_effective_edition) and Mad3oom's 052/053 (the
-- owner's SIE authority and the privileged audit), which production has.
--
-- ------------------------------------------------------------
-- WHAT WAS TRUE BEFORE (0009 + production, read 2026-09-24)
--
--   a customer's edition   customer_sie_access.edition, writable by
--                          is_sie_admin() — the OWNER, and also any
--                          admin/support granted SIE admin (052)
--                          [RLS sie_access_write + sie_admin_set_access]
--   edition settings       sie_settings rows default_edition / edition_*,
--                          writable by is_chat_engine_staff() — every
--                          admin/support account, and the owner
--
-- so editions were an ADMIN power. They are now the owner's alone.
--
-- ------------------------------------------------------------
-- DESIGN — one owner check, no parallel system
--
--   who is the owner   public.sie_owner_authority() (052): is_platform_owner()
--                      (platform_authority 'owner' row AND role
--                      platform_owner) outside a member preview. No e-mail is
--                      read here or anywhere in this file.
--
--   enforcement        two BEFORE triggers — on customer_sie_access (the
--                      edition column only) and on sie_settings (edition keys
--                      only). Triggers, not RLS, because RLS cannot see WHICH
--                      column or key changes, and because every write path
--                      (a direct PATCH through PostgREST, sie_admin_set_access,
--                      any future RPC) meets them. The rest of both tables
--                      keeps its current rules: SIE admins still manage
--                      access, quotas and notes; engine staff still manage
--                      every non-edition setting.
--
--   who may pass       a client session (anon/authenticated JWT or any
--                      auth.uid()) only as the owner. No session at all
--                      (a migration, the SQL editor) or the service role
--                      passes — the same line 052's grant guard draws.
--
--   mutations          two owner RPCs, the path the console uses. Each
--                      records EVERY attempt — success, rejected input and
--                      refused caller — in privileged_audit through
--                      log_privileged() (053), the log the Owner Dashboard
--                      already shows. They return {ok, error} instead of
--                      raising, so a refusal is recorded, not rolled back.
--                      customer_sie_access_audit keeps recording the row
--                      change itself, as it always has.
--
--   availability       edition_pro_enabled / edition_max_enabled. Free cannot
--                      be switched off. A customer on a switched-off edition
--                      runs as FREE (never "the next one down", never up),
--                      and so does a default_edition that is switched off.
--                      Absent key = available (today's behaviour); anything
--                      but JSON true/absent = NOT available (fail closed).
--
--   overview           sie_owner_edition_overview(): per edition, how many
--                      customers are assigned, run on it, are enabled, and
--                      their messages this month. Owner only.
-- ============================================================

do $$
begin
    if to_regprocedure('public.sie_effective_edition(text)') is null then
        raise exception '0010 requires 0009 (sie_effective_edition)';
    end if;
    if to_regprocedure('public.sie_owner_authority()') is null
       or to_regprocedure('public.log_privileged(text, uuid, jsonb, jsonb)') is null then
        raise exception '0010 requires Mad3oom migrations 052 and 053 (sie_owner_authority, log_privileged)';
    end if;
end $$;

-- ============================================================
-- 1. Who may change an edition
-- ============================================================
-- A request from a client session carries a JWT role (anon/authenticated)
-- or a user id. Without either it is the database itself or the service
-- role — trusted by construction, like every guard in 052/053.
create or replace function public.sie_edition_write_allowed()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
    select case
        when auth.uid() is not null or coalesce(auth.role(), '') in ('anon', 'authenticated')
            then public.sie_owner_authority()
        else true
    end;
$$;

revoke all on function public.sie_edition_write_allowed() from public, anon, authenticated;

-- The edition keys of sie_settings. One definition, used by the guard and
-- by the setting RPC.
create or replace function public.sie_is_edition_setting_key(p_key text)
returns boolean
language sql
immutable
as $$
    select coalesce(p_key = 'default_edition' or p_key ~ '^edition_(free|pro|max)_[a-z_]+$', false);
$$;

revoke all on function public.sie_is_edition_setting_key(text) from public, anon, authenticated;

-- ============================================================
-- 2. Availability, and the effective edition
-- ============================================================
create or replace function public.sie_edition_available(p_edition text)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
    v_raw jsonb;
begin
    if p_edition = 'free' then
        return true;
    end if;
    if p_edition is null or p_edition not in ('pro', 'max') then
        return false;
    end if;
    select value into v_raw from public.sie_settings where key = 'edition_' || p_edition || '_enabled';
    return v_raw is null or v_raw = 'true'::jsonb;
end;
$$;

revoke all on function public.sie_edition_available(text) from public, anon, authenticated;

-- Replaces 0009's: the row's edition, then default_edition, then free — and
-- an edition that is switched off is FREE at either step. Every consumer
-- (sie_consume_message, the rate limits, the monthly cap) calls this, so
-- one change reaches all of them.
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
        return case when public.sie_edition_available(p_row_edition) then p_row_edition else 'free' end;
    end if;
    select value #>> '{}' into v_default from public.sie_settings where key = 'default_edition';
    if v_default in ('free', 'pro', 'max') and public.sie_edition_available(v_default) then
        return v_default;
    end if;
    return 'free';
end;
$$;

revoke all on function public.sie_effective_edition(text) from public, anon, authenticated;

-- ============================================================
-- 3. The guards
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
    if not public.sie_edition_write_allowed() then
        raise exception 'تغيير إصدار SIE لعميل لمالك المنصة وحده' using errcode = '42501';
    end if;
    return new;
end;
$$;

revoke all on function public.guard_sie_edition_column() from public, anon, authenticated;

drop trigger if exists trg_guard_sie_edition_column on public.customer_sie_access;
create trigger trg_guard_sie_edition_column
    before insert or update on public.customer_sie_access
    for each row execute function public.guard_sie_edition_column();

create or replace function public.guard_sie_edition_settings()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
    if (tg_op <> 'INSERT' and public.sie_is_edition_setting_key(old.key))
       or (tg_op <> 'DELETE' and public.sie_is_edition_setting_key(new.key)) then
        if not public.sie_edition_write_allowed() then
            raise exception 'إعدادات إصدارات SIE لمالك المنصة وحده' using errcode = '42501';
        end if;
    end if;
    return coalesce(new, old);
end;
$$;

revoke all on function public.guard_sie_edition_settings() from public, anon, authenticated;

drop trigger if exists trg_guard_sie_edition_settings on public.sie_settings;
create trigger trg_guard_sie_edition_settings
    before insert or update or delete on public.sie_settings
    for each row execute function public.guard_sie_edition_settings();

-- ============================================================
-- 4. Owner RPC — assign a customer's edition
-- ============================================================
-- p_edition: 'free' | 'pro' | 'max' | 'default' (clear: default_edition applies).
-- The customer must already have an access row: whether a customer may use
-- SIE at all is the access decision SIE admins make; the owner decides the
-- edition of those who may.
create or replace function public.sie_owner_set_customer_edition(p_user_id uuid, p_edition text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    v_old   text;
    v_new   text;
    v_found boolean;
    v_ask   jsonb := jsonb_build_object('requested', p_edition);
begin
    if not public.sie_owner_authority() then
        perform public.log_privileged('sie.edition.assign.denied', p_user_id, null, v_ask || '{"result":"denied"}');
        return jsonb_build_object('ok', false, 'error', 'forbidden');
    end if;

    if p_user_id is null or p_edition is null or p_edition not in ('free', 'pro', 'max', 'default') then
        perform public.log_privileged('sie.edition.assign.failed', p_user_id, null, v_ask || '{"result":"invalid_edition"}');
        return jsonb_build_object('ok', false, 'error', 'invalid_edition');
    end if;

    select a.edition, true into v_old, v_found
      from public.customer_sie_access a where a.user_id = p_user_id for update;
    if not coalesce(v_found, false) then
        perform public.log_privileged('sie.edition.assign.failed', p_user_id, null, v_ask || '{"result":"no_access"}');
        return jsonb_build_object('ok', false, 'error', 'no_access');
    end if;

    v_new := case when p_edition = 'default' then null else p_edition end;
    if v_new is not distinct from v_old then
        return jsonb_build_object('ok', true, 'changed', false, 'edition', v_new,
                                  'effective', public.sie_effective_edition(v_new));
    end if;

    update public.customer_sie_access
       set edition = v_new, updated_by = auth.uid(), updated_at = now()
     where user_id = p_user_id;

    perform public.log_privileged('sie.edition.assign', p_user_id,
        jsonb_build_object('edition', v_old, 'effective', public.sie_effective_edition(v_old)),
        jsonb_build_object('edition', v_new, 'effective', public.sie_effective_edition(v_new), 'result', 'success'));

    return jsonb_build_object('ok', true, 'changed', true, 'previous', v_old, 'edition', v_new,
                              'effective', public.sie_effective_edition(v_new));
end;
$$;

revoke all on function public.sie_owner_set_customer_edition(uuid, text) from public, anon;
grant execute on function public.sie_owner_set_customer_edition(uuid, text) to authenticated;

-- ============================================================
-- 5. Owner RPC — change one edition setting
-- ============================================================
-- Checks the SHAPE of the value (which keys exist, integer vs boolean vs
-- edition id). The console validates the exact ranges from the one schema
-- (sie/config/settings-schema.js), and every consumer clamps what it reads
-- into the hard limits (editions.resolveEditionProfile, 0009's rate
-- functions) — repeating those numbers here would be a second copy to
-- drift. On success the existing trg_audit_sie_settings (053) records the
-- change with its old and new value; this function records the refusals.
create or replace function public.sie_owner_set_edition_setting(p_key text, p_value jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    v_knob    text;
    v_edition text;
    v_error   text;
    v_ask     jsonb := jsonb_build_object('key', p_key, 'value', p_value);
begin
    if not public.sie_owner_authority() then
        perform public.log_privileged('sie.edition.setting.denied', null, null, v_ask || '{"result":"denied"}');
        return jsonb_build_object('ok', false, 'error', 'forbidden');
    end if;

    if p_key = 'default_edition' then
        if jsonb_typeof(p_value) <> 'string' or (p_value #>> '{}') not in ('free', 'pro', 'max') then
            v_error := 'invalid_value';
        elsif not public.sie_edition_available(p_value #>> '{}') then
            v_error := 'edition_disabled';
        end if;
    elsif p_key ~ '^edition_(free|pro|max)_[a-z_]+$' then
        v_edition := substring(p_key from '^edition_(free|pro|max)_');
        v_knob := substring(p_key from '^edition_(?:free|pro|max)_([a-z_]+)$');
        if v_knob = 'enabled' then
            if v_edition = 'free' then
                v_error := 'free_always_enabled';
            elsif jsonb_typeof(p_value) <> 'boolean' then
                v_error := 'invalid_value';
            elsif p_value = 'false'::jsonb
                  and (select value #>> '{}' from public.sie_settings where key = 'default_edition') = v_edition then
                v_error := 'edition_is_default';
            end if;
        elsif v_knob in ('max_scenarios', 'max_message_chars', 'retrieval_max_candidates', 'max_evidence_tokens',
                         'rate_limit_per_minute', 'rate_limit_burst', 'monthly_messages') then
            if jsonb_typeof(p_value) <> 'number'
               or (p_value #>> '{}')::numeric <> floor((p_value #>> '{}')::numeric)
               or (p_value #>> '{}')::numeric < 0
               or (p_value #>> '{}')::numeric > 1000000 then
                v_error := 'invalid_value';
            end if;
        else
            v_error := 'unknown_setting';
        end if;
    else
        v_error := 'unknown_setting';
    end if;

    if v_error is not null then
        perform public.log_privileged('sie.edition.setting.failed', null, null, v_ask || jsonb_build_object('result', v_error));
        return jsonb_build_object('ok', false, 'error', v_error);
    end if;

    insert into public.sie_settings (key, value) values (p_key, p_value)
    on conflict (key) do update set value = excluded.value;

    return jsonb_build_object('ok', true, 'key', p_key, 'value', p_value);
end;
$$;

revoke all on function public.sie_owner_set_edition_setting(text, jsonb) from public, anon;
grant execute on function public.sie_owner_set_edition_setting(text, jsonb) to authenticated;

-- ============================================================
-- 6. Owner RPC — the overview the console shows
-- ============================================================
create or replace function public.sie_owner_edition_overview()
returns table (
    edition             text,
    enabled             boolean,
    is_default          boolean,
    assigned_customers  integer,
    effective_customers integer,
    active_customers    integer,
    messages_this_month bigint
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
    v_month date := date_trunc('month', timezone('utc', now()))::date;
begin
    if not public.sie_owner_authority() then
        raise exception 'نظرة الإصدارات لمالك المنصة وحده' using errcode = '42501';
    end if;

    return query
    with ids(id, ord) as (values ('free', 1), ('pro', 2), ('max', 3)),
         rows as (
             select a.edition as own, public.sie_effective_edition(a.edition) as eff, a.is_enabled,
                    case when a.edition_period_start = v_month then a.edition_period_used else 0 end as used
               from public.customer_sie_access a
         )
    select i.id,
           public.sie_edition_available(i.id),
           public.sie_effective_edition(null) = i.id,
           (select count(*)::int from rows r where r.own = i.id),
           (select count(*)::int from rows r where r.eff = i.id),
           (select count(*)::int from rows r where r.eff = i.id and r.is_enabled),
           (select coalesce(sum(r.used), 0)::bigint from rows r where r.eff = i.id)
      from ids i
     order by i.ord;
end;
$$;

revoke all on function public.sie_owner_edition_overview() from public, anon;
grant execute on function public.sie_owner_edition_overview() to authenticated;

-- ============================================================
-- 7. Self-check
-- ============================================================
do $$
begin
    if pg_get_functiondef('public.sie_edition_write_allowed()'::regprocedure) ~* '(email|@mad3oom)' then
        raise exception '0010: the owner check reads an e-mail';
    end if;
    if not exists (select 1 from pg_trigger where tgname = 'trg_guard_sie_edition_column')
       or not exists (select 1 from pg_trigger where tgname = 'trg_guard_sie_edition_settings') then
        raise exception '0010: an edition guard is missing';
    end if;
    raise notice '0010: SIE editions are managed by the platform owner alone';
end $$;
