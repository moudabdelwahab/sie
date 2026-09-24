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
update public.customer_sie_access set messages_used = 0 where user_id = '00000000-0000-0000-0000-0000000000ff';
