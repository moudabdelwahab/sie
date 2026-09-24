-- baseline-before-0009.sql
-- Records what the deployed functions answer BEFORE 0009, so the test after
-- it can prove an unconfigured database answers the same.
\set ON_ERROR_STOP on
insert into public.profiles values ('00000000-0000-0000-0000-0000000000ff');
insert into auth.users values ('00000000-0000-0000-0000-0000000000ff');
insert into public.customer_sie_access (user_id, is_enabled, access_mode, message_quota) values
    ('00000000-0000-0000-0000-0000000000ff', true, 'quota', 5);
create table public.test_baseline (what text primary key, answer text);
set test.role = 'service_role';
insert into public.test_baseline
    select 'consume', row(allowed, reason, remaining)::text from sie_consume_message('00000000-0000-0000-0000-0000000000ff');
set test.uid = '00000000-0000-0000-0000-0000000000ff';
insert into public.test_baseline
    select 'rate', row(allowed, enabled, limit_per_min, remaining)::text from sie_rate_limit_hit(null);
reset test.uid;
delete from public.sie_rate_limit_buckets;
-- The service-role API limiter (deployed; 0009 replaces it): global, then
-- with a per-customer override, then disabled by override.
insert into public.test_baseline
    select 'api', row(allowed, enabled, limit_per_min, remaining, reset_seconds, retry_after, key_used)::text
      from sie_api_rate_limit_hit('00000000-0000-0000-0000-0000000000ff', null);
delete from public.sie_rate_limit_buckets;
insert into public.sie_rate_limit_overrides (user_id, requests_per_minute, burst) values ('00000000-0000-0000-0000-0000000000ff', 42, 3);
insert into public.test_baseline
    select 'api_override', row(allowed, enabled, limit_per_min, remaining, reset_seconds, retry_after, key_used)::text
      from sie_api_rate_limit_hit('00000000-0000-0000-0000-0000000000ff', null);
update public.sie_rate_limit_overrides set is_enabled = false where user_id = '00000000-0000-0000-0000-0000000000ff';
insert into public.test_baseline
    select 'api_off', row(allowed, enabled, limit_per_min, remaining, reset_seconds, retry_after, key_used)::text
      from sie_api_rate_limit_hit('00000000-0000-0000-0000-0000000000ff', null);
insert into public.test_baseline
    select 'api_ip', row(allowed, enabled, limit_per_min, remaining, reset_seconds, retry_after, key_used)::text
      from sie_api_rate_limit_hit(null, '203.0.113.9');
delete from public.sie_rate_limit_overrides where user_id = '00000000-0000-0000-0000-0000000000ff';
delete from public.sie_rate_limit_buckets;
update public.customer_sie_access set messages_used = 0 where user_id = '00000000-0000-0000-0000-0000000000ff';
