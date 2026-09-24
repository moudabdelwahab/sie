-- editions-migration.test.sql
-- Applied after supabase-stubs.sql, 0008 and 0009 on a scratch database by
-- scripts/test-migrations.sh. Every block raises on a wrong answer, and
-- psql runs with ON_ERROR_STOP, so the script's exit code is the verdict.
\set ON_ERROR_STOP on

create or replace function pg_temp.eq(actual anyelement, expected anyelement, what text) returns void
language plpgsql as $$ begin
    if actual is distinct from expected then
        raise exception 'FAIL %: expected %, got %', what, expected, actual;
    end if;
    raise notice 'ok  %', what;
end $$;

-- Fixtures: three customers as they exist before 0009 (the migration has
-- already been applied, so these rows get the new columns' defaults — the
-- same thing that happens to existing rows in production).
insert into public.profiles values
    ('00000000-0000-0000-0000-00000000000a'), ('00000000-0000-0000-0000-00000000000b'),
    ('00000000-0000-0000-0000-00000000000c'), ('00000000-0000-0000-0000-00000000000d');
insert into auth.users select id from public.profiles on conflict do nothing;
insert into public.customer_sie_access (user_id, is_enabled, access_mode, message_quota) values
    ('00000000-0000-0000-0000-00000000000a', true, 'unlimited', null),
    ('00000000-0000-0000-0000-00000000000b', true, 'quota', 3),
    ('00000000-0000-0000-0000-00000000000c', false, 'unlimited', null);

set test.role = 'service_role';

-- 0. Before/after: with nothing configured, the pre-0009 answers stand.
select pg_temp.eq((select row(allowed, reason, remaining)::text from sie_consume_message('00000000-0000-0000-0000-0000000000ff')),
    (select answer from test_baseline where what = 'consume'), 'consume answers as before 0009 (plus the edition column)');
set test.uid = '00000000-0000-0000-0000-0000000000ff';
select pg_temp.eq((select row(allowed, enabled, limit_per_min, remaining)::text from sie_rate_limit_hit(null)),
    (select answer from test_baseline where what = 'rate'), 'rate limit answers as before 0009');
reset test.uid;
delete from sie_rate_limit_buckets;
select pg_temp.eq((select row(allowed, enabled, limit_per_min, remaining, reset_seconds, retry_after, key_used)::text
      from sie_api_rate_limit_hit('00000000-0000-0000-0000-0000000000ff', null)),
    (select answer from test_baseline where what = 'api'), 'API limiter answers as the deployed one before 0009');
delete from sie_rate_limit_buckets;
insert into sie_rate_limit_overrides (user_id, requests_per_minute, burst) values ('00000000-0000-0000-0000-0000000000ff', 42, 3);
select pg_temp.eq((select row(allowed, enabled, limit_per_min, remaining, reset_seconds, retry_after, key_used)::text
      from sie_api_rate_limit_hit('00000000-0000-0000-0000-0000000000ff', null)),
    (select answer from test_baseline where what = 'api_override'), 'API limiter with an override answers as before 0009');
update sie_rate_limit_overrides set is_enabled = false where user_id = '00000000-0000-0000-0000-0000000000ff';
select pg_temp.eq((select row(allowed, enabled, limit_per_min, remaining, reset_seconds, retry_after, key_used)::text
      from sie_api_rate_limit_hit('00000000-0000-0000-0000-0000000000ff', null)),
    (select answer from test_baseline where what = 'api_off'), 'API limiter switched off by override answers as before 0009');
select pg_temp.eq((select row(allowed, enabled, limit_per_min, remaining, reset_seconds, retry_after, key_used)::text
      from sie_api_rate_limit_hit(null, '203.0.113.9')),
    (select answer from test_baseline where what = 'api_ip'), 'API limiter by IP answers as before 0009');
delete from sie_rate_limit_overrides where user_id = '00000000-0000-0000-0000-0000000000ff';
delete from sie_rate_limit_buckets;

-- 1. Nothing configured: identical to before, plus edition = free.
select pg_temp.eq((select row(allowed, reason, remaining, edition)::text from sie_consume_message('00000000-0000-0000-0000-00000000000a')),
    row(true, null::text, null::integer, 'free')::text, 'unlimited customer, no config: allowed, no remaining, free');
