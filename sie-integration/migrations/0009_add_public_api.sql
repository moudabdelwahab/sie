-- ============================================================================
-- 0009_add_public_api.sql
-- مفاتيح الـAPI العامة، وسجل الطلبات، وحد المعدل للنداءات اللي بمفتاح.
-- ----------------------------------------------------------------------------
-- الهجرة دي **إضافية بالكامل**: جدولين جداد ودوال جديدة. مفيش عمود
-- اتغير، ومفيش دالة موجودة اتلمست، ومفيش سياسة RLS قديمة اتعدلت. لو
-- اتشالت، النظام بيرجع زي ما هو بالظبط — الـAPI العام بس هو اللي بيقف.
--
-- ----------------------------------------------------------------------------
-- WHY KEYS AND NOT JWTs
--
-- Everything that exists today authenticates with the customer's own
-- Supabase JWT, and every RPC resolves the caller from auth.uid(). That is
-- right for a browser and useless for a server integration: a JWT expires
-- in an hour and cannot be put in a customer's CI secret.
--
-- So a key is a long-lived credential that NAMES a user. It never widens
-- what that user may do — the request still goes through
-- sie_consume_message(), the same entitlement row, and the same rate
-- limit. A key is a way to be someone you already are, not a way to skip
-- the checks.
--
-- ----------------------------------------------------------------------------
-- WHY ONLY THE HASH IS STORED
--
-- A stolen database backup must not be a set of working credentials. The
-- raw key exists in exactly two places for exactly one moment: the
-- response of sie_api_key_create(), and the customer's clipboard. After
-- that only sha256(key) survives, and verification hashes what the caller
-- presented and compares. There is no code path that can print a stored
-- key, because there is no stored key.
--
-- sha256 without a salt is deliberate and correct HERE: the input is 32
-- bytes of CSPRNG output, not a human-chosen password, so there is nothing
-- to brute force and a per-row salt would only prevent the O(1) lookup the
-- hot path needs on every single API request.
-- ============================================================================

-- pgcrypto قايم أصلاً على Supabase تحت schema extensions؛ السطر ده
-- بيتأكد بس من إن gen_random_bytes/digest متاحين للهجرة دي.
-- النداءات تحت من غير تأهيل بالـschema عن قصد: `search_path` بتاع كل دالة
-- فيه public و extensions، فالكود بيشتغل سواء الإضافة متركبة في دي أو دي.
create extension if not exists pgcrypto with schema extensions;

-- ============================================================================
-- 1. الجداول
-- ============================================================================

create table if not exists public.sie_api_keys (
    id             uuid primary key default gen_random_uuid(),
    user_id        uuid not null references auth.users(id) on delete cascade,

    -- اسم بيكتبه الأدمن عشان يعرف المفتاح ده بتاع إيه («Production»).
    name           text not null,

    -- 'live' | 'test'. الاتنين بيشتغلوا بنفس الطريقة دلوقتي؛ الفرق إن
    -- العميل يقدر يفصل مفاتيح التجربة عن الشغل ويلغي واحد من غير التاني.
    environment    text not null default 'live'
                   check (environment in ('live', 'test')),

    -- أول ١٦ حرف من المفتاح (sie_live_XXXXXXX). ده اللي بيتعرض في اللوحة
    -- وبيتكتب في السجلات — بيميّز المفتاح من غير ما يفتح أي باب.
    key_prefix     text not null,
    -- آخر ٤ حروف، عشان العميل يقدر يطابق المفتاح اللي عنده باللي في اللوحة.
    key_last4      text not null,
    -- sha256 للمفتاح الكامل، hex. ده الوحيد اللي بيتخزن من السر.
    key_hash       text not null unique,

    status         text not null default 'active'
                   check (status in ('active', 'revoked')),
    expires_at     timestamptz,
    last_used_at   timestamptz,
    revoked_at     timestamptz,

    -- لو المفتاح ده جه من تدوير مفتاح قديم، بنفضل عارفين مين قبله.
    rotated_from   uuid references public.sie_api_keys(id) on delete set null,

    created_at     timestamptz not null default now(),
    created_by     uuid references auth.users(id) on delete set null
);

-- البحث بالهاش هو المسار الساخن: مرة على كل طلب API.
create unique index if not exists sie_api_keys_hash_idx on public.sie_api_keys (key_hash);
create index if not exists sie_api_keys_user_idx on public.sie_api_keys (user_id, created_at desc);

