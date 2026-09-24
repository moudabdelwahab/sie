-- self-service.test.sql
-- 0011: SIE Free for everyone, self-service downgrade (never upgrade), and
-- one server-side source for the customer's plan, usage and limits.
-- Applied by scripts/test-migrations.sh after the same production shape as
-- owner-editions.test.sql, plus 0011 (twice). Every block raises on a wrong
-- answer; psql runs with ON_ERROR_STOP, so the exit code is the verdict.
\set ON_ERROR_STOP on

create or replace function pg_temp.eq(actual anyelement, expected anyelement, what text) returns void
language plpgsql as $$ begin
    if actual is distinct from expected then
        raise exception 'FAIL %: expected %, got %', what, expected, actual;
    end if;
    raise notice 'ok  %', what;
end $$;

create or replace function pg_temp.as_user(p_uid text) returns void language plpgsql as $$ begin
    perform set_config('test.uid', coalesce(p_uid, ''), false);
    perform set_config('test.role', case when p_uid is null then 'anon' else 'authenticated' end, false);
end $$;

-- No session at all: a migration or the SQL editor (setup statements).
create or replace function pg_temp.as_system() returns void language plpgsql as $$ begin
    perform set_config('test.uid', '', false);
    perform set_config('test.role', '', false);
end $$;

-- ── personas ──────────────────────────────────────────────────────────────
--   …01 owner          …03 SIE admin (granted)
--   …05 customer A     …06 customer B     …07 customer C (a disabled row, set by an admin BEFORE 0011)
--   …08 customer D     (signs up AFTER 0011)
insert into auth.users values
    ('10000000-0000-0000-0000-000000000001'), ('10000000-0000-0000-0000-000000000003'),
    ('10000000-0000-0000-0000-000000000005'), ('10000000-0000-0000-0000-000000000006'),
    ('10000000-0000-0000-0000-000000000007'), ('10000000-0000-0000-0000-000000000008');

-- ════════════════════════════════════════════════════════════════════════
-- 1. Free for everyone — the backfill, the trigger, and admin decisions kept
-- ════════════════════════════════════════════════════════════════════════
-- Recreate "before 0011": profiles that exist with no trigger, one of them
-- with an admin's decision (disabled, on a quota), then re-apply 0011.
alter table public.profiles disable trigger trg_sie_provision_free_access;
insert into public.profiles (id, role) values
    ('10000000-0000-0000-0000-000000000001', 'platform_owner'),
    ('10000000-0000-0000-0000-000000000003', 'admin'),
    ('10000000-0000-0000-0000-000000000005', 'user'),
    ('10000000-0000-0000-0000-000000000006', 'user'),
    ('10000000-0000-0000-0000-000000000007', 'user');
insert into public.customer_sie_access (user_id, is_enabled, access_mode, message_quota, notes) values
    ('10000000-0000-0000-0000-000000000007', false, 'quota', 40, 'disabled by an admin');
alter table public.profiles enable trigger trg_sie_provision_free_access;
insert into public.platform_authority (user_id, level) values ('10000000-0000-0000-0000-000000000001', 'owner');
insert into public.sie_admin_grants (user_id, note) values ('10000000-0000-0000-0000-000000000003', 'test grant');
insert into public.companies (user_id) values ('10000000-0000-0000-0000-000000000001');

\ir ../../migrations/0011_sie_self_service.sql

select pg_temp.eq((select count(*)::int from public.profiles p
                    where not exists (select 1 from customer_sie_access a where a.user_id = p.id)), 0,
    'backfill: every existing profile has an access row');
select pg_temp.eq((select row(is_enabled, access_mode, edition)::text from customer_sie_access where user_id = '10000000-0000-0000-0000-000000000005'),
    row(true, 'unlimited', null::text)::text, 'backfill: a new row is enabled, unlimited, edition = the default');
select pg_temp.eq(sie_effective_edition(null), 'free', 'the default edition is Free');
select pg_temp.eq((select row(is_enabled, access_mode, message_quota)::text from customer_sie_access where user_id = '10000000-0000-0000-0000-000000000007'),
    row(false, 'quota', 40)::text, 'backfill: an admin''s existing decision (disabled, quota 40) is untouched');

insert into public.profiles (id, role) values ('10000000-0000-0000-0000-000000000008', 'user');
select pg_temp.eq((select row(is_enabled, access_mode)::text from customer_sie_access where user_id = '10000000-0000-0000-0000-000000000008'),
    row(true, 'unlimited')::text, 'trigger: a new signup gets SIE Free at once');