select pg_temp.eq((select remaining from sie_consume_message('00000000-0000-0000-0000-00000000000b')), 2, 'quota customer: remaining counts the lifetime quota as before');
select pg_temp.eq((select reason from sie_consume_message('00000000-0000-0000-0000-00000000000c')), 'disabled', 'disabled stays disabled');
select pg_temp.eq((select reason from sie_consume_message('00000000-0000-0000-0000-00000000000d')), 'not_enabled', 'no row stays not_enabled');
select pg_temp.eq((select default_edition from (select value #>> '{}' as default_edition from sie_settings where key = 'default_edition') s), 'free', 'default_edition seeded as free');

-- 2. Edition resolution: row > default_edition > free.
update sie_settings set value = '"pro"' where key = 'default_edition';
select pg_temp.eq((select edition from sie_consume_message('00000000-0000-0000-0000-00000000000a')), 'pro', 'default_edition applies to a row without one');
update customer_sie_access set edition = 'max' where user_id = '00000000-0000-0000-0000-00000000000a';
select pg_temp.eq((select edition from sie_consume_message('00000000-0000-0000-0000-00000000000a')), 'max', 'the row''s own edition wins');
update sie_settings set value = '"gold"' where key = 'default_edition';
select pg_temp.eq(sie_effective_edition(null), 'free', 'an invalid default_edition falls to free, never up');
do $$ begin
    begin
        update customer_sie_access set edition = 'gold' where user_id = '00000000-0000-0000-0000-00000000000a';
        raise exception 'FAIL: edition gold was accepted';
    exception when check_violation then raise notice 'ok  the column refuses an unknown edition';
    end;
end $$;
update sie_settings set value = '"free"' where key = 'default_edition';
update customer_sie_access set edition = null where user_id = '00000000-0000-0000-0000-00000000000a';

-- 3. Monthly cap.
insert into sie_settings values ('edition_free_monthly_messages', '2');
update customer_sie_access set edition_period_start = null, edition_period_used = 0, messages_used = 0
 where user_id = '00000000-0000-0000-0000-00000000000a';
select pg_temp.eq((select remaining from sie_consume_message('00000000-0000-0000-0000-00000000000a')), 1, 'cap 2: first message leaves 1');
select pg_temp.eq((select remaining from sie_consume_message('00000000-0000-0000-0000-00000000000a')), 0, 'cap 2: second leaves 0');
select pg_temp.eq((select reason from sie_consume_message('00000000-0000-0000-0000-00000000000a')), 'edition_monthly_limit', 'cap 2: third refused');
select pg_temp.eq((select messages_used from customer_sie_access where user_id = '00000000-0000-0000-0000-00000000000a'), 2, 'a refused message is not counted');
update customer_sie_access set edition_period_start = (date_trunc('month', timezone('utc', now())) - interval '1 month')::date
 where user_id = '00000000-0000-0000-0000-00000000000a';
select pg_temp.eq((select allowed from sie_consume_message('00000000-0000-0000-0000-00000000000a')), true, 'a new month starts a new count');
select pg_temp.eq((select edition_period_used from customer_sie_access where user_id = '00000000-0000-0000-0000-00000000000a'), 1, 'and the counter restarts at 1');
-- The lifetime quota and the monthly cap: the smaller remaining is reported.
update customer_sie_access set messages_used = 0, edition_period_used = 0 where user_id = '00000000-0000-0000-0000-00000000000b';
select pg_temp.eq((select remaining from sie_consume_message('00000000-0000-0000-0000-00000000000b')), 1, 'quota 3 + cap 2: remaining is the tighter one');
-- Disabled beats the cap: the same branch order as before.
update customer_sie_access set edition_period_used = 99, edition_period_start = date_trunc('month', timezone('utc', now()))::date
 where user_id = '00000000-0000-0000-0000-00000000000c';
select pg_temp.eq((select reason from sie_consume_message('00000000-0000-0000-0000-00000000000c')), 'disabled', 'disabled is reported before the cap');
-- A malformed setting is ignored, not fatal.
update sie_settings set value = '"lots"' where key = 'edition_free_monthly_messages';
select pg_temp.eq((select allowed from sie_consume_message('00000000-0000-0000-0000-00000000000a')), true, 'a non-number cap is ignored');
update sie_settings set value = '0' where key = 'edition_free_monthly_messages';
select pg_temp.eq((select allowed from sie_consume_message('00000000-0000-0000-0000-00000000000a')), true, 'cap 0 = no cap');

-- 4. Identity: unchanged rules, and anon no longer holds the grant at all.
set test.role = 'authenticated';
set test.uid = '00000000-0000-0000-0000-00000000000b';
select pg_temp.eq((select reason from sie_consume_message('00000000-0000-0000-0000-00000000000a')), 'unauthorized', 'a customer cannot spend another customer''s messages');
reset test.uid;
select pg_temp.eq(has_function_privilege('anon', 'public.sie_consume_message(uuid)', 'execute'), false, 'anon cannot execute sie_consume_message');
select pg_temp.eq(has_function_privilege('authenticated', 'public.sie_consume_message(uuid)', 'execute'), true, 'authenticated can');
select pg_temp.eq(has_function_privilege('anon', 'public.sie_admin_set_access(uuid, boolean, text, integer, timestamptz, text, text)', 'execute'), false, 'anon cannot execute sie_admin_set_access');

-- 5. Rate limit: override > edition > global.
set test.uid = '00000000-0000-0000-0000-00000000000a';
select pg_temp.eq((select limit_per_min from sie_rate_limit_hit(null)), 100, 'no edition rate: the global 100');
insert into sie_settings values ('edition_free_rate_limit_per_minute', '300'), ('edition_free_rate_limit_burst', '5');
select pg_temp.eq((select limit_per_min from sie_rate_limit_hit(null)), 300, 'edition rate replaces the global');
update sie_settings set value = '3' where key = 'edition_free_rate_limit_per_minute';
select pg_temp.eq((select limit_per_min from sie_rate_limit_hit(null)), 10, 'an edition rate below 10 is clamped to 10');
update sie_settings set value = '0' where key = 'edition_free_rate_limit_per_minute';
select pg_temp.eq((select limit_per_min from sie_rate_limit_hit(null)), 100, 'edition rate 0 = inherit the global');
update sie_settings set value = '300' where key = 'edition_free_rate_limit_per_minute';
insert into sie_rate_limit_overrides (user_id, requests_per_minute) values ('00000000-0000-0000-0000-00000000000a', 50);
select pg_temp.eq((select limit_per_min from sie_rate_limit_hit(null)), 50, 'the customer override beats the edition');
update sie_settings set value = 'false' where key = 'rate_limit_enabled';
select pg_temp.eq((select enabled from sie_rate_limit_hit(null)), false, 'the global switch still switches it off');
update sie_settings set value = 'true' where key = 'rate_limit_enabled';
delete from sie_rate_limit_overrides;
delete from sie_rate_limit_buckets;
-- Burst: 300/min + 5 burst = 305 tokens; the first hit leaves 304.
select pg_temp.eq((select remaining from sie_rate_limit_hit(null)), 304, 'the edition burst sizes the bucket');
reset test.uid;

-- 5b. The service-role twin and the console read the same helper.
update sie_settings set value = '300' where key = 'edition_free_rate_limit_per_minute';
set test.role = 'service_role';
select pg_temp.eq((select limit_per_min from sie_api_rate_limit_hit('00000000-0000-0000-0000-00000000000a', null)), 300, 'sie_api_rate_limit_hit sees the edition rate');
set test.admin = 'true';
select pg_temp.eq((select effective_limit from sie_admin_rate_limit_status('00000000-0000-0000-0000-00000000000a')), 300, 'the console reports the enforced (edition) limit');
select pg_temp.eq((select effective_limit from sie_admin_rate_limit_status('00000000-0000-0000-0000-00000000000b')), 300, 'every free customer shows it');
update customer_sie_access set edition = 'pro' where user_id = '00000000-0000-0000-0000-00000000000b';
select pg_temp.eq((select effective_limit from sie_admin_rate_limit_status('00000000-0000-0000-0000-00000000000b')), 100, 'a pro customer is not given the free edition''s rate');
update customer_sie_access set edition = null where user_id = '00000000-0000-0000-0000-00000000000b';
set test.admin = 'false';
select pg_temp.eq(has_function_privilege('authenticated', 'public.sie_rl_effective_limits(uuid)', 'execute'), false, 'nobody can read another customer''s limits through the helper');
select pg_temp.eq(has_function_privilege('authenticated', 'public.sie_edition_setting_int(text, text)', 'execute'), false, 'the settings helper is internal');

-- 6. sie_admin_set_access and the edition.
set test.admin = 'true';
update customer_sie_access set edition = 'pro' where user_id = '00000000-0000-0000-0000-00000000000a';
select sie_admin_set_access(p_user_id => '00000000-0000-0000-0000-00000000000a', p_is_enabled => true,
    p_access_mode => 'unlimited', p_message_quota => null, p_expires_at => null, p_notes => 'x');
select pg_temp.eq((select edition from customer_sie_access where user_id = '00000000-0000-0000-0000-00000000000a'), 'pro', 'an old caller without p_edition keeps the edition');
select sie_admin_set_access('00000000-0000-0000-0000-00000000000a', true, 'unlimited', null, null, 'x', 'max');
select pg_temp.eq((select edition from customer_sie_access where user_id = '00000000-0000-0000-0000-00000000000a'), 'max', 'p_edition sets it');
select sie_admin_set_access('00000000-0000-0000-0000-00000000000a', true, 'unlimited', null, null, 'x', 'default');
select pg_temp.eq((select edition from customer_sie_access where user_id = '00000000-0000-0000-0000-00000000000a'), null::text, '''default'' clears it');
do $$ begin
    begin
        perform sie_admin_set_access('00000000-0000-0000-0000-00000000000a', true, 'unlimited', null, null, 'x', 'gold');
        raise exception 'FAIL: edition gold accepted by sie_admin_set_access';
    exception when raise_exception then
        if sqlerrm like 'FAIL%' then raise; end if;
        raise notice 'ok  sie_admin_set_access refuses an unknown edition';
    end;
end $$;
set test.admin = 'false';
do $$ begin
    begin
        perform sie_admin_set_access('00000000-0000-0000-0000-00000000000a', true, 'unlimited', null, null, 'x', 'max');
        raise exception 'FAIL: a non-admin set an edition';
    exception when raise_exception then
        if sqlerrm like 'FAIL%' then raise; end if;
        raise notice 'ok  a non-admin cannot set an edition';
    end;
end $$;

-- 9. A customer cannot raise their own edition — run AS the customer, under
--    the production RLS policies (supabase-stubs.sql), not as the superuser
--    the rest of this file uses.
set test.admin = 'false';
set test.role = 'authenticated';
set test.uid = '00000000-0000-0000-0000-00000000000b';
set role authenticated;
update customer_sie_access set edition = 'max', message_quota = 1000000 where user_id = '00000000-0000-0000-0000-00000000000b';
update sie_settings set value = '"max"' where key = 'default_edition';
do $$ begin
    begin
        insert into customer_sie_access (user_id, is_enabled, edition) values ('00000000-0000-0000-0000-00000000000d', true, 'max');
        raise exception 'FAIL: a customer inserted an access row';
    exception when insufficient_privilege then raise notice 'ok  a customer cannot insert an access row (RLS)';
    end;
end $$;
select pg_temp.eq((select count(*)::int from customer_sie_access), 1, 'a customer sees only their own access row');
do $$ begin
    begin
        perform sie_edition_setting_int('pro', 'monthly_messages');
        raise exception 'FAIL: a customer called an internal function';
    exception when insufficient_privilege then raise notice 'ok  the internal edition functions are not callable by a customer';
    end;
end $$;
reset role;
reset test.uid;
select pg_temp.eq((select edition from customer_sie_access where user_id = '00000000-0000-0000-0000-00000000000b'), null::text, 'the customer''s own UPDATE of edition changed nothing');
select pg_temp.eq((select message_quota from customer_sie_access where user_id = '00000000-0000-0000-0000-00000000000b'), 3, '...nor their quota');
select pg_temp.eq((select value #>> '{}' from sie_settings where key = 'default_edition'), 'free', 'a customer cannot change default_edition');
select pg_temp.eq((select count(*)::int from customer_sie_access where user_id = '00000000-0000-0000-0000-00000000000d'), 0, 'no row was inserted');

\echo ALL EDITION MIGRATION CHECKS PASSED