comment on table public.sie_api_keys is
    'مفاتيح الـAPI العام. بيتخزن هاش المفتاح بس — القيمة الكاملة بتتعرض مرة واحدة وقت الإنشاء.';

-- ----------------------------------------------------------------------------
-- سجل الطلبات: مصدر أرقام الاستخدام في اللوحة.
--
-- بيتكتب من الدالة الطرفية بعد كل طلب. مافيهوش جسم الطلب ولا الرد ولا أي
-- مفتاح — بس اللي يخلي الأدمن يجاوب على «إيه اللي حصل في الطلب ده».
create table if not exists public.sie_api_requests (
    id             bigserial primary key,
    request_id     text not null,
    api_key_id     uuid references public.sie_api_keys(id) on delete set null,
    user_id        uuid references auth.users(id) on delete cascade,
    method         text not null,
    path           text not null,
    status         integer not null,
    error_code     text,
    duration_ms    integer,
    created_at     timestamptz not null default now()
);

create index if not exists sie_api_requests_user_idx on public.sie_api_requests (user_id, created_at desc);
create index if not exists sie_api_requests_key_idx on public.sie_api_requests (api_key_id, created_at desc);
create index if not exists sie_api_requests_request_idx on public.sie_api_requests (request_id);

comment on table public.sie_api_requests is
    'سجل طلبات الـAPI العام: مين ومتى وأي مسار وبأي حالة. مفيش أسرار ولا محتوى رسائل هنا.';

-- ============================================================================
-- 2. RLS
-- ============================================================================
-- نفس شكل customer_sie_access: العميل يشوف بتاعه، ومسؤول المحرك يشوف الكل،
-- والكتابة كلها من دوال SECURITY DEFINER مش من الجدول مباشرة.

alter table public.sie_api_keys enable row level security;
alter table public.sie_api_requests enable row level security;

drop policy if exists sie_api_keys_read on public.sie_api_keys;
create policy sie_api_keys_read on public.sie_api_keys
    for select to authenticated
    using (user_id = auth.uid() or public.is_sie_admin() or public.is_chat_engine_staff());

drop policy if exists sie_api_requests_read on public.sie_api_requests;
create policy sie_api_requests_read on public.sie_api_requests
    for select to authenticated
    using (user_id = auth.uid() or public.is_sie_admin() or public.is_chat_engine_staff());

-- مفيش سياسة insert/update/delete خالص: الكتابة بتعدي من الدوال تحت بس.

-- الصلاحيات مكتوبة صراحة بدل ما تتورّث من إعدادات المشروع الافتراضية:
-- Supabase بيمنح `all` على أي جدول جديد في public لـauthenticated، وهنا
-- القراءة بس هي المطلوبة — الكتابة كلها من دوال SECURITY DEFINER. لو
-- الافتراضي اتغير في المشروع، السطور دي بتفضل هي القاعدة.
revoke all on public.sie_api_keys from anon, authenticated;
revoke all on public.sie_api_requests from anon, authenticated;
grant select on public.sie_api_keys to authenticated;
grant select on public.sie_api_requests to authenticated;
grant all on public.sie_api_keys to service_role;
grant all on public.sie_api_requests to service_role;
grant usage, select on sequence public.sie_api_requests_id_seq to service_role;

-- ============================================================================
-- 3. إنشاء مفتاح
-- ============================================================================
-- بيرجّع المفتاح الخام **مرة واحدة**. مفيش دالة تانية في النظام كله بترجّعه.
--
-- الصيغة: sie_live_<43 حرف base64url>  (32 بايت عشوائية).
-- البادئة `sie_` بتخلي أي سكانر أسرار (GitHub secret scanning وغيره) يقدر
-- يتعرف عليه، والـ`live/test` بتخلي اللي بيقرا السجل يعرف نوعه بعينه.

create or replace function public.sie_api_key_create(
    p_user_id     uuid,
    p_name        text,
    p_environment text default 'live',
    p_expires_at  timestamptz default null
)
returns table (
    id          uuid,
    api_key     text,
    key_prefix  text,
    key_last4   text,
    environment text,
    expires_at  timestamptz,
    created_at  timestamptz
)
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
    v_secret text;
    v_key    text;
    v_id     uuid;
    v_env    text := coalesce(nullif(trim(p_environment), ''), 'live');
    v_name   text := nullif(trim(p_name), '');
