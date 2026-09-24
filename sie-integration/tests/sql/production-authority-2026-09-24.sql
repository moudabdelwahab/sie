-- production-authority-2026-09-24.sql
-- The platform's AUTHORITY model as DEPLOYED in production on 2026-09-24
-- (pg_get_functiondef / information_schema / pg_policies, read-only). These
-- come from Mad3oom's migrations 038–053, not from this repository; they are
-- reproduced here so 0010 is tested against the real owner check, the real
-- SIE-admin grants and the real privileged audit — not against a flag.
--
-- Applied after supabase-stubs.sql (and after 0009) by
-- scripts/test-migrations.sh. It REPLACES the stubs' flag-based
-- is_sie_admin()/is_chat_engine_staff() with the production definitions.
-- NOT a migration; never applied anywhere but a scratch database.

-- ── identity columns the authority functions read ─────────────────────────
alter table public.profiles add column if not exists role text;
create table if not exists public.companies (id uuid primary key default gen_random_uuid(), user_id uuid);

create table if not exists public.platform_authority (
    user_id uuid primary key references auth.users(id) on delete cascade,
    level text not null check (level in ('owner', 'elevated_admin')),
    granted_at timestamptz not null default now(),
    note text
);
create table if not exists public.owner_context_state (
    user_id uuid primary key, context text not null,
    entered_at timestamptz not null default now(), expires_at timestamptz not null
);
create table if not exists public.privileged_step_ups (
    user_id uuid primary key, session_id text, verified_at timestamptz not null default now(),
    expires_at timestamptz not null, last_counter bigint not null default 0
);
create table if not exists public.sie_admin_grants (
    user_id uuid primary key references auth.users(id) on delete cascade,
    granted_by uuid, granted_at timestamptz not null default now(), note text
);

-- ── the functions, verbatim ───────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public._jwt_session_id() RETURNS text LANGUAGE sql STABLE SET search_path TO ''
AS $function$
  select nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'session_id';
$function$;

CREATE OR REPLACE FUNCTION public.is_platform_owner() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  select exists (
    select 1
      from public.platform_authority a
      join public.profiles p on p.id = a.user_id
     where a.user_id = auth.uid()
       and a.level   = 'owner'
       and p.role    = 'platform_owner'
  );
$function$;

CREATE OR REPLACE FUNCTION public.owns_a_company(p_user_id uuid DEFAULT auth.uid()) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  select p_user_id is not null
     and exists (select 1 from public.companies c where c.user_id = p_user_id);
$function$;

CREATE OR REPLACE FUNCTION public.active_context() RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  select s.context
    from public.owner_context_state s
   where s.user_id = auth.uid()
     and s.expires_at > now()
     and public.is_platform_owner();
$function$;

CREATE OR REPLACE FUNCTION public.context_grants(p_context text) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  select case p_context
    when 'owner'                then public.is_platform_owner()
    when 'admin'                then public.is_platform_owner()
    when 'customer'             then public.is_platform_owner()
    when 'company_admin'        then public.is_platform_owner() and public.owns_a_company(auth.uid())
    when 'company_user_preview' then public.is_platform_owner() and public.owns_a_company(auth.uid())
    else false
  end;
$function$;

CREATE OR REPLACE FUNCTION public.context_allows(p_context text, p_capability text) RETURNS boolean LANGUAGE sql IMMUTABLE
AS $function$
  select coalesce(case p_capability
    when 'owner_only'     then p_context = 'owner'
    when 'admin'          then p_context in ('owner', 'admin')
    when 'staff'          then p_context in ('owner', 'admin')
    when 'company_admin'  then p_context in ('owner', 'company_admin')
    when 'company_member' then p_context = 'company_user_preview'
    when 'customer'       then p_context in ('owner', 'customer')
    else false
  end, false);
$function$;

CREATE OR REPLACE FUNCTION public.in_context(p_context text) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  select coalesce(public.active_context() = p_context, false)
     and coalesce(public.context_grants(p_context), false);
