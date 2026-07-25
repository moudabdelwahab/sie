/**
 * observability-read-port.supabase.js
 * ------------------------------------------------------------
 * Real, thin implementation of the observability read port, reading a
 * stored conversation's customer messages back out of chat_messages.
 *
 * CORRECTED (verified against the live schema via Supabase MCP, not
 * assumed). The previous version of this file queried
 * `.select('turn, text').eq('sender', 'customer')` — none of `turn`,
 * `text`, or `sender` exist as columns on the live chat_messages table,
 * so this would have failed with a Postgres "column does not exist"
 * error on first real use. The live columns are:
 *
 *   id, session_id, sender_id, message_text, is_bot_reply,
 *   is_admin_reply, created_at, image_url
 *
 * Two consequences for this file specifically:
 *   1. "Customer message" is not a single sender enum value — it's the
 *      row where BOTH is_bot_reply and is_admin_reply are false.
 *   2. There is no stored `turn` number at all (confirmed by reading
 *      persist_bot_turn's own function body: it accepts p_turn but never
 *      writes it anywhere). Turn numbers for replay purposes are
 *      therefore derived here, client-side, as the 1-based position of
 *      each customer message within the session when ordered by
 *      created_at — matching this port's documented contract ("turns
 *      ordered ascending by turn") without requiring any new column.
 */
import { createObservabilityReadPort } from './observability-read-port.js';

/**
 * @param {import('@supabase/supabase-js').SupabaseClient} supabaseClient
 * @returns {import('./observability-read-port.js')}
 */
export function createObservabilityReadSupabasePort(supabaseClient) {
    return createObservabilityReadPort(async (sessionId) => {
        const { data, error } = await supabaseClient
            .from('chat_messages')
            .select('message_text, created_at')
            .eq('session_id', sessionId)
            .eq('is_bot_reply', false)
            .eq('is_admin_reply', false)
            .order('created_at', { ascending: true });

        if (error) {
            throw new Error(`Failed to load conversation from Supabase: ${error.message}`);
        }
        if (!data || data.length === 0) return null;

        return {
            sessionId,
            turns: data.map((row, index) => ({ turn: index + 1, rawText: row.message_text ?? '' }))
        };
    });
}
