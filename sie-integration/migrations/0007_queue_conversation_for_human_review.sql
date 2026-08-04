-- 0007_queue_conversation_for_human_review.sql
-- ============================================================
-- العميل رفض التذكرة، والمحادثة لازم توصل لمركز المراجعة برضه.
--
-- ------------------------------------------------------------
-- WHY AN RPC AND NOT A PLAIN INSERT
--
-- chat_engine_conversation_reviews has exactly one policy:
--
--     "Staff can manage conversation reviews"  USING is_chat_engine_staff()
--
-- Which is right for the review console and wrong for the only other
-- writer that now exists. The customer who just declined a ticket is not
-- staff, so on the website a direct insert is refused by RLS — and it is
-- refused SILENTLY as far as the customer is concerned, because the
-- engine would then tell them a human will be in touch within 24 hours
-- with no row to make that true.
--
-- On Telegram the same code path runs as service_role and the insert
-- succeeds, so the bug would have shipped looking like "it works",
-- failing only on the platform. That asymmetry is exactly what the user
-- asked to avoid: «ده يحصل سواء في البوت او المنصة».
--
-- So: SECURITY DEFINER, with the authority derived from ownership of the
-- session rather than from a role.
--
-- ------------------------------------------------------------
-- WHY auth.uid() ALONE IS NOT THE CHECK
--
-- The Telegram webhook has no user session — auth.uid() is NULL there.
-- Every earlier function in this schema that filtered on auth.uid()
-- broke the moment the bot called it (see 0006). The actor is therefore
-- resolved from chat_sessions.user_id, and three callers are allowed:
-- the session's owner, the service role (the webhook), and staff.
--
-- ------------------------------------------------------------
-- STATUS VALUES ARE THE TABLE'S, NOT INVENTED
--
--     CHECK (status = ANY (ARRAY['unresolved', 'reviewed', 'corrected']))
--
-- 'unresolved' is the queued state; the other two are outcomes. There is
-- no 'open' — an insert using one is rejected by the CHECK, which is how
-- a promise of contact ends up backed by nothing.
--
-- UNIQUE (session_id) already means one review per conversation, so a
-- customer who declines twice is one case. That is enforced here with
-- ON CONFLICT rather than a read-then-write, which would race.

create or replace function public.queue_conversation_for_review(
    p_session_id uuid,
    p_scenario_id text default null,
    p_notes text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
    v_owner uuid;
    v_review_id uuid;
begin
    select user_id into v_owner from chat_sessions where id = p_session_id;

    if v_owner is null then
        raise exception 'session not found: %', p_session_id
            using errcode = 'no_data_found';
    end if;

    -- Authorization before the write, never after: a caller who may not
    -- do this must not leave a row behind.
    if not (
        auth.uid() = v_owner
        or auth.role() = 'service_role'
        or is_chat_engine_staff()
    ) then
        raise exception 'not allowed to queue this conversation for review'
            using errcode = 'insufficient_privilege';
    end if;

    insert into chat_engine_conversation_reviews (session_id, status, corrected_scenario_id, notes)
    values (p_session_id, 'unresolved', p_scenario_id, p_notes)
    on conflict (session_id) do update
        -- Already queued and still waiting? Refresh the note so the agent
        -- reads the latest reason, but never reopen a case someone has
        -- already reviewed or corrected.
        set notes = excluded.notes
        where chat_engine_conversation_reviews.status = 'unresolved'
    returning id into v_review_id;

    -- ON CONFLICT ... WHERE skips the row when the case is already
    -- reviewed, which returns no id. The conversation IS on record, so
    -- that is a success, and the id is fetched rather than reported as a
    -- failure that would deny the customer their answer.
    if v_review_id is null then
        select id into v_review_id
        from chat_engine_conversation_reviews
        where session_id = p_session_id;
    end if;

    return v_review_id;
end;
$$;

-- Supabase grants EXECUTE on new functions to anon and authenticated by
-- default, and `revoke ... from public` does NOT remove those per-role
-- grants. They have to go by name, or an unauthenticated caller can hammer
-- this with guessed session ids.
revoke all on function public.queue_conversation_for_review(uuid, text, text) from public;
revoke all on function public.queue_conversation_for_review(uuid, text, text) from anon;

grant execute on function public.queue_conversation_for_review(uuid, text, text) to authenticated;
grant execute on function public.queue_conversation_for_review(uuid, text, text) to service_role;

comment on function public.queue_conversation_for_review(uuid, text, text) is
    'Records a conversation as needing human attention without opening a ticket, '
    'for a customer who declined one. Callable by the session owner, the service '
    'role (channel webhooks) and engine staff.';
