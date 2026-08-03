-- 0006_allow_service_role_writes_for_channel_turns.sql
-- ============================================================================
-- STATUS: APPLIED to the shared Mad3oom/SIE project (srnelrdpqkcntbgudyto).
--
-- Both write RPCs identified the acting customer as auth.uid(). That is right
-- in the browser and fatal from a channel webhook, where there is no session
-- and auth.uid() is NULL:
--
--   persist_bot_turn
--     The UPDATE matched zero rows and raised, so every Telegram turn threw
--     AFTER the customer's quota had already been spent. Charged, no reply.
--     Observed live before the fix: messages_used reached 5 with zero
--     messages delivered.
--
--   create_ticket_with_message_and_session_update
--     Worse: it would have inserted a ticket with user_id = NULL — an orphan
--     nobody owns — before failing on the same session UPDATE.
--
-- The fix is NOT to relax the ownership check; that would let any caller
-- write to any session. The acting user is DERIVED instead:
--
--   auth.uid() when there is a session  (browser: unchanged, still must own
--                                        the row)
--   otherwise, and only for service_role, the session's own user_id
--
-- So a webhook can only ever act as the customer who owns the session it was
-- handed, and a ticket is attributed to that real account rather than to
-- NULL. Everything else about both functions is untouched.
--
-- Verified live after applying: a Telegram turn produced a real diagnosis,
-- wrote one bot message, and spent exactly one quota unit.
-- ============================================================================

create or replace function public.persist_bot_turn(
    p_session_id uuid,
    p_turn integer,
    p_message_text text,
    p_bot_state jsonb
)
returns jsonb
language plpgsql
set search_path to 'public'
as $function$
declare
    v_message_id uuid;
    v_message_created_at timestamptz;
    v_actor uuid;
begin
    -- Who is this turn for? The browser answers with its own session; a
    -- channel webhook has none, so the session row names the owner.
    if auth.uid() is not null then
        v_actor := auth.uid();
    elsif coalesce(auth.role(), '') = 'service_role' then
        select user_id into v_actor from chat_sessions where id = p_session_id;
    end if;

    if v_actor is null then
        raise exception 'not permitted to write to chat_sessions row %', p_session_id;
    end if;

    insert into chat_messages (session_id, sender_id, message_text, is_admin_reply, is_bot_reply)
    values (p_session_id, null, p_message_text, false, true)
    returning id, created_at into v_message_id, v_message_created_at;

    update chat_sessions
    set bot_state = p_bot_state,
        updated_at = now()
    where id = p_session_id
      and user_id = v_actor;

    if not found then
        raise exception 'chat_sessions row % not found or not permitted for this user', p_session_id;
    end if;

    return jsonb_build_object(
        'message_id', v_message_id,
        'message_created_at', v_message_created_at,
        'session_id', p_session_id,
        'turn', p_turn
    );
end;
$function$;

create or replace function public.create_ticket_with_message_and_session_update(
    p_session_id uuid,
    p_turn integer,
    p_message_text text,
    p_bot_state jsonb,
    p_scenario_id text,
    p_category text,
    p_description text
)
returns table(ticket_number bigint)
language plpgsql
set search_path to 'public'
as $function$
declare
    v_ticket_number bigint;
    v_title text;
    v_actor uuid;
begin
    if auth.uid() is not null then
        v_actor := auth.uid();
    elsif coalesce(auth.role(), '') = 'service_role' then
        select user_id into v_actor from chat_sessions where id = p_session_id;
    end if;

    -- Checked BEFORE the ticket insert, so a failed authorization can no
    -- longer leave an ownerless ticket behind.
    if v_actor is null then
        raise exception 'not permitted to write to chat_sessions row %', p_session_id;
    end if;

    v_title := left(coalesce(nullif(p_category, ''), 'دعم عام') || ' — عبر محرك الدعم الذكي', 200);

    insert into tickets (user_id, title, description, category, status)
    values (v_actor, v_title, coalesce(p_description, ''), p_category, 'open')
    returning tickets.ticket_number into v_ticket_number;

    insert into chat_messages (session_id, sender_id, message_text, is_admin_reply, is_bot_reply)
    values (p_session_id, null, p_message_text, false, true);

    update chat_sessions
    set bot_state = p_bot_state,
        updated_at = now()
    where id = p_session_id
      and user_id = v_actor;

    if not found then
        raise exception 'chat_sessions row % not found or not permitted for this user', p_session_id;
    end if;

    return query select v_ticket_number;
end;
$function$;
