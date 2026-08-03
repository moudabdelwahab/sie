/**
 * channel-session.js
 * ------------------------------------------------------------
 * تحويل محادثة القناة لجلسة في مدعوم.
 *
 * ------------------------------------------------------------
 * WHY THIS EXISTS
 *
 * SIE needs a `chat_sessions.id` and a `bot_state` blob. A Telegram chat
 * has neither — it has a chat id that lives forever and no concept of a
 * conversation ending. This module is the mapping between the two, and it
 * is channel-agnostic on purpose: WhatsApp and Messenger have exactly the
 * same shape of problem.
 *
 * ------------------------------------------------------------
 * ONE SESSION PER CHAT, NOT PER MESSAGE
 *
 * The obvious implementation — a new session per inbound message — would
 * destroy the engine's memory. SIE's whole diagnostic model is
 * cross-turn: evidence accumulates in bot_state, and `memory_keep_context`
 * exists precisely so operators can tune how long that lasts. A fresh
 * session per message would make every turn look like turn one.
 *
 * So a chat maps to a durable session, and the engine's own context
 * expiry (memory_context_minutes) decides when to forget — one place
 * making that decision instead of two disagreeing.
 *
 * ------------------------------------------------------------
 * WHY THE SERVICE-ROLE CLIENT IS CORRECT HERE
 *
 * Elsewhere in SIE, using service-role would be a mistake: sie-api's
 * supabase-client.ts explains at length that the RPCs are identity-bound
 * and a service-role caller has LESS access, not more, because they treat
 * "no identity" as "no permission".
 *
 * A webhook is the case that reasoning does not cover. There is no user
 * session to forward — Telegram does not send us a Mad3oom JWT and never
 * will. The trust boundary moves to the webhook secret plus the linking
 * record: we know which account this chat belongs to because the account
 * owner proved it with a code. That is why every write here passes an
 * explicit user_id rather than relying on auth.uid().
 */

/** The channel session's own idea of "this conversation went quiet". Distinct from the engine's context expiry. */
export const SESSION_IDLE_HOURS = 24;

/**
 * @param {Object} params
 * @param {Object} params.supabase - service-role client
 * @param {Object} [params.logger]
 * @param {number} [params.idleHours]
 * @returns {{getOrCreate: Function, saveState: Function}}
 */
export function createSessionStore({ supabase, logger = null, idleHours = SESSION_IDLE_HOURS }) {
    return {
        /**
         * The live session for this chat, creating one if needed.
         *
         * @param {{userId: string, channel: string, channelChatId: string}} params
         * @returns {Promise<{sessionId: string, botState: Object|null}>}
         */
        async getOrCreate({ userId, channel, channelChatId }) {
            const existing = await findLiveSession({ supabase, userId, channel, channelChatId, idleHours, logger });
            if (existing) return existing;

            const { data, error } = await supabase
                .from('chat_sessions')
                .insert({
                    user_id: userId,
                    status: 'active',
                    // `guest_id` is the only free-text column on chat_sessions, and
                    // Mad3oom already uses it to tag non-authenticated web visitors.
                    // Reusing it keeps channel conversations visible in the existing
                    // dashboard instead of needing a schema change and a second
                    // place for support staff to look.
                    guest_id: channelSessionTag(channel, channelChatId),
                    bot_state: {}
                })
                .select('id, bot_state')
                .single();

            if (error) {
                logger?.error('could not create a session', { channel, error: error.message });
                throw new Error(`could not create a chat session: ${error.message}`);
            }

            logger?.info('opened a new session', { channel, session: data.id });
            return { sessionId: data.id, botState: data.bot_state ?? null };
        },

        /**
         * Persists the engine's returned bot_state.
         *
         * The engine's Action Layer already wrote the message and its own
         * state transactionally; this is the channel's copy of the blob for
         * the next turn. Failing here loses continuity, not the reply, so it
         * is logged rather than thrown.
         *
         * @param {string} sessionId
         * @param {Object} botState
         */
        async saveState(sessionId, botState) {
            if (!botState) return;
            const { error } = await supabase
                .from('chat_sessions')
                .update({ bot_state: botState, updated_at: new Date().toISOString() })
                .eq('id', sessionId);

            if (error) {
                logger?.error('could not save the session state', { session: sessionId, error: error.message });
            }
        }
    };
}

/**
 * The tag written into chat_sessions.guest_id so a channel conversation is
 * findable by its chat id.
 *
 * @param {string} channel
 * @param {string} channelChatId
 * @returns {string}
 */
export function channelSessionTag(channel, channelChatId) {
    return `channel:${channel}:${channelChatId}`;
}

async function findLiveSession({ supabase, userId, channel, channelChatId, idleHours, logger }) {
    const since = new Date(Date.now() - idleHours * 3600 * 1000).toISOString();

    const { data, error } = await supabase
        .from('chat_sessions')
        .select('id, bot_state, updated_at')
        .eq('user_id', userId)
        .eq('guest_id', channelSessionTag(channel, channelChatId))
        .eq('status', 'active')
        .gte('updated_at', since)
        .order('updated_at', { ascending: false })
        .limit(1);

    if (error) {
        // Fall through to creating one. A failed lookup that opened a second
        // session is a cosmetic problem; a failed lookup that dropped the
        // customer's message is not.
        logger?.warn('the session lookup failed, opening a new one', { channel, error: error.message });
        return null;
    }

    if (!data || data.length === 0) return null;
    return { sessionId: data[0].id, botState: data[0].bot_state ?? null };
}