$function$;

CREATE OR REPLACE FUNCTION public.preview_mode() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  select public.in_context('company_user_preview');
$function$;

CREATE OR REPLACE FUNCTION public.owner_capability(p_capability text) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  select coalesce(
    public.is_platform_owner()
      and public.context_allows(public.active_context(), p_capability)
      and case p_capability
            when 'company_admin'  then public.owns_a_company(auth.uid())
            when 'company_member' then public.owns_a_company(auth.uid())
            else true
          end,
    false);
$function$;

CREATE OR REPLACE FUNCTION public.is_platform_staff() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  select exists (
           select 1 from public.profiles p
            where p.id = auth.uid() and p.role in ('admin', 'support')
         )
      or public.owner_capability('staff');
$function$;

CREATE OR REPLACE FUNCTION public.sie_owner_authority() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  select coalesce(public.is_platform_owner() and not public.preview_mode(), false);
$function$;
revoke all on function public.sie_owner_authority() from public, anon;
grant execute on function public.sie_owner_authority() to authenticated;

CREATE OR REPLACE FUNCTION public.is_sie_admin() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  select public.sie_owner_authority()
      or exists (
           select 1
             from public.sie_admin_grants g
             join public.profiles p on p.id = g.user_id
            where g.user_id = auth.uid()
              and p.role in ('admin', 'support')
         );
$function$;

CREATE OR REPLACE FUNCTION public.is_chat_engine_staff() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  select public.is_platform_staff() or public.sie_owner_authority();
$function$;

CREATE OR REPLACE FUNCTION public.step_up_fresh() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  select coalesce((
    select s.expires_at > now()
       and s.session_id is not distinct from public._jwt_session_id()
      from public.privileged_step_ups s
     where s.user_id = auth.uid()
  ), false)
  and public.is_platform_owner();
$function$;

CREATE OR REPLACE FUNCTION public.request_user_agent() RETURNS text LANGUAGE plpgsql STABLE
AS $function$
begin
  return nullif(btrim(coalesce(
    (current_setting('request.headers', true))::jsonb ->> 'user-agent', '')), '');
exception when others then
  return null;
end;
$function$;

-- ── the privileged audit (053) ────────────────────────────────────────────
create table if not exists public.privileged_audit (
    id bigint generated always as identity primary key,
    at timestamptz not null default now(),
    actor_id uuid, actor_tier text, action text not null, target_user_id uuid,
    old_value jsonb, new_value jsonb, context text, step_up boolean,
    source text not null check (source in ('session', 'system')),
    user_agent text
);
alter table public.privileged_audit enable row level security;
drop policy if exists privileged_audit_select_owner on public.privileged_audit;
create policy privileged_audit_select_owner on public.privileged_audit
  for select to authenticated using (public.owner_capability('owner_only'));
revoke all on table public.privileged_audit from public, anon, authenticated;
grant select on table public.privileged_audit to authenticated;
create or replace function public.guard_privileged_audit_immutable() returns trigger language plpgsql set search_path to 'public'
as $$ begin raise exception 'privileged_audit لا يُعدَّل ولا يُحذف' using errcode = '42501'; end; $$;
drop trigger if exists trg_privileged_audit_immutable on public.privileged_audit;
create trigger trg_privileged_audit_immutable before update or delete on public.privileged_audit
  for each row execute function public.guard_privileged_audit_immutable();

CREATE OR REPLACE FUNCTION public.account_tier(p_user_id uuid) RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  select case
    when p_user_id is null then 'system'
    when exists (select 1 from public.platform_authority a where a.user_id = p_user_id and a.level = 'owner')
      then 'owner'
    when exists (select 1 from public.platform_authority a where a.user_id = p_user_id and a.level = 'elevated_admin')
      then 'platform_admin'
    else coalesce((select case p.role when 'admin' then 'admin' when 'support' then 'support' else 'customer' end
                     from public.profiles p where p.id = p_user_id), 'unknown')
  end;