begin
    -- إدارة المفاتيح لمسؤول المحرك بس. نفس البوابة اللي بتتحكم في
    -- صلاحيات العملاء، مش بوابة جديدة.
    if not public.is_sie_admin() then
        raise exception 'access denied' using errcode = '42501';
    end if;
    if p_user_id is null then
        raise exception 'user_id is required' using errcode = '22023';
    end if;
    if v_name is null then
        raise exception 'name is required' using errcode = '22023';
    end if;
    if v_env not in ('live', 'test') then
        raise exception 'environment must be live or test' using errcode = '22023';
    end if;

    -- base64url من 32 بايت: 43 حرف، من غير حروف بتتكسر في URL أو shell.
    v_secret := translate(encode(gen_random_bytes(32), 'base64'), '+/=', '-_');
    v_key    := 'sie_' || v_env || '_' || v_secret;
    v_id     := gen_random_uuid();

    insert into public.sie_api_keys (id, user_id, name, environment, key_prefix, key_last4, key_hash, expires_at, created_by)
    values (
        v_id,
        p_user_id,
        v_name,
        v_env,
        left(v_key, 16),
        right(v_key, 4),
        encode(digest(v_key, 'sha256'), 'hex'),
        p_expires_at,
        auth.uid()
    );

    return query
    select v_id, v_key, left(v_key, 16), right(v_key, 4), v_env, p_expires_at, now();
end;
$$;

revoke all on function public.sie_api_key_create(uuid, text, text, timestamptz) from public;
revoke all on function public.sie_api_key_create(uuid, text, text, timestamptz) from anon;
grant execute on function public.sie_api_key_create(uuid, text, text, timestamptz) to authenticated;

comment on function public.sie_api_key_create(uuid, text, text, timestamptz) is
    'ينشئ مفتاح API ويرجّع قيمته الكاملة مرة واحدة وبس. لمسؤول المحرك (is_sie_admin) فقط.';

-- ============================================================================
-- 4. قراءة المفاتيح
-- ============================================================================
-- بترجّع الميتاداتا بس. مفيش عمود سري في الـreturn، فحتى لو اتنادت من
-- مكان غلط مفيش حاجة تتسرب.

create or replace function public.sie_api_key_list(p_user_id uuid default null)
returns table (
    id           uuid,
    user_id      uuid,
    name         text,
    environment  text,
    key_prefix   text,
    key_last4    text,
    status       text,
    expires_at   timestamptz,
    last_used_at timestamptz,
    revoked_at   timestamptz,
    created_at   timestamptz,
    request_count bigint
)
language sql
security definer
set search_path = public
as $$
    select
        k.id, k.user_id, k.name, k.environment, k.key_prefix, k.key_last4,
        -- الانتهاء حالة محسوبة، مش عمود: مفتاح خلصت مدته مش «نشط» حتى لو
        -- الصف لسه مكتوب فيه كده، والتحقق بيرفضه فعلاً.
        case
            when k.status = 'revoked' then 'revoked'
            when k.expires_at is not null and k.expires_at <= now() then 'expired'
            else 'active'
        end as status,
        k.expires_at, k.last_used_at, k.revoked_at, k.created_at,
        (select count(*) from public.sie_api_requests r where r.api_key_id = k.id) as request_count
    from public.sie_api_keys k
    where (public.is_sie_admin() or public.is_chat_engine_staff() or k.user_id = auth.uid())
      and (p_user_id is null or k.user_id = p_user_id)
    order by k.created_at desc;
$$;

revoke all on function public.sie_api_key_list(uuid) from public;
revoke all on function public.sie_api_key_list(uuid) from anon;
grant execute on function public.sie_api_key_list(uuid) to authenticated;

-- ============================================================================
-- 5. إلغاء وتدوير
-- ============================================================================

