/**
 * telegram-verify.js
 * ------------------------------------------------------------
 * التحقق إن الطلب جاي من تيليجرام فعلاً.
 *
 * ------------------------------------------------------------
 * THE THREAT
 *
 * A webhook URL is public by construction — it has to be, Telegram calls
 * it from the open internet with no credentials of ours. So anyone who
 * learns the URL can POST a forged Update: a message that appears to come
 * from a linked customer's chat id. Without verification that is enough
 * to spend their quota, read answers meant for them, and file tickets in
 * their name.
 *
 * ------------------------------------------------------------
 * THE DEFENCE
 *
 * Telegram's setWebhook takes a `secret_token`, and echoes it back in the
 * X-Telegram-Bot-Api-Secret-Token header on every call. Checking that
 * header is the documented way to authenticate a webhook, and it is what
 * the platform's existing telegram-webhook function already does.
 *
 * The comparison is constant-time. A naive `===` on strings leaks the
 * secret one character at a time to an attacker who can measure response
 * timing across many requests — the classic attack on exactly this shape
 * of check. The cost of doing it properly here is a few microseconds.
 *
 * IP allow-listing is deliberately NOT used as the primary control:
 * Telegram's published ranges change, an Edge Function sees a proxy
 * address rather than the true peer, and a wrong allow-list fails closed
 * on real traffic. The shared secret is both stronger and simpler.
 */

import { constantTimeEquals, readHeader } from '../core/request-verify.js';

/** Telegram's own header name for the echoed secret. Lower-cased; header lookup is case-insensitive. */
export const SECRET_HEADER = 'x-telegram-bot-api-secret-token';

/**
 * Builds the verifier for one bot's configured secret.
 *
 * An empty configured secret is treated as a hard failure rather than as
 * "no verification required". A deployment that forgot to set the secret
 * would otherwise silently accept forged updates — failing closed turns
 * that into an obvious outage instead of a silent hole.
 *
 * @param {{secretToken: string}} config
 * @returns {(request: {headers: Object}) => {ok: boolean, reason?: string}}
 */
export function createVerifier({ secretToken }) {
    return function verify(request) {
        if (!secretToken) {
            return { ok: false, reason: 'no_secret_configured' };
        }

        const provided = readHeader(request?.headers, SECRET_HEADER);
        if (!provided) {
            return { ok: false, reason: 'missing_secret_header' };
        }

        if (!constantTimeEquals(provided, secretToken)) {
            return { ok: false, reason: 'secret_mismatch' };
        }

        return { ok: true };
    };
}

/**
 * A structural check on the payload, run after authentication.
 *
 * Authentication says the caller is Telegram; this says the body is
 * shaped like something Telegram sends. Cheap, and it keeps malformed
 * payloads from reaching the parser.
 *
 * @param {*} body
 * @returns {boolean}
 */
export function looksLikeUpdate(body) {
    return Boolean(body && typeof body === 'object' && typeof body.update_id === 'number');
}

/** Re-exported so callers of this module get the primitives without a second import. */
export { constantTimeEquals, readHeader };