$function$;
revoke all on function public.account_tier(uuid) from public, anon, authenticated;

CREATE OR REPLACE FUNCTION public.log_privileged(p_action text, p_target uuid, p_old jsonb, p_new jsonb) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
begin
  insert into public.privileged_audit
    (actor_id, actor_tier, action, target_user_id, old_value, new_value, context, step_up, source, user_agent)
  values
    (auth.uid(),
     public.account_tier(auth.uid()),
     p_action, p_target, p_old, p_new,
     public.active_context(),
     case when auth.uid() is null then null else public.step_up_fresh() end,
     case when auth.uid() is null then 'system' else 'session' end,
     public.request_user_agent());
end;
$function$;
revoke all on function public.log_privileged(text, uuid, jsonb, jsonb) from public, anon, authenticated;

CREATE OR REPLACE FUNCTION public.audit_authority_tables() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
declare
  v_target uuid;
begin
  if tg_table_name = 'sie_settings' then
    perform public.log_privileged('sie.setting.' || lower(tg_op), null,
      case when tg_op = 'INSERT' then null else jsonb_build_object(old.key, old.value) end,
      case when tg_op = 'DELETE' then null else jsonb_build_object(new.key, new.value) end);
    return coalesce(new, old);
  end if;
  v_target := coalesce((to_jsonb(new) ->> 'user_id')::uuid, (to_jsonb(old) ->> 'user_id')::uuid);
  perform public.log_privileged(
    tg_table_name || '.' || lower(tg_op), v_target,
    case when tg_op = 'INSERT' then null else to_jsonb(old) - 'user_id' end,
    case when tg_op = 'DELETE' then null else to_jsonb(new) - 'user_id' end);
  return coalesce(new, old);
end;
$function$;
drop trigger if exists trg_audit_sie_settings on public.sie_settings;
create trigger trg_audit_sie_settings after insert or update or delete on public.sie_settings
  for each row execute function public.audit_authority_tables();

-- ── the per-row history of customer_sie_access ────────────────────────────
create table if not exists public.customer_sie_access_audit (
    id bigint generated always as identity primary key,
    access_id uuid, user_id uuid not null, action text not null, changed_by uuid,
    old_values jsonb, new_values jsonb, created_at timestamptz not null default now()
);
alter table public.customer_sie_access_audit enable row level security;
drop policy if exists sie_audit_select on public.customer_sie_access_audit;
create policy sie_audit_select on public.customer_sie_access_audit for select using (is_sie_admin());
CREATE OR REPLACE FUNCTION public.log_customer_sie_access_change() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
begin
  insert into public.customer_sie_access_audit (access_id, user_id, action, changed_by, old_values, new_values)
  values (coalesce(new.id, old.id), coalesce(new.user_id, old.user_id),
          case when tg_op = 'INSERT' then 'created' else 'updated' end,
          auth.uid(), case when tg_op = 'UPDATE' then to_jsonb(old) else null end, to_jsonb(new));
  return new;
end; $function$;
drop trigger if exists trg_log_customer_sie_access on public.customer_sie_access;
create trigger trg_log_customer_sie_access after insert or update on public.customer_sie_access
  for each row execute function public.log_customer_sie_access_change();

-- ── member-preview is read-only (041) ─────────────────────────────────────
CREATE OR REPLACE FUNCTION public.guard_preview_read_only() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
begin
  if public.preview_mode() then
    raise exception 'معاينة عضو الشركة للقراءة فقط — اخرج من السياق للكتابة'
      using errcode = '42501';
  end if;
  return null;
end;
$function$;
drop trigger if exists trg_preview_read_only on public.customer_sie_access;
create trigger trg_preview_read_only before insert or update or delete on public.customer_sie_access
  for each statement execute function public.guard_preview_read_only();
drop trigger if exists trg_preview_read_only on public.sie_settings;
create trigger trg_preview_read_only before insert or update or delete on public.sie_settings
  for each statement execute function public.guard_preview_read_only();