-- A provisioning failure never fails the signup.
create or replace function pg_temp.break_access() returns trigger language plpgsql as $$ begin raise exception 'boom'; end $$;
create trigger zz_break before insert on public.customer_sie_access for each row execute function pg_temp.break_access();
insert into auth.users values ('10000000-0000-0000-0000-000000000009');
insert into public.profiles (id, role) values ('10000000-0000-0000-0000-000000000009', 'user');
select pg_temp.eq((select count(*)::int from public.profiles where id = '10000000-0000-0000-0000-000000000009'), 1,
    'trigger: a signup still succeeds when SIE provisioning fails');
drop trigger zz_break on public.customer_sie_access;

-- ════════════════════════════════════════════════════════════════════════
-- 2. Plan transitions — only Max→Pro, Max→Free, Pro→Free
-- ════════════════════════════════════════════════════════════════════════
set role authenticated;
select pg_temp.as_user('10000000-0000-0000-0000-000000000001');
select pg_temp.eq(sie_owner_set_customer_edition('10000000-0000-0000-0000-000000000005', 'max') ->> 'ok', 'true', 'owner puts A on Max');
select pg_temp.eq(sie_owner_set_customer_edition('10000000-0000-0000-0000-000000000006', 'pro') ->> 'ok', 'true', 'owner puts B on Pro');

select pg_temp.as_user('10000000-0000-0000-0000-000000000005');   -- A, on Max
select pg_temp.eq(sie_customer_downgrade('max') ->> 'error', 'invalid_target', 'MAX -> MAX: rejected (Max is never a customer target)');
select pg_temp.eq(sie_customer_downgrade('enterprise') ->> 'error', 'invalid_target', 'unknown plan: rejected');
select pg_temp.eq(sie_customer_downgrade(null) ->> 'error', 'invalid_target', 'no plan: rejected');
select pg_temp.eq(sie_customer_downgrade('pro') ->> 'ok', 'true', 'MAX -> PRO: allowed');
select pg_temp.eq(sie_customer_downgrade('pro') ->> 'error', 'not_a_downgrade', 'PRO -> PRO: rejected');
select pg_temp.eq(sie_customer_downgrade('free') ->> 'ok', 'true', 'PRO -> FREE: allowed');
select pg_temp.eq(sie_customer_downgrade('pro') ->> 'error', 'not_a_downgrade', 'FREE -> PRO (an upgrade): rejected');
select pg_temp.eq(sie_customer_downgrade('free') ->> 'error', 'not_a_downgrade', 'FREE -> FREE: nothing below Free');

select pg_temp.as_user('10000000-0000-0000-0000-000000000001');
select pg_temp.eq(sie_owner_set_customer_edition('10000000-0000-0000-0000-000000000005', 'max') ->> 'ok', 'true', 'owner puts A back on Max');
select pg_temp.as_user('10000000-0000-0000-0000-000000000005');
select pg_temp.eq(sie_customer_downgrade('free') ->> 'ok', 'true', 'MAX -> FREE: allowed');

select pg_temp.as_user('10000000-0000-0000-0000-000000000006');   -- B, on Pro
select pg_temp.eq(sie_customer_downgrade('max') ->> 'error', 'invalid_target', 'PRO -> MAX: not a customer transition');

-- Bypassing the RPC.
do $$ begin
    update customer_sie_access set edition = 'max' where user_id = '10000000-0000-0000-0000-000000000006';
end $$;
reset role;
select pg_temp.eq((select edition from customer_sie_access where user_id = '10000000-0000-0000-0000-000000000006'), 'pro',
    'customer: a direct UPDATE to Max changes nothing (RLS)');

set role authenticated;
select pg_temp.as_user('10000000-0000-0000-0000-000000000003');   -- SIE admin: RLS lets them write the table
do $$ begin
    begin
        update customer_sie_access set edition = 'free' where user_id = '10000000-0000-0000-0000-000000000006';
        raise exception 'FAIL: an SIE admin lowered a customer''s plan with a direct UPDATE';
    exception when insufficient_privilege then raise notice 'ok  SIE admin: lowering SOMEONE ELSE''s plan directly is refused';
    end;
    begin
        update customer_sie_access set edition = 'max' where user_id = '10000000-0000-0000-0000-000000000003';
        raise exception 'FAIL: an SIE admin raised their own plan';
    exception when insufficient_privilege then raise notice 'ok  SIE admin: raising their OWN plan is refused';
    end;
    begin
        update customer_sie_access set edition = 'pro' where user_id = '10000000-0000-0000-0000-000000000003';
        raise exception 'FAIL: an SIE admin raised their own plan from Free to Pro';
    exception when insufficient_privilege then raise notice 'ok  SIE admin: raising their OWN plan Free -> Pro is refused (the guard, not just the RPC)';
    end;
