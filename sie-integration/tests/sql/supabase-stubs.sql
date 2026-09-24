-- supabase-stubs.sql
-- The smallest slice of Supabase the SIE migrations touch, so they can be
-- applied to a throwaway local Postgres and exercised for real. Identity is
-- set per statement with `set test.uid` / `set test.role` / `set test.admin`.
-- NOT a migration; never applied anywhere but a scratch database.
do $$ begin
    if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon; end if;
    if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated; end if;
    if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role; end if;
end $$;

create schema if not exists auth;
create table if not exists auth.users (id uuid primary key);
create or replace function auth.uid() returns uuid language sql stable as
    $$ select nullif(current_setting('test.uid', true), '')::uuid $$;
create or replace function auth.role() returns text language sql stable as
    $$ select nullif(current_setting('test.role', true), '') $$;

create table if not exists public.profiles (id uuid primary key);
create or replace function public.is_sie_admin() returns boolean language sql stable as
    $$ select coalesce(nullif(current_setting('test.admin', true), '')::boolean, false) $$;
create or replace function public.is_chat_engine_staff() returns boolean language sql stable as
    $$ select coalesce(nullif(current_setting('test.admin', true), '')::boolean, false) $$;

create table if not exists public.sie_settings (key text primary key, value jsonb not null);

-- customer_sie_access exactly as production has it before 0009.
create table if not exists public.customer_sie_access (
    id uuid not null default gen_random_uuid(),
    user_id uuid not null unique,
    is_enabled boolean not null default false,
    access_mode text not null default 'unlimited',
    message_quota integer,
    messages_used integer not null default 0,
    expires_at timestamptz,
    last_used_at timestamptz,
    notes text,
    metadata jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    created_by uuid,
    updated_by uuid
);

-- Row-level security and grants exactly as production has them (pg_policy
-- and information_schema.role_table_grants, read 2026-09-24). The broad
-- table grants are Supabase's defaults; RLS is what actually guards the rows.
grant usage on schema auth to anon, authenticated;
grant all on public.customer_sie_access, public.sie_settings to anon, authenticated;
alter table public.customer_sie_access enable row level security;
drop policy if exists sie_access_select on public.customer_sie_access;
create policy sie_access_select on public.customer_sie_access for select
    using (is_sie_admin() or (user_id = auth.uid()));
drop policy if exists sie_access_write on public.customer_sie_access;
create policy sie_access_write on public.customer_sie_access for all
    using (is_sie_admin()) with check (is_sie_admin());
alter table public.sie_settings enable row level security;
drop policy if exists sie_settings_read on public.sie_settings;
create policy sie_settings_read on public.sie_settings for select to authenticated using (true);
drop policy if exists sie_settings_write on public.sie_settings;
create policy sie_settings_write on public.sie_settings for all to authenticated
    using (is_chat_engine_staff()) with check (is_chat_engine_staff());

-- The production functions 0009 replaces, verbatim (pg_get_functiondef,
-- read 2026-09-24), so the migration is tested against what it drops.
CREATE OR REPLACE FUNCTION public.sie_consume_message(p_user_id uuid)
 RETURNS TABLE(allowed boolean, reason text, remaining integer)
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
declare
    v_row public.customer_sie_access%rowtype;
begin
    if p_user_id is null then
        return query select false, 'unauthorized'::text, null::integer;
        return;
    end if;
    if p_user_id <> coalesce(auth.uid(), p_user_id) or
       (auth.uid() is null and coalesce(auth.role(), '') <> 'service_role') then
        return query select false, 'unauthorized'::text, null::integer;
        return;
    end if;
    select * into v_row from public.customer_sie_access where user_id = p_user_id for update;
    if not found then
        return query select false, 'not_enabled'::text, null::integer;
        return;
    end if;
    if not v_row.is_enabled then
        return query select false, 'disabled'::text, null::integer;
        return;
    end if;
    if v_row.access_mode = 'expiration' and v_row.expires_at is not null and v_row.expires_at < now() then
        return query select false, 'expired'::text, null::integer;
        return;
    end if;
    if v_row.access_mode = 'quota' and v_row.messages_used >= coalesce(v_row.message_quota, 0) then
        return query select false, 'quota_exceeded'::text, 0;
        return;
    end if;
    update public.customer_sie_access set messages_used = messages_used + 1, last_used_at = now()
    where user_id = p_user_id returning messages_used into v_row.messages_used;
    if v_row.access_mode = 'quota' then
        return query select true, null::text, greatest(v_row.message_quota - v_row.messages_used, 0);
    else
        return query select true, null::text, null::integer;
    end if;
end;
$function$;

CREATE OR REPLACE FUNCTION public.sie_admin_set_access(p_user_id uuid, p_is_enabled boolean, p_access_mode text, p_message_quota integer, p_expires_at timestamp with time zone, p_notes text)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
begin
    if not is_sie_admin() then raise exception 'access denied: sie admin privileges required'; end if;
    insert into public.customer_sie_access (user_id, is_enabled, access_mode, message_quota, expires_at, notes)
    values (p_user_id, p_is_enabled, p_access_mode, p_message_quota, p_expires_at, p_notes)
    on conflict (user_id) do update set is_enabled = excluded.is_enabled, access_mode = excluded.access_mode,
        message_quota = excluded.message_quota, expires_at = excluded.expires_at, notes = excluded.notes;
end;
$function$;
