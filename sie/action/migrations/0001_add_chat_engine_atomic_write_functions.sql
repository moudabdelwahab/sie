-- Migration: add_chat_engine_atomic_write_functions
-- ------------------------------------------------------------------
-- Adds the two Postgres RPC functions the Action Layer's SupabasePort
-- (action/supabase-port.supabase.js) calls. Each function performs all
-- of a decision action's writes inside one server-side transaction, so
-- "atomicityGuaranteed" in action-types.js's ActionResult reflects a
-- real, database-enforced guarantee rather than a client-side promise.
--
-- SECURITY INVOKER (not DEFINER): each function runs with the calling
-- user's own permissions, so Row Level Security on chat_messages,
-- chat_sessions, and tickets is fully preserved — this migration does
-- not bypass RLS anywhere. user_id is always taken from auth.uid()
-- server-side, never trusted from a function argument, so a caller
-- cannot write into another user's session or ticket.
--
-- NO SCHEMA CHANGES beyond these two functions: no new columns, no new
-- tables. The ticket diagnostic trail is passed in as `p_description`
-- (already formatted plain text by action-types.js's
-- formatTicketDescription()) and written straight into the existing
-- tickets.description column.
--
-- ⚠️ CORRECTED AGAINST THE LIVE SCHEMA.
-- An earlier version of this file was written from an inferred schema and
-- had drifted from what is actually deployed. Running it as written would
-- have replaced the working functions with broken ones, because it
-- inserted into chat_messages columns that do not exist. The real table is:
--
--   id, session_id, sender_id, message_text, is_bot_reply, is_admin_reply,
--   created_at, image_url, audio_url
--
-- There is no `turn`, `sender` or `text` column. `p_turn` is therefore
-- accepted (callers pass it, and it is echoed back) but deliberately not
-- stored — turn numbering lives in chat_sessions.bot_state, which is the
-- only place it is ever read from.
-- ------------------------------------------------------------------

create or replace function persist_bot_turn(
    p_session_id uuid,
    p_turn integer,
    p_message_text text,
    p_bot_state jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path to 'public'
as $$
declare
    v_message_id uuid;
    v_message_created_at timestamptz;
begin
    insert into chat_messages (session_id, sender_id, message_text, is_admin_reply, is_bot_reply)
    values (p_session_id, null, p_message_text, false, true)
    returning id, created_at into v_message_id, v_message_created_at;

    update chat_sessions
    set bot_state = p_bot_state,
        updated_at = now()
    where id = p_session_id
      and user_id = auth.uid();

    -- A session that does not belong to the caller must fail loudly rather
    -- than silently persisting a bot message against nothing: the whole
    -- point of doing both writes here is that they succeed or fail together.
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
$$;

create or replace function create_ticket_with_message_and_session_update(
    p_session_id uuid,
    p_turn integer,
    p_message_text text,
    p_bot_state jsonb,
    p_scenario_id text,
    p_category text,
    p_description text
)
returns table (ticket_number bigint)
language plpgsql
security invoker
as $$
declare
    v_ticket_number bigint;
begin
    insert into tickets (session_id, user_id, scenario_id, category, description, status, created_at)
    values (p_session_id, auth.uid(), p_scenario_id, p_category, p_description, 'open', now())
    returning tickets.ticket_number into v_ticket_number;

    insert into chat_messages (session_id, sender_id, message_text, is_admin_reply, is_bot_reply)
    values (p_session_id, null, p_message_text, false, true);

    update chat_sessions
    set bot_state = p_bot_state,
        updated_at = now()
    where id = p_session_id
      and user_id = auth.uid();

    return query select v_ticket_number;
end;
$$;