end $$;
reset role;

set role anon;
select pg_temp.as_user(null);
do $$ begin
    begin
        perform sie_customer_downgrade('free');
        raise exception 'FAIL: anon called the downgrade RPC';
    exception when insufficient_privilege then raise notice 'ok  unauthenticated: cannot execute the downgrade RPC';
    end;
    begin
        perform sie_my_entitlement();
        raise exception 'FAIL: anon read an entitlement';
    exception when insufficient_privilege then raise notice 'ok  unauthenticated: cannot read an entitlement';
    end;
end $$;
reset role;

-- The owner inside a member preview is not a customer changing their plan.
insert into public.owner_context_state (user_id, context, expires_at)
values ('10000000-0000-0000-0000-000000000001', 'company_user_preview', now() + interval '1 hour');
set role authenticated;
select pg_temp.as_user('10000000-0000-0000-0000-000000000001');
select pg_temp.eq(sie_customer_downgrade('free') ->> 'error', 'forbidden', 'owner inside a member preview: cannot change a plan');
select pg_temp.eq(sie_my_entitlement() -> 'downgrade_to', '[]'::jsonb, 'owner inside a member preview: no downgrades offered');
reset role;
delete from public.owner_context_state;
select pg_temp.as_system();

-- A switched-off Pro is not a downgrade target.
insert into public.sie_settings (key, value) values ('edition_pro_enabled', 'false');
set role authenticated;
select pg_temp.as_user('10000000-0000-0000-0000-000000000001');
select pg_temp.eq(sie_owner_set_customer_edition('10000000-0000-0000-0000-000000000005', 'max') ->> 'ok', 'true', 'owner puts A on Max again');
select pg_temp.as_user('10000000-0000-0000-0000-000000000005');
select pg_temp.eq(sie_my_entitlement() -> 'downgrade_to', '["free"]'::jsonb, 'Pro switched off: Max may only step down to Free');
select pg_temp.eq(sie_customer_downgrade('pro') ->> 'error', 'edition_unavailable', 'MAX -> a switched-off PRO: rejected');
reset role;
select pg_temp.as_system();
delete from public.sie_settings where key = 'edition_pro_enabled';
set role authenticated;
select pg_temp.as_user('10000000-0000-0000-0000-000000000005');
select pg_temp.eq(sie_my_entitlement() -> 'downgrade_to', '["pro", "free"]'::jsonb, 'Max: Pro and Free are offered, in that order');
select pg_temp.as_user('10000000-0000-0000-0000-000000000006');
select pg_temp.eq(sie_my_entitlement() -> 'downgrade_to', '["free"]'::jsonb, 'Pro: only Free is offered');
select pg_temp.as_user('10000000-0000-0000-0000-000000000008');
select pg_temp.eq(sie_my_entitlement() -> 'downgrade_to', '[]'::jsonb, 'Free: nothing is offered');
reset role;
select pg_temp.as_system();

-- ════════════════════════════════════════════════════════════════════════
-- 3. Quota follows the NEW plan — no reset, no leftover Max allowance
-- ════════════════════════════════════════════════════════════════════════
insert into public.sie_settings (key, value) values
    ('edition_max_monthly_messages', '100'), ('edition_pro_monthly_messages', '10'), ('edition_free_monthly_messages', '5');

set role authenticated;
select pg_temp.as_user('10000000-0000-0000-0000-000000000005');   -- A on Max
select count(*) from (select sie_consume_message('10000000-0000-0000-0000-000000000005') from generate_series(1, 12)) s;
select pg_temp.eq((sie_my_entitlement() -> 'primary' ->> 'limit')::int, 100, 'A on Max: the monthly limit is Max''s (100)');
select pg_temp.eq((sie_my_entitlement() -> 'primary' ->> 'used')::int, 12, 'A on Max: 12 used');
select pg_temp.eq(sie_customer_downgrade('pro') ->> 'ok', 'true', 'A: MAX -> PRO with 12 used');
select pg_temp.eq((sie_my_entitlement() -> 'primary' ->> 'limit')::int, 10, 'after MAX -> PRO: Pro''s limit (10), not Max''s');
select pg_temp.eq((sie_my_entitlement() -> 'primary' ->> 'used')::int, 12, 'after MAX -> PRO: usage is NOT reset');
select pg_temp.eq((sie_my_entitlement() -> 'primary' ->> 'remaining')::int, 0, 'after MAX -> PRO: nothing left');
select pg_temp.eq(sie_my_entitlement() ->> 'reason', 'edition_monthly_limit', 'after MAX -> PRO: entitlement says the monthly limit is reached');
select pg_temp.eq((select reason from sie_consume_message('10000000-0000-0000-0000-000000000005')), 'edition_monthly_limit',
    'after MAX -> PRO: the next message is refused by Pro''s limit');

