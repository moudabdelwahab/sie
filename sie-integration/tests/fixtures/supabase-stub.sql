-- ============================================================================
-- supabase-stub.sql — أقل حاجة لازمة عشان هجرات SIE تشتغل على Postgres عادي
-- ----------------------------------------------------------------------------
-- الهجرات مكتوبة لـSupabase، وSupabase بيقدّم حاجات مش موجودة في Postgres
-- نضيف: أدوار، schema اسمه auth، auth.uid()/auth.role()، وبوابتَي الصلاحية.
--
-- الملف ده **للاختبار بس**. مابيتنشرش ومابيتطبقش على أي قاعدة حقيقية —
-- على Supabase الحاجات دي موجودة أصلاً، وتعريفها تاني هيكون خطر.
--
-- الفكرة إن الهجرة الحقيقية تتطبق حرفيًا زي ما هي فوق الطبقة دي، فاللي
-- بيتختبر هو نص الهجرة نفسه مش نسخة مبسطة منه.
-- ============================================================================

-- الأدوار اللي الهجرات بتمنح وتمنع عليها.
do $$
begin
    if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
    if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
    if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin bypassrls; end if;
end $$;

create schema if not exists auth;
create schema if not exists extensions;
-- زي Supabase بالظبط: pgcrypto جوه extensions مش public، عشان الهجرة
-- تتختبر على نفس الشكل اللي هتتطبق عليه.
create extension if not exists pgcrypto with schema extensions;
grant usage on schema extensions to public;

create table if not exists auth.users (
    id    uuid primary key default gen_random_uuid(),
    email text
);

-- نفس تعريف Supabase: الهوية بتتقرا من إعدادات الجلسة، فالاختبار بيقدر
-- يقمّص أي متصل بـset_config من غير ما يعمل JWT حقيقي.
create or replace function auth.uid() returns uuid
language sql stable as $$
    select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
$$;

create or replace function auth.role() returns text
language sql stable as $$
    select coalesce(nullif(current_setting('request.jwt.claim.role', true), ''), 'anon');
$$;

-- بوابتا الصلاحية. على Supabase بيقروا من profiles؛ هنا بيقروا من إعداد
-- جلسة عشان الاختبار يقدر يقلب الدور من غير ما يبني جدول الملفات كله.
create or replace function public.is_sie_admin() returns boolean
language sql stable as $$
    select coalesce(nullif(current_setting('sie.test.is_admin', true), '')::boolean, false);
$$;

create or replace function public.is_chat_engine_staff() returns boolean
language sql stable as $$
    select coalesce(nullif(current_setting('sie.test.is_staff', true), '')::boolean, false);
$$;

-- الجداول اللي هجرات SIE السابقة بتفترض وجودها.
create table if not exists public.sie_settings (
    key        text primary key,
    value      jsonb not null,
    updated_at timestamptz not null default now()
);

create table if not exists public.customer_sie_access (
    user_id       uuid primary key references auth.users(id) on delete cascade,
    is_enabled    boolean not null default false,
    access_mode   text not null default 'unlimited',
    message_quota integer,
    messages_used integer not null default 0,
    expires_at    timestamptz,
    notes         text,
    updated_at    timestamptz not null default now()
);
