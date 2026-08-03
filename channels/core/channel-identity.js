/**
 * channel-identity.js
 * ------------------------------------------------------------
 * مين اللي بيكتب، بلغة مدعوم مش بلغة القناة.
 *
 * ------------------------------------------------------------
 * THE PROBLEM THIS SOLVES
 *
 * SIE is metered per Mad3oom account: sie_consume_message() spends one
 * message from `customer_sie_access`, and every write in the pipeline is
 * scoped to a chat_sessions row owned by a real auth.users id. A Telegram
 * sender has none of that — they are a number in Telegram's id space and
 * nothing more.
 *
 * So a channel message can only be answered once that number has been
 * tied to an account. That tie is a deliberate, revocable act by the
 * account owner, recorded in `channel_identities`.
 *
 * ------------------------------------------------------------
 * WHY LINKING IS NOT OPTIONAL
 *
 * The tempting shortcut is to answer anyone who writes in and attribute
 * it to some default account. That would let any stranger who finds the
 * bot spend a paying customer's quota, and would file tickets under their
 * name. The linking code exists precisely so that cannot happen: an
 * unlinked chat gets an explanation, never an answer.
 *
 * The code is single-use and expires. A code that stayed valid forever in
 * a customer's settings page is a standing credential, and screenshots of
 * settings pages end up in support threads.
 *
 * ------------------------------------------------------------
 * WHY A NEW TABLE AND NOT profiles.telegram_chat_id
 *
 * `profiles.telegram_chat_id` already exists, but it means something
 * else: it is where the platform sends 2FA codes and ticket alerts to the
 * ACCOUNT OWNER, written by the existing telegram-webhook function.
 * Overloading it would mean a customer who links a support chat silently
 * redirects their own security codes to it. `channel_identities` is
 * separate, is per-channel, and covers all five channels with one shape.
 */

/**
 * @typedef {Object} ResolvedIdentity
 * @property {boolean} linked
 * @property {string|null} userId - the Mad3oom auth.users id
 * @property {string|null} reply - what to tell the sender when not linked
 */

/** How long a linking code stays usable. Short: it is typed within a minute or abandoned. */
export const LINK_CODE_TTL_MINUTES = 15;

/**
 * Recognises a linking attempt.
 *
 * Accepts the code on its own or after Telegram's /start, because
 * `/start ABC123` is what a deep link produces and typing the bare code
 * is what someone does when they copy it from the settings page. Both are
 * the same intent and neither should be treated as a support question.
 *
 * The code shape (8 chars, unambiguous alphabet) is defined by the
 * database function that mints them; this only has to recognise it.
 *
 * @param {string} text
 * @returns {string|null} the code, upper-cased, or null
 */
export function extractLinkCode(text) {
    const trimmed = String(text || '').trim();
    const withoutCommand = trimmed.replace(/^\/start\s+/i, '').trim();
    const candidate = withoutCommand.toUpperCase();
    return /^[A-Z0-9]{8}$/.test(candidate) ? candidate : null;
}

/**
 * Builds the identity resolver backed by `channel_identities`.
 *
 * @param {Object} params
 * @param {Object} params.supabase - MUST be a service-role client; see below
 * @param {Object} [params.logger]
 * @returns {{resolve: (message: Object) => Promise<ResolvedIdentity>}}
 */
export function createIdentityResolver({ supabase, logger = null }) {
    return {
        async resolve(message) {
            // A linking code is handled before anything else: it is not a
            // support question, and answering it as one would be baffling.
            const code = extractLinkCode(message.text);
            if (code) {
                return await redeemCode({ supabase, logger, message, code });
            }

            try {
                const { data, error } = await supabase
                    .from('channel_identities')
                    .select('user_id, is_active')
                    .eq('channel', message.channel)
                    .eq('channel_user_id', message.channelUserId)
                    .maybeSingle();

                if (error) {
                    logger?.error('could not read the channel identity', { error: error.message });
                    // Fail CLOSED. An identity lookup that failed is not
                    // permission to spend someone's quota.
                    return { linked: false, userId: null, reply: null };
                }

                if (!data || !data.is_active) {
                    return { linked: false, userId: null, reply: null };
                }

                return { linked: true, userId: data.user_id, reply: null };
            } catch (err) {
                logger?.error('the channel identity lookup threw', { error: err?.message });
                return { linked: false, userId: null, reply: null };
            }
        }
    };
}

/**
 * Redeems a linking code, atomically, inside the database.
 *
 * The check-then-write is a single RPC rather than a read here followed by
 * a write: two people racing the same code must not both get linked, and
 * only the database can settle that.
 */
async function redeemCode({ supabase, logger, message, code }) {
    try {
        const { data, error } = await supabase.rpc('channel_redeem_link_code', {
            p_code: code,
            p_channel: message.channel,
            p_channel_user_id: message.channelUserId,
            p_channel_chat_id: message.channelChatId,
            p_display_name: message.displayName ?? null
        });

        if (error) {
            logger?.error('redeeming the link code failed', { error: error.message });
            return { linked: false, userId: null, reply: LINK_REPLIES.failed };
        }

        const row = Array.isArray(data) ? data[0] : data;
        if (!row?.success) {
            // The reason is deliberately not spelled out to the sender —
            // "already used" versus "no such code" tells someone probing
            // codes which guesses were close.
            logger?.info('a link code was rejected', { reason: row?.reason ?? 'unknown' });
            return { linked: false, userId: null, reply: LINK_REPLIES.invalid };
        }

        logger?.info('an account was linked', { channel: message.channel });
        return { linked: false, userId: row.user_id, reply: LINK_REPLIES.success };
    } catch (err) {
        logger?.error('redeeming the link code threw', { error: err?.message });
        return { linked: false, userId: null, reply: LINK_REPLIES.failed };
    }
}

/**
 * ردود الربط. بترجع linked:false حتى لما الربط ينجح، عشان رسالة الكود
 * نفسها ماتتحسبش سؤال دعم وتستهلك رصيد.
 */
export const LINK_REPLIES = Object.freeze({
    success:
        'تمام، اتربط حسابك بنجاح ✅\n'
        + 'دلوقتي تقدر تسألني عن أي مشكلة وهساعدك من هنا على طول.',
    invalid:
        'الكود ده مش مظبوط أو انتهت صلاحيته. '
        + 'روح لصفحة الإعدادات في مدعوم واطلب كود جديد.',
    failed:
        'حصلت مشكلة مؤقتة وأنا بربط حسابك. جرّب تاني بعد شوية.'
});
