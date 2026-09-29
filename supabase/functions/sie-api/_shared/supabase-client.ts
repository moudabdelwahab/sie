/**
 * supabase-client.ts
 * ------------------------------------------------------------
 * Builds a Supabase client scoped to the CALLER's own JWT, forwarded
 * verbatim from the incoming Authorization header — never the
 * service-role key, for customer-facing operations.
 *
 * Why this matters, concretely (verified against the live database, not
 * assumed):
 *   - sie_consume_message(p_user_id) hard-fails unless p_user_id =
 *     auth.uid(). A service-role call has auth.uid() = NULL, so it would
 *     always fail closed.
 *   - persist_bot_turn / create_ticket_with_message_and_session_update
 *     are the one exception, and only for WRITING the bot's turn — see
 *     buildTurnWriterClient below.
 *   - is_sie_admin() / is_chat_engine_staff() are SECURITY DEFINER but
 *     still resolve identity from auth.uid() internally.
 *
 * In short: every RPC this API wraps is identity-bound to the caller by
 * design, on the database side. A service-role client would not "have
 * more access" here — it would have LESS, because these functions treat
 * "no identity" as "no permission", not "trusted caller".
 *
 * (The Telegram channel is the deliberate exception: there is no user
 * session on Telegram, so it runs as service_role and passes an explicit
 * user_id resolved from channel_identities. That asymmetry is why the
 * RPCs accept both shapes.)
 */
import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;

export function buildUserClient(req: Request): SupabaseClient {
    const authHeader = req.headers.get('Authorization') ?? '';
    return createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
        global: { headers: { Authorization: authHeader } },
        auth: { persistSession: false, autoRefreshToken: false }
    });
}

/**
 * The server's own client, used for ONE thing: writing the bot's turn
 * (persist_bot_turn / create_ticket_with_message_and_session_update).
 *
 * Mad3oom Phase 3 (migration 062) takes those two RPCs away from the
 * customer's role — anyone holding the customer's token could otherwise
 * call them directly and write any text as a bot reply, with any bot_state.
 * Both RPCs already accept service_role (they take the owner from the
 * session row, like the Telegram channel), so the turn is written by the
 * server after the caller's own client has proved the session is theirs
 * (chat-reply.ts reads it under RLS first). Metering, reads and traces stay
 * on the caller's client.
 */
export function buildTurnWriterClient(): SupabaseClient {
    return createClient(SUPABASE_URL, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
        auth: { persistSession: false, autoRefreshToken: false }
    });
}
