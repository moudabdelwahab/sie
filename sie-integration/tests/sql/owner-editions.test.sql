-- owner-editions.test.sql
-- 0010: SIE editions are managed by the platform owner alone.
-- Applied by scripts/test-migrations.sh after supabase-stubs.sql, 0008, the
-- production functions, 0009, production-authority-2026-09-24.sql (the REAL
-- owner / SIE-admin / audit functions) and 0010. Every block raises on a
-- wrong answer; psql runs with ON_ERROR_STOP, so the exit code is the verdict.
\set ON_ERROR_STOP on

create or replace function pg_temp.eq(actual anyelement, expected anyelement, what text) returns void
language plpgsql as $$ begin
    if actual is distinct from expected then
        raise exception 'FAIL %: expected %, got %', what, expected, actual;
    end if;
    raise notice 'ok  %', what;
end $$;

-- ── personas ──────────────────────────────────────────────────────────────
--   …01 owner            platform_authority 'owner' + role platform_owner
--   …02 platform admin   platform_authority 'elevated_admin' + role admin
--   …03 admin            role admin, GRANTED SIE admin (sie_admin_grants)
--   …04 staff            role support, no grant
--   …05 customer         role user, has an access row
--   …06 customer         role user, has an access row
--   …07 customer         role user, NO access row
insert into auth.users values
    ('10000000-0000-0000-0000-000000000001'), ('10000000-0000-0000-0000-000000000002'),
    ('10000000-0000-0000-0000-000000000003'), ('10000000-0000-0000-0000-000000000004'),
    ('10000000-0000-0000-0000-000000000005'), ('10000000-0000-0000-0000-000000000006'),
    ('10000000-0000-0000-0000-000000000007');
insert into public.profiles (id, role) values
    ('10000000-0000-0000-0000-000000000001', 'platform_owner'),
    ('10000000-0000-0000-0000-000000000002', 'admin'),
    ('10000000-0000-0000-0000-000000000003', 'admin'),
    ('10000000-0000-0000-0000-000000000004', 'support'),
    ('10000000-0000-0000-0000-000000000005', 'user'),
    ('10000000-0000-0000-0000-000000000006', 'user'),
    ('10000000-0000-0000-0000-000000000007', 'user');
insert into public.platform_authority (user_id, level) values
    ('10000000-0000-0000-0000-000000000001', 'owner'),
    ('10000000-0000-0000-0000-000000000002', 'elevated_admin');
insert into public.sie_admin_grants (user_id, note) values ('10000000-0000-0000-0000-000000000003', 'test grant');
insert into public.companies (user_id) values ('10000000-0000-0000-0000-000000000001');
insert into public.customer_sie_access (user_id, is_enabled, access_mode) values
    ('10000000-0000-0000-0000-000000000005', true, 'unlimited'),
    ('10000000-0000-0000-0000-000000000006', true, 'unlimited');

-- Run a statement as a persona, under RLS and the role's grants.
create or replace function pg_temp.as_user(p_uid text) returns void language plpgsql as $$ begin
    perform set_config('test.uid', coalesce(p_uid, ''), false);
    perform set_config('test.role', case when p_uid is null then 'anon' else 'authenticated' end, false);
end $$;

-- ════════════════════════════════════════════════════════════════════════
-- 1. The owner check itself (the production function, not a flag)
-- ════════════════════════════════════════════════════════════════════════
select pg_temp.as_user('10000000-0000-0000-0000-000000000001');
select pg_temp.eq(sie_owner_authority(), true, 'owner: sie_owner_authority() is true');
select pg_temp.as_user('10000000-0000-0000-0000-000000000002');
select pg_temp.eq(sie_owner_authority(), false, 'platform admin: not the owner');
select pg_temp.eq(is_sie_admin(), false, 'platform admin without a grant: not an SIE admin');
select pg_temp.as_user('10000000-0000-0000-0000-000000000003');
select pg_temp.eq(is_sie_admin(), true, 'granted admin IS an SIE admin (so the tests below are meaningful)');
select pg_temp.eq(sie_owner_authority(), false, 'granted admin: not the owner');
select pg_temp.as_user('10000000-0000-0000-0000-000000000004');
select pg_temp.eq(is_chat_engine_staff(), true, 'staff IS engine staff (so the settings tests are meaningful)');