select pg_temp.as_user('10000000-0000-0000-0000-000000000006');   -- B on Pro
select count(*) from (select sie_consume_message('10000000-0000-0000-0000-000000000006') from generate_series(1, 3)) s;
select pg_temp.eq(sie_customer_downgrade('free') ->> 'ok', 'true', 'B: PRO -> FREE with 3 used');
select pg_temp.eq((sie_my_entitlement() -> 'primary')::jsonb - 'resets_at',
    '{"kind": "monthly", "used": 3, "limit": 5, "remaining": 2}'::jsonb, 'after PRO -> FREE: Free''s limit (5), 3 used, 2 left');
select pg_temp.eq((select allowed from sie_consume_message('10000000-0000-0000-0000-000000000006')), true, 'after PRO -> FREE: message 4 allowed');
select pg_temp.eq((select allowed from sie_consume_message('10000000-0000-0000-0000-000000000006')), true, 'after PRO -> FREE: message 5 allowed');
select pg_temp.eq((select reason from sie_consume_message('10000000-0000-0000-0000-000000000006')), 'edition_monthly_limit',
    'after PRO -> FREE: message 6 refused by Free''s limit');
reset role;
select pg_temp.eq((select messages_used from customer_sie_access where user_id = '10000000-0000-0000-0000-000000000006'), 5,
    'usage history kept: the lifetime counter counts every allowed message across the change');

set role authenticated;
select pg_temp.as_user('10000000-0000-0000-0000-000000000008');   -- D on Free, nothing used
select pg_temp.eq(sie_my_entitlement() ->> 'has_access', 'true', 'Free: SIE is usable');
select pg_temp.eq((select allowed from sie_consume_message('10000000-0000-0000-0000-000000000008')), true, 'Free: SIE answers (a message is allowed)');
select pg_temp.eq(sie_my_entitlement() ->> 'edition', 'free', 'Free: the effective plan is Free');
reset role;

-- ════════════════════════════════════════════════════════════════════════
-- 4. The entitlement mirrors sie_consume_message()
-- ════════════════════════════════════════════════════════════════════════
select pg_temp.as_system();
delete from public.sie_settings where key like 'edition_%_monthly_messages';
set role authenticated;
select pg_temp.as_user('10000000-0000-0000-0000-000000000007');   -- C: disabled by an admin
select pg_temp.eq(sie_my_entitlement() ->> 'has_access', 'false', 'disabled customer: no access');
select pg_temp.eq(sie_my_entitlement() ->> 'reason', 'disabled', 'disabled customer: the reason is "disabled"');
select pg_temp.eq(sie_my_entitlement() -> 'primary' ->> 'kind', 'lifetime', 'quota customer: the binding limit is the lifetime quota');
select pg_temp.eq((sie_my_entitlement() -> 'primary' ->> 'limit')::int, 40, 'quota customer: limit 40');
select pg_temp.as_user('10000000-0000-0000-0000-000000000008');
select pg_temp.eq(sie_my_entitlement() -> 'primary' ->> 'kind', 'unlimited', 'no limit configured: unlimited');
select pg_temp.eq((sie_my_entitlement() -> 'primary' ->> 'used')::int, 1, 'unlimited: still reports this month''s usage');
select pg_temp.eq((sie_my_entitlement() -> 'primary' ->> 'resets_at') is not null, true, 'unlimited: the month counter''s reset time is reported');
reset role;

-- ════════════════════════════════════════════════════════════════════════
-- 5. Audit
-- ════════════════════════════════════════════════════════════════════════
select pg_temp.eq((select count(*)::int from privileged_audit where action = 'sie.edition.self_downgrade'), 5,
    'audit: every successful downgrade recorded');
select pg_temp.eq((select count(*) > 0 from privileged_audit where action = 'sie.edition.self_downgrade.failed'
                   and new_value ->> 'result' = 'not_a_downgrade'), true, 'audit: rejected transitions recorded');
select pg_temp.eq((select count(*) > 0 from privileged_audit where action = 'sie.edition.self_downgrade.denied'), true,
    'audit: refused callers recorded');
select pg_temp.eq((select (old_value ->> 'effective') || '->' || (new_value ->> 'effective') from privileged_audit
                    where action = 'sie.edition.self_downgrade' and target_user_id = '10000000-0000-0000-0000-000000000006'
                    order by id desc limit 1), 'pro->free', 'audit: the change is recorded from and to');

do $$ begin raise notice 'ALL SELF-SERVICE CHECKS PASSED'; end $$;
