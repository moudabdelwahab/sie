/**
 * sie-handoff.js  —  INTERNAL TO SIE
 * ------------------------------------------------------------
 * التسليم للإنسان (Mad3oom Phase 2 / migration 059).
 *
 * The guarantee itself lives in the database, not here: once a conversation
 * is with a human (chat_sessions.is_manual_mode), a trigger refuses every
 * bot-flagged chat_messages row — persist_bot_turn, the ticket RPC, browser
 * inserts, service-role writes alike. A turn that started before the
 * takeover finishes computing but cannot persist its reply.
 *
 * This module is the engine's side of the contract:
 *
 *   isHumanHandoffActive — a cheap read before a turn, so a conversation a
 *     human owns does not spend the customer's quota on a reply the database
 *     would refuse anyway. Advisory only: a read that fails answers "no" and
 *     the database still decides.
 *
 *   requestHumanHandoff — called once an escalation is FINAL (the engine's
 *     own escalation message is already persisted), through the audited
 *     server-side path sie_request_human. It can only turn human mode ON;
 *     nothing in the engine can hand the conversation back — that is an
 *     explicit staff action (inbox_return_to_ai).
 *
 * Both are total: they never throw and never reject.
 */

/**
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @param {string} sessionId
 * @returns {Promise<boolean>}
 */
export async function isHumanHandoffActive(supabase, sessionId) {
    if (!supabase || !sessionId) return false;
    try {
        const { data, error } = await supabase
            .from('chat_sessions')
            .select('is_manual_mode')
            .eq('id', sessionId)
            .maybeSingle();
        if (error) {
            console.warn('[sie] handoff state read failed (the database still enforces it):', error.message);
            return false;
        }
        return data?.is_manual_mode === true;
    } catch (err) {
        console.warn('[sie] handoff state read threw (the database still enforces it):', err?.message || err);
        return false;
    }
}

/**
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @param {Object} params
 * @param {string} params.sessionId
 * @param {string} params.reason - short machine-readable code, stored as "sie:<reason>"
 * @returns {Promise<{handedOff: boolean}>}
 */
export async function requestHumanHandoff(supabase, { sessionId, reason }) {
    if (!supabase || !sessionId) return { handedOff: false };
    try {
        const { error } = await supabase.rpc('sie_request_human', {
            p_session: sessionId,
            p_reason: reason || 'escalation'
        });
        if (error) {
            console.error('[sie] could not hand the conversation to a human:', error.message);
            return { handedOff: false };
        }
        return { handedOff: true };
    } catch (err) {
        console.error('[sie] handing the conversation to a human threw:', err?.message || err);
        return { handedOff: false };
    }
}