-- ════════════════════════════════════════════════════════════════════════
-- 2. Assigning a customer's edition through the owner RPC
-- ════════════════════════════════════════════════════════════════════════
set role authenticated;
select pg_temp.as_user('10000000-0000-0000-0000-000000000001');
select pg_temp.eq(sie_owner_set_customer_edition('10000000-0000-0000-0000-000000000005', 'pro') ->> 'ok', 'true', 'owner assigns Pro');
select pg_temp.eq(sie_owner_set_customer_edition('10000000-0000-0000-0000-000000000006', 'max') ->> 'effective', 'max', 'owner assigns Max');
select pg_temp.eq(sie_owner_set_customer_edition('10000000-0000-0000-0000-000000000006', 'max') ->> 'changed', 'false', 'assigning the same edition again changes nothing');
select pg_temp.eq(sie_owner_set_customer_edition('10000000-0000-0000-0000-000000000005', 'gold') ->> 'error', 'invalid_edition', 'owner: an unknown edition is refused');
select pg_temp.eq(sie_owner_set_customer_edition('10000000-0000-0000-0000-000000000007', 'pro') ->> 'error', 'no_access', 'owner: a customer without SIE access cannot be given an edition');

-- every non-owner persona is refused by the same RPC
select pg_temp.as_user('10000000-0000-0000-0000-000000000002');
select pg_temp.eq(sie_owner_set_customer_edition('10000000-0000-0000-0000-000000000005', 'max') ->> 'error', 'forbidden', 'platform admin: forbidden');
select pg_temp.as_user('10000000-0000-0000-0000-000000000003');
select pg_temp.eq(sie_owner_set_customer_edition('10000000-0000-0000-0000-000000000005', 'max') ->> 'error', 'forbidden', 'SIE admin: forbidden');
select pg_temp.as_user('10000000-0000-0000-0000-000000000004');
select pg_temp.eq(sie_owner_set_customer_edition('10000000-0000-0000-0000-000000000005', 'max') ->> 'error', 'forbidden', 'staff: forbidden');
select pg_temp.as_user('10000000-0000-0000-0000-000000000005');
select pg_temp.eq(sie_owner_set_customer_edition('10000000-0000-0000-0000-000000000005', 'max') ->> 'error', 'forbidden', 'customer raising their own edition: forbidden');
reset role;
select pg_temp.eq((select edition from customer_sie_access where user_id = '10000000-0000-0000-0000-000000000005'), 'pro', '...and the customer is still on Pro');

-- unauthenticated: the function is not even executable
set role anon;
select pg_temp.as_user(null);
do $$ begin
    begin
        perform sie_owner_set_customer_edition('10000000-0000-0000-0000-000000000005', 'max');
        raise exception 'FAIL: anon called the owner RPC';
    exception when insufficient_privilege then raise notice 'ok  unauthenticated: cannot execute the owner RPC';
    end;
end $$;
reset role;

-- ════════════════════════════════════════════════════════════════════════
-- 3. Bypassing the RPC: direct writes and the admin RPC
-- ════════════════════════════════════════════════════════════════════════
set role authenticated;
select pg_temp.as_user('10000000-0000-0000-0000-000000000003');   -- SIE admin: RLS lets them write the table
do $$ begin
    begin
        update customer_sie_access set edition = 'max' where user_id = '10000000-0000-0000-0000-000000000005';
        raise exception 'FAIL: an SIE admin changed an edition with a direct UPDATE';
    exception when insufficient_privilege then raise notice 'ok  SIE admin: a direct UPDATE of edition is refused';
    end;
end $$;
do $$ begin
    begin
        insert into customer_sie_access (user_id, is_enabled, edition) values ('10000000-0000-0000-0000-000000000007', true, 'max');
        raise exception 'FAIL: an SIE admin inserted a row with an edition';
    exception when insufficient_privilege then raise notice 'ok  SIE admin: inserting a row WITH an edition is refused';
    end;
end $$;
do $$ begin
    begin
        perform sie_admin_set_access('10000000-0000-0000-0000-000000000005', true, 'unlimited', null, null, 'x', 'max');
        raise exception 'FAIL: an SIE admin set an edition through sie_admin_set_access';
    exception when insufficient_privilege then raise notice 'ok  SIE admin: sie_admin_set_access(p_edition) is refused';
    end;