create or replace function public.sie_api_key_revoke(p_key_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
    v_updated integer;
begin
    if not public.is_sie_admin() then
        raise exception 'access denied' using errcode = '42501';
    end if;

    update public.sie_api_keys
       set status = 'revoked', revoked_at = now()
     where id = p_key_id and status <> 'revoked';

    get diagnostics v_updated = row_count;
    return v_updated > 0;
end;
$$;

revoke all on function public.sie_api_key_revoke(uuid) from public;
revoke all on function public.sie_api_key_revoke(uuid) from anon;
grant execute on function public.sie_api_key_revoke(uuid) to authenticated;

-- التدوير = مفتاح جديد لنفس العميل + إلغاء القديم، في معاملة واحدة.
-- الاتنين مع بعض عشان مايحصلش إن القديم اتلغى والجديد فشل، فالتكامل يقف.
create or replace function public.sie_api_key_rotate(p_key_id uuid)
returns table (
    id          uuid,
    api_key     text,
    key_prefix  text,
    key_last4   text,
    environment text,
    expires_at  timestamptz,
    created_at  timestamptz
)
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
    v_old   public.sie_api_keys%rowtype;
    v_new   record;
begin
    if not public.is_sie_admin() then
        raise exception 'access denied' using errcode = '42501';
    end if;

    select * into v_old from public.sie_api_keys where sie_api_keys.id = p_key_id;
    if not found then
        raise exception 'key not found' using errcode = 'P0002';
    end if;

    select * into v_new
      from public.sie_api_key_create(v_old.user_id, v_old.name, v_old.environment, v_old.expires_at);

    update public.sie_api_keys set rotated_from = v_old.id where sie_api_keys.id = v_new.id;
    update public.sie_api_keys set status = 'revoked', revoked_at = now() where sie_api_keys.id = v_old.id;

    return query select v_new.id, v_new.api_key, v_new.key_prefix, v_new.key_last4,
                        v_new.environment, v_new.expires_at, v_new.created_at;
end;
$$;

revoke all on function public.sie_api_key_rotate(uuid) from public;
revoke all on function public.sie_api_key_rotate(uuid) from anon;
grant execute on function public.sie_api_key_rotate(uuid) to authenticated;

-- ============================================================================
-- 6. التحقق — المسار الساخن، لـservice_role بس
-- ============================================================================
-- الدالة دي هي الوحيدة اللي بتحوّل «مفتاح جه في هيدر» لـ«مين العميل ده».
-- ممنوعة على authenticated وanon تمامًا: اللي يقدر ينادي عليها يقدر يجرّب
-- هاشات، والدالة الطرفية بس هي اللي معاها مفتاح الخدمة.
--
-- بتاخد الهاش مش المفتاح: عشان القيمة الخام ماتوصلش لسجلات قاعدة البيانات
-- ولا لأي خطة استعلام.

create or replace function public.sie_api_key_verify(p_key_hash text)
returns table (
    key_id      uuid,
    user_id     uuid,
    environment text,
    key_prefix  text,
    reason      text
)
language plpgsql
security definer
set search_path = public
as $$
declare
    v_row public.sie_api_keys%rowtype;
begin
    if coalesce(auth.role(), '') <> 'service_role' then
        raise exception 'access denied' using errcode = '42501';
    end if;

    select * into v_row from public.sie_api_keys where key_hash = p_key_hash;

    if not found then
        return query select null::uuid, null::uuid, null::text, null::text, 'invalid'::text;
        return;
    end if;
    if v_row.status = 'revoked' then
        return query select v_row.id, null::uuid, v_row.environment, v_row.key_prefix, 'revoked'::text;
        return;
    end if;
    if v_row.expires_at is not null and v_row.expires_at <= now() then
        return query select v_row.id, null::uuid, v_row.environment, v_row.key_prefix, 'expired'::text;
        return;
    end if;

    -- «آخر استخدام» بيتكتب هنا، في نفس النداء اللي بيتحقق — مافيش نداء
    -- تاني ممكن يتنسى أو يفشل ويسيب العمود بيكدب.
    update public.sie_api_keys set last_used_at = now() where id = v_row.id;

    return query select v_row.id, v_row.user_id, v_row.environment, v_row.key_prefix, null::text;
end;
$$;

revoke all on function public.sie_api_key_verify(text) from public;
revoke all on function public.sie_api_key_verify(text) from anon;
revoke all on function public.sie_api_key_verify(text) from authenticated;
grant execute on function public.sie_api_key_verify(text) to service_role;

comment on function public.sie_api_key_verify(text) is
    'يحوّل هاش مفتاح لهوية العميل. service_role فقط — الدالة الطرفية هي المتصل الوحيد.';

-- ============================================================================
-- 7. تسجيل الطلب
-- ============================================================================

create or replace function public.sie_api_log_request(
    p_request_id  text,
    p_api_key_id  uuid,
    p_user_id     uuid,
    p_method      text,
    p_path        text,
    p_status      integer,
    p_error_code  text default null,
    p_duration_ms integer default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
    if coalesce(auth.role(), '') <> 'service_role' then
        raise exception 'access denied' using errcode = '42501';
    end if;

    insert into public.sie_api_requests
        (request_id, api_key_id, user_id, method, path, status, error_code, duration_ms)
    values
        (left(p_request_id, 64), p_api_key_id, p_user_id, left(p_method, 10),
         left(p_path, 200), p_status, left(p_error_code, 64), p_duration_ms);
end;
$$;

revoke all on function public.sie_api_log_request(text, uuid, uuid, text, text, integer, text, integer) from public;
revoke all on function public.sie_api_log_request(text, uuid, uuid, text, text, integer, text, integer) from anon;
revoke all on function public.sie_api_log_request(text, uuid, uuid, text, text, integer, text, integer) from authenticated;
grant execute on function public.sie_api_log_request(text, uuid, uuid, text, text, integer, text, integer) to service_role;

-- ============================================================================
-- 8. ملخص الاستخدام للوحة
-- ============================================================================
-- كل الأرقام من الجدول نفسه. اللي مالوش صفوف بيرجّع أصفار — واللوحة
-- بتعرضها «—» لما ماتكونش موجودة أصلاً، مش بتخترع رقم.

create or replace function public.sie_api_usage_summary(
    p_user_id uuid default null,
    p_since   timestamptz default null
)
returns table (
    user_id         uuid,
    total_requests  bigint,
    ok_requests     bigint,
    error_requests  bigint,
    rate_limited    bigint,
    last_request_at timestamptz,
    active_keys     bigint
)
language sql
security definer
set search_path = public
as $$
    with scope as (
        select r.*
          from public.sie_api_requests r
         where (public.is_sie_admin() or public.is_chat_engine_staff() or r.user_id = auth.uid())
           and (p_user_id is null or r.user_id = p_user_id)
           and (p_since is null or r.created_at >= p_since)
    )
    select
        p_user_id,
        (select count(*) from scope),
        (select count(*) from scope where status >= 200 and status < 300),
        (select count(*) from scope where status >= 400),
        (select count(*) from scope where status = 429),
        (select max(created_at) from scope),
        (select count(*) from public.sie_api_keys k
          where (public.is_sie_admin() or public.is_chat_engine_staff() or k.user_id = auth.uid())
            and (p_user_id is null or k.user_id = p_user_id)
            and k.status = 'active'
            and (k.expires_at is null or k.expires_at > now()));
$$;

revoke all on function public.sie_api_usage_summary(uuid, timestamptz) from public;
revoke all on function public.sie_api_usage_summary(uuid, timestamptz) from anon;
grant execute on function public.sie_api_usage_summary(uuid, timestamptz) to authenticated;

-- ============================================================================
-- 9. حد المعدل — إصلاح، وبعدين نسخة للنداء بمفتاح
-- ============================================================================
--
-- ⚠️ إصلاح خطأ في هجرة 0008، اتكشف وإحنا بنختبر الهجرة دي على Postgres
-- حقيقي (sie-integration/tests/public-api-sql.test.mjs).
--
-- الكود القديم كان بيقرا استثناء العميل كده:
--
--     select coalesce(o.is_enabled, v_enabled), ...
--       into v_enabled, v_limit, v_burst
--       from public.sie_rate_limit_overrides o
--      where o.user_id = v_uid;
--
-- في PL/pgSQL، `SELECT ... INTO` لما مايلاقيش أي صف **بيحط NULL في كل
-- المتغيرات** بدل ما يسيبها زي ما هي. ومعظم العملاء مالهمش صف استثناء
-- أصلاً — الصف ده بيتكتب بس لما أدمن يحط استثناء بإيده.
--
-- النتيجة: لأي عميل من غير استثناء، v_enabled بتبقى NULL، والشرط
-- `if v_enabled is not true` بيتحقق، والدالة بترجّع
-- allowed=true, enabled=false, limit=NULL — يعني **حد المعدل مقفول
-- فعليًا على أغلب العملاء**، والهيدرز مابتتبعتش، والأدمن شايف في اللوحة
-- إن الحد مفعّل.
--
-- اتأكدنا من ده بالتشغيل: نفس المستخدم بيرجّع enabled=false قبل ما
-- يتحطله صف استثناء، وenabled=true بعده.
--
-- الإصلاح: نقرا أعمدة الاستثناء في متغيرات لوحدها وبعدين coalesce.
-- من غير صف، التلاتة بيبقوا NULL والقيم العامة بتفضل زي ما هي.
--
-- ليه ده جوه هجرة الـAPI: الـAPI العام ده سطح على الإنترنت، وأول سطر
-- حماية فيه هو حد المعدل. نشره فوق حدّ متقفل من غير ما حد يعرف مش
-- خيار. التغيير في جسم الدالة بس — نفس الاسم ونفس التوقيع ونفس شكل
-- الإرجاع ونفس الصلاحيات، فمفيش متصل بيتأثر.

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
    -- أعمدة الاستثناء لوحدها، عشان «مفيش صف» مايمسحش الإعداد العام.
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

    select coalesce((value #>> '{}')::boolean, true) into v_enabled
      from public.sie_settings where key = 'rate_limit_enabled';
    v_enabled := coalesce(v_enabled, true);

    select coalesce((value #>> '{}')::integer, 100) into v_limit
      from public.sie_settings where key = 'rate_limit_requests_per_minute';
    v_limit := coalesce(v_limit, 100);

    select coalesce((value #>> '{}')::integer, 20) into v_burst
      from public.sie_settings where key = 'rate_limit_burst';
    v_burst := coalesce(v_burst, 20);

    if v_uid is not null then
        select o.is_enabled, o.requests_per_minute, o.burst
          into v_o_enabled, v_o_limit, v_o_burst
          from public.sie_rate_limit_overrides o
         where o.user_id = v_uid;

        v_enabled := coalesce(v_o_enabled, v_enabled);
        v_limit   := coalesce(v_o_limit, v_limit);
        v_burst   := coalesce(v_o_burst, v_burst);
    end if;

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

-- ----------------------------------------------------------------------------
-- صرف تذكرة من دلو — التنفيذ الوحيد لحسبة الدلو.
--
-- اتنقل هنا عشان المسارين (متصفح بـauth.uid، وAPI بمفتاح) يصرفوا بنفس
-- الكود بالظبط. نسختين من الحسبة دي هما نسختين هيختلفوا يوم ما حد يعدل
-- في واحدة، وساعتها العميل بياخد حد مختلف حسب الباب اللي دخل منه.
create or replace function public.sie_rl_spend(
    p_key   text,
    p_limit integer,
    p_burst integer
)
returns table (tokens double precision, allowed boolean)
language plpgsql
security definer
set search_path = public
as $$
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
$$;

revoke all on function public.sie_rl_spend(text, integer, integer) from public;
revoke all on function public.sie_rl_spend(text, integer, integer) from anon;
revoke all on function public.sie_rl_spend(text, integer, integer) from authenticated;
grant execute on function public.sie_rl_spend(text, integer, integer) to service_role;

comment on function public.sie_rl_spend(text, integer, integer) is
    'يصرف تذكرة واحدة من دلو معيّن. التنفيذ الوحيد لحسبة الدلو — بيتنادى من دالتَي حد المعدل.';

-- ----------------------------------------------------------------------------
-- النسخة اللي الـAPI بينادي عليها.
--
-- sie_rate_limit_hit() بتستنتج العميل من auth.uid() وبترفض إنها تاخده من
-- الطالب — وده صح تمامًا لمتصفح. نداء الـAPI مالوش auth.uid() أصلاً
-- (بيتنفذ بـservice_role بعد ما المفتاح اتحقق)، فمحتاج مدخل تاني.
--
-- المفتاح بيتحسب بنفس الشكل: user:<uuid>. لو اتفصلوا، العميل ياخد ضعف
-- الحد بمجرد إنه يستخدم المتصفح والـAPI مع بعض.

create or replace function public.sie_api_rate_limit_hit(
    p_user_id   uuid,
    p_client_ip text default null
)
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
    v_o_enabled boolean;
    v_o_limit   integer;
    v_o_burst   integer;
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
        select o.is_enabled, o.requests_per_minute, o.burst
          into v_o_enabled, v_o_limit, v_o_burst
          from public.sie_rate_limit_overrides o
         where o.user_id = p_user_id;

        v_enabled := coalesce(v_o_enabled, v_enabled);
        v_limit   := coalesce(v_o_limit, v_limit);
        v_burst   := coalesce(v_o_burst, v_burst);
    end if;

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

revoke all on function public.sie_api_rate_limit_hit(uuid, text) from public;
revoke all on function public.sie_api_rate_limit_hit(uuid, text) from anon;
revoke all on function public.sie_api_rate_limit_hit(uuid, text) from authenticated;
grant execute on function public.sie_api_rate_limit_hit(uuid, text) to service_role;

comment on function public.sie_api_rate_limit_hit(uuid, text) is
    'حد المعدل لنداء جاي بمفتاح API. نفس دلو sie_rate_limit_hit بالظبط عشان المفتاح مايضاعفش الحد.';
