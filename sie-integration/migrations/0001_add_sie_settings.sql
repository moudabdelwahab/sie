-- 0001_add_sie_settings.sql
-- ============================================================================
-- STATUS: APPLIED to the shared Mad3oom/SIE project (srnelrdpqkcntbgudyto).
--
-- One key/value row per engine switch. The settings console writes here and
-- the chat bridge reads here, so a change made by staff takes effect on the
-- next customer turn without a deploy.
--
-- Why a table and not a config file: SIE ships as static files served from
-- Mad3oom's origin. There is no server-side config to edit, and no build step
-- staff can trigger. The database is the only writable surface both halves of
-- the system already share.
--
-- Read is open to any authenticated session because the bridge runs in the
-- customer's own browser and must know whether the engine is switched on
-- before it answers. The values are operational booleans, not secrets.
-- Writes are staff-only.
-- ============================================================================

create table if not exists public.sie_settings (
    key         text primary key,
    value       jsonb       not null,
    updated_at  timestamptz not null default now(),
    updated_by  uuid        references auth.users (id) on delete set null
);

alter table public.sie_settings enable row level security;

drop policy if exists sie_settings_read on public.sie_settings;
create policy sie_settings_read
    on public.sie_settings
    for select
    to authenticated
    using (true);

drop policy if exists sie_settings_write on public.sie_settings;
create policy sie_settings_write
    on public.sie_settings
    for all
    to authenticated
    using (public.is_chat_engine_staff())
    with check (public.is_chat_engine_staff());

-- Stamped server-side rather than trusted from the client: who changed a
-- switch is audit information, so the client must not get to choose it.
create or replace function public.touch_sie_settings_updated_at()
returns trigger
language plpgsql
as $$
begin
    new.updated_at := now();
    new.updated_by := auth.uid();
    return new;
end;
$$;

drop trigger if exists trg_touch_sie_settings on public.sie_settings;
create trigger trg_touch_sie_settings
    before insert or update on public.sie_settings
    for each row execute function public.touch_sie_settings_updated_at();

-- Seeds describe today's behaviour exactly, so seeding changes nothing about
-- how the engine acts — it only gives the console rows to render. `do nothing`
-- keeps a re-run from reverting choices staff have already made.
insert into public.sie_settings (key, value) values
    ('engine_enabled',          'true'::jsonb),
    ('answer_directly',         'true'::jsonb),
    ('ask_before_ticket',       'true'::jsonb),
    ('auto_ticket_enabled',     'true'::jsonb),
    ('escalate_when_upset',     'true'::jsonb),
    ('reply_to_greetings',      'true'::jsonb),
    ('use_published_scenarios', 'false'::jsonb)
on conflict (key) do nothing;