end $$;
-- ...but access management itself is untouched
select sie_admin_set_access('10000000-0000-0000-0000-000000000005', true, 'quota', 500, null, 'quota by admin');
reset role;
select pg_temp.eq((select row(message_quota, edition)::text from customer_sie_access where user_id = '10000000-0000-0000-0000-000000000005'),
    row(500, 'pro')::text, 'SIE admin still manages access (quota changed), edition untouched');

set role authenticated;
select pg_temp.as_user('10000000-0000-0000-0000-000000000001');   -- the owner may use the table directly too
update customer_sie_access set edition = 'max' where user_id = '10000000-0000-0000-0000-000000000005';
update customer_sie_access set edition = 'pro' where user_id = '10000000-0000-0000-0000-000000000005';
reset role;
select pg_temp.eq((select edition from customer_sie_access where user_id = '10000000-0000-0000-0000-000000000005'), 'pro', 'owner: a direct UPDATE of edition is allowed');

-- a member preview is not the owner (041/052)
insert into public.owner_context_state (user_id, context, expires_at)
values ('10000000-0000-0000-0000-000000000001', 'company_user_preview', now() + interval '1 hour');
set role authenticated;
select pg_temp.as_user('10000000-0000-0000-0000-000000000001');
select pg_temp.eq(sie_owner_set_customer_edition('10000000-0000-0000-0000-000000000005', 'max') ->> 'error', 'forbidden', 'owner inside a member preview: forbidden');
reset role;
delete from public.owner_context_state;

-- no session (a migration / the SQL editor) and the service role pass, as in 052
select pg_temp.as_user(null); select set_config('test.role', '', false);
update customer_sie_access set edition = 'max' where user_id = '10000000-0000-0000-0000-000000000006';
select set_config('test.role', 'service_role', false);
update customer_sie_access set edition = 'max' where user_id = '10000000-0000-0000-0000-000000000006';
select pg_temp.eq((select edition from customer_sie_access where user_id = '10000000-0000-0000-0000-000000000006'), 'max', 'no session / service role: allowed (trusted server paths)');
-- an anon JWT with no user is NOT a trusted path
select set_config('test.role', 'anon', false);
do $$ begin
    begin
        update customer_sie_access set edition = 'free' where user_id = '10000000-0000-0000-0000-000000000006';
        raise exception 'FAIL: an anon request changed an edition';
    exception when insufficient_privilege then raise notice 'ok  anon JWT without a user: refused even as table owner';
    end;
end $$;
select set_config('test.role', '', false);

-- ════════════════════════════════════════════════════════════════════════
-- 4. Edition settings
-- ════════════════════════════════════════════════════════════════════════
insert into sie_settings (key, value) values ('rate_limit_enabled', 'true') on conflict (key) do nothing;
set role authenticated;
select pg_temp.as_user('10000000-0000-0000-0000-000000000004');   -- staff: RLS lets them write sie_settings
do $$ begin
    begin
        update sie_settings set value = '"max"' where key = 'default_edition';
        raise exception 'FAIL: staff changed default_edition directly';
    exception when insufficient_privilege then raise notice 'ok  staff: a direct write of default_edition is refused';
    end;
end $$;
do $$ begin
    begin
        insert into sie_settings (key, value) values ('edition_pro_monthly_messages', '5');
        raise exception 'FAIL: staff wrote an edition limit directly';
    exception when insufficient_privilege then raise notice 'ok  staff: a direct write of an edition limit is refused';
    end;
end $$;
do $$ begin
    begin
        update sie_settings set key = 'edition_max_enabled', value = 'false' where key = 'rate_limit_enabled';
        raise exception 'FAIL: staff renamed a row into an edition key';
    exception when insufficient_privilege then raise notice 'ok  staff: renaming a row INTO an edition key is refused';
    end;
end $$;
update sie_settings set value = 'false' where key = 'rate_limit_enabled';
select pg_temp.eq(sie_owner_set_edition_setting('edition_max_enabled', 'false') ->> 'error', 'forbidden', 'staff: the setting RPC is forbidden');
select pg_temp.as_user('10000000-0000-0000-0000-000000000002');
select pg_temp.eq(sie_owner_set_edition_setting('default_edition', '"max"') ->> 'error', 'forbidden', 'platform admin: the setting RPC is forbidden');
select pg_temp.as_user('10000000-0000-0000-0000-000000000005');
select pg_temp.eq(sie_owner_set_edition_setting('default_edition', '"max"') ->> 'error', 'forbidden', 'customer: the setting RPC is forbidden');
reset role;
select pg_temp.eq((select value from sie_settings where key = 'rate_limit_enabled'), 'false'::jsonb, 'staff still manages non-edition settings');
select pg_temp.eq((select value #>> '{}' from sie_settings where key = 'default_edition'), 'free', 'default_edition untouched by every non-owner');

set role authenticated;
select pg_temp.as_user('10000000-0000-0000-0000-000000000001');
select pg_temp.eq(sie_owner_set_edition_setting('edition_pro_monthly_messages', '3000') ->> 'ok', 'true', 'owner sets a monthly limit');
select pg_temp.eq(sie_owner_set_edition_setting('edition_pro_rate_limit_per_minute', '120') ->> 'ok', 'true', 'owner sets a rate limit');
select pg_temp.eq(sie_owner_set_edition_setting('edition_free_enabled', 'false') ->> 'error', 'free_always_enabled', 'Free cannot be switched off');
select pg_temp.eq(sie_owner_set_edition_setting('edition_pro_monthly_messages', '-1') ->> 'error', 'invalid_value', 'a negative limit is refused');
select pg_temp.eq(sie_owner_set_edition_setting('edition_pro_monthly_messages', '1.5') ->> 'error', 'invalid_value', 'a fractional limit is refused');
select pg_temp.eq(sie_owner_set_edition_setting('edition_pro_turbo_mode', 'true') ->> 'error', 'unknown_setting', 'an invented edition setting is refused');
select pg_temp.eq(sie_owner_set_edition_setting('rate_limit_enabled', 'true') ->> 'error', 'unknown_setting', 'the RPC writes edition settings only');
select pg_temp.eq(sie_owner_set_edition_setting('default_edition', '"gold"') ->> 'error', 'invalid_value', 'default_edition must be a real edition');
select pg_temp.eq(sie_owner_set_edition_setting('default_edition', '"pro"') ->> 'ok', 'true', 'owner sets the default edition');
select pg_temp.eq(sie_owner_set_edition_setting('edition_pro_enabled', 'false') ->> 'error', 'edition_is_default', 'the default edition cannot be switched off');
select pg_temp.eq(sie_owner_set_edition_setting('default_edition', '"free"') ->> 'ok', 'true', 'owner resets the default edition');
reset role;

-- ════════════════════════════════════════════════════════════════════════
-- 5. Resolution: Free / Pro / Max, unknown and unavailable → Free
-- ════════════════════════════════════════════════════════════════════════
select pg_temp.eq(sie_effective_edition('free'), 'free', 'free resolves to free');
select pg_temp.eq(sie_effective_edition('pro'), 'pro', 'pro resolves to pro');
select pg_temp.eq(sie_effective_edition('max'), 'max', 'max resolves to max');
select pg_temp.eq(sie_effective_edition('gold'), 'free', 'an unknown edition resolves to free');
select pg_temp.eq(sie_effective_edition(null), 'free', 'no edition and default free: free');

set role authenticated;
select pg_temp.as_user('10000000-0000-0000-0000-000000000001');
select pg_temp.eq(sie_owner_set_edition_setting('edition_max_enabled', 'false') ->> 'ok', 'true', 'owner switches Max off');
reset role;
select pg_temp.eq(sie_effective_edition('max'), 'free', 'a customer on a switched-off Max runs as FREE (not Pro)');
select pg_temp.as_user(null);
set test.role = 'service_role';   -- the channel webhook path: service role, no user
select pg_temp.eq((select edition from sie_consume_message('10000000-0000-0000-0000-000000000006')), 'free', 'sie_consume_message reports Free for a switched-off Max');
update sie_settings set value = '"max"' where key = 'default_edition';   -- as the system: a default that is off
select pg_temp.eq(sie_effective_edition(null), 'free', 'a switched-off default_edition resolves to free');
update sie_settings set value = '"free"' where key = 'default_edition';
update sie_settings set value = '"yes"' where key = 'edition_max_enabled';
select pg_temp.eq(sie_effective_edition('max'), 'free', 'a malformed availability value is NOT available (fail closed)');
update sie_settings set value = 'true' where key = 'edition_max_enabled';
select pg_temp.eq(sie_effective_edition('max'), 'max', 'Max switched back on');
select pg_temp.eq((select edition from sie_consume_message('10000000-0000-0000-0000-000000000006')), 'max', 'sie_consume_message reports Max again');
select pg_temp.eq((select edition from sie_consume_message('10000000-0000-0000-0000-000000000005')), 'pro', 'sie_consume_message reports Pro');
reset test.role;

-- ════════════════════════════════════════════════════════════════════════
-- 6. The overview
-- ════════════════════════════════════════════════════════════════════════
set role authenticated;
select pg_temp.as_user('10000000-0000-0000-0000-000000000001');
select pg_temp.eq((select string_agg(format('%s:%s/%s/%s/%s', edition, enabled, assigned_customers, effective_customers, active_customers), ' ' order by edition)
                     from sie_owner_edition_overview()),
    'free:t/0/0/0 max:t/1/1/1 pro:t/1/1/1', 'owner: overview counts assigned, effective and active customers');
select pg_temp.eq((select messages_this_month from sie_owner_edition_overview() where edition = 'max'), 2::bigint, 'owner: messages this month per edition');
select pg_temp.as_user('10000000-0000-0000-0000-000000000003');
do $$ begin
    begin
        perform * from sie_owner_edition_overview();
        raise exception 'FAIL: an SIE admin read the owner overview';
    exception when insufficient_privilege then raise notice 'ok  SIE admin: the overview is refused';
    end;
end $$;
reset role;

-- ════════════════════════════════════════════════════════════════════════
-- 7. The audit: who, whom, before, after, when, result — including refusals
-- ════════════════════════════════════════════════════════════════════════
select pg_temp.eq((select row(actor_tier, old_value ->> 'edition', new_value ->> 'edition', new_value ->> 'result', source)::text
                     from privileged_audit
                    where action = 'sie.edition.assign' and target_user_id = '10000000-0000-0000-0000-000000000006'
                    order by id limit 1),
    row('owner', null::text, 'max', 'success', 'session')::text, 'audit: owner assignment recorded with old/new edition and result');
select pg_temp.eq((select count(*)::int from privileged_audit where action = 'sie.edition.assign' and actor_id = '10000000-0000-0000-0000-000000000001' and at is not null),
    2, 'audit: each successful assignment recorded once, with actor and time');
select pg_temp.eq((select string_agg(actor_tier, ',' order by id) from privileged_audit where action = 'sie.edition.assign.denied'),
    'platform_admin,admin,support,customer,owner', 'audit: every refused assignment recorded, with who tried (incl. owner in preview)');
select pg_temp.eq((select count(*)::int from privileged_audit where action = 'sie.edition.assign.failed'),
    2, 'audit: rejected input recorded (unknown edition, no access row)');
select pg_temp.eq((select count(*)::int from privileged_audit where action = 'sie.edition.setting.denied'), 3, 'audit: refused setting changes recorded');
select pg_temp.eq((select new_value from privileged_audit where action = 'sie.setting.insert' and actor_tier = 'owner' order by id limit 1),
    '{"edition_pro_monthly_messages": 3000}'::jsonb, 'audit: a setting change is recorded by the existing sie_settings trigger');
select pg_temp.eq((select changed_by from customer_sie_access_audit
                    where user_id = '10000000-0000-0000-0000-000000000006' and new_values ->> 'edition' = 'max' order by id limit 1),
    '10000000-0000-0000-0000-000000000001'::uuid, 'audit: the row history records the owner as the changer');
do $$ begin
    begin
        update privileged_audit set action = 'x';
        raise exception 'FAIL: the audit was edited';
    exception when insufficient_privilege then raise notice 'ok  the audit cannot be edited';
    end;
end $$;

\echo ALL OWNER EDITION CHECKS PASSED
