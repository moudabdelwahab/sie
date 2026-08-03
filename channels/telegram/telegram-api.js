/**
 * telegram-api.js
 * ------------------------------------------------------------
 * النداء على Bot API بتاع تيليجرام.
 *
 * The only file that makes HTTP calls to Telegram. Keeping it separate
 * from the adapter means the adapter can be tested by handing it a fake
 * API object, with no network and no token.
 *
 * ------------------------------------------------------------
 * THE TOKEN
 *
 * Taken as a constructor argument, never read from the environment here
 * and never logged. The bot token IS the bot: anyone holding it can read
 * every conversation and impersonate the bot to every customer. It
 * appears in the URL path (Telegram's design, not ours), which is exactly
 * why `describe()` below exists — so an error message can name the call
 * without carrying the token into a log line.
 *
 * Reference: https://core.telegram.org/bots/api
 */
import { DeliveryError, isRetryableStatus } from '../core/delivery.js';

const TELEGRAM_API_ROOT = 'https://api.telegram.org';

/** Telegram truncates anything longer, so split rather than lose the tail. */
export const MAX_MESSAGE_LENGTH = 4096;

/**
 * @param {Object} params
 * @param {string} params.botToken
 * @param {Function} [params.fetchImpl] - injectable for tests
 * @param {number} [params.timeoutMs]
 * @returns {Object}
 */
export function createTelegramApi({ botToken, fetchImpl = fetch, timeoutMs = 10000 }) {
    if (!botToken) throw new Error('botToken is required');

    async function call(method, payload) {
        const url = `${TELEGRAM_API_ROOT}/bot${botToken}/${method}`;

        // A webhook that hangs is worse than one that fails: Telegram gives
        // us a limited window before it redelivers, and a stuck fetch would
        // burn it and earn a duplicate.
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);

        let response;
        try {
            response = await fetchImpl(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
                signal: controller.signal
            });
        } catch (err) {
            // Network failure or timeout — both are worth another attempt.
            throw new DeliveryError(`telegram ${method} failed: ${err?.message ?? 'network error'}`, {
                retryable: true
            });
        } finally {
            clearTimeout(timer);
        }

        if (!response.ok) {
            const retryAfterMs = await readRetryAfter(response);
            throw new DeliveryError(`telegram ${method} returned ${response.status}`, {
                retryable: isRetryableStatus(response.status),
                status: response.status,
                retryAfterMs
            });
        }

        const body = await response.json().catch(() => null);
        if (!body?.ok) {
            // A 200 with ok:false is Telegram rejecting the request on its
            // merits — a blocked bot, a deleted chat. Retrying cannot help.
            throw new DeliveryError(`telegram ${method} rejected: ${body?.description ?? 'unknown'}`, {
                retryable: false,
                status: 200
            });
        }
        return body.result;
    }

    return {
        /**
         * @param {string} chatId
         * @param {string} text
         * @param {Object} [options]
         */
        async sendMessage(chatId, text, options = {}) {
            return call('sendMessage', {
                chat_id: chatId,
                text,
                // The engine's copy contains **bold** markers from the scenario
                // content, and Telegram renders those only when told which
                // dialect to expect.
                parse_mode: 'Markdown',
                disable_web_page_preview: true,
                ...options
            });
        },

        /**
         * The "typing…" indicator. Telegram clears it after ~5s or when a
         * message arrives, so it needs no explicit stop.
         *
         * @param {string} chatId
         */
        async sendChatAction(chatId) {
            return call('sendChatAction', { chat_id: chatId, action: 'typing' });
        },

        /** @param {Object} params */
        async setWebhook({ url, secretToken, allowedUpdates, dropPending = false }) {
            return call('setWebhook', {
                url,
                secret_token: secretToken,
                allowed_updates: allowedUpdates ?? ['message', 'edited_message'],
                drop_pending_updates: dropPending
            });
        },

        async deleteWebhook() {
            return call('deleteWebhook', {});
        },

        async getWebhookInfo() {
            return call('getWebhookInfo', {});
        },

        async getMe() {
            return call('getMe', {});
        }
    };
}

/**
 * Honours Telegram's own rate-limit hint.
 *
 * On 429 it replies with `parameters.retry_after` in seconds. Obeying it
 * is strictly better than guessing — and ignoring it on a rate-limited
 * bot extends the block.
 */
async function readRetryAfter(response) {
    const header = response.headers?.get?.('retry-after');
    if (header) {
        const seconds = Number(header);
        if (Number.isFinite(seconds)) return seconds * 1000;
    }
    try {
        const body = await response.clone().json();
        const seconds = body?.parameters?.retry_after;
        if (Number.isFinite(seconds)) return seconds * 1000;
    } catch {
        // No JSON body; fall back to the caller's backoff.
    }
    return null;
}

/**
 * Splits a reply that exceeds Telegram's per-message limit.
 *
 * Breaks on paragraph, then line, then a hard cut — so a long answer
 * arrives as readable chunks rather than severed mid-word. SIE's
 * scenario replies with resolution steps genuinely reach this length.
 *
 * @param {string} text
 * @param {number} [limit]
 * @returns {string[]}
 */
export function splitMessage(text, limit = MAX_MESSAGE_LENGTH) {
    const input = String(text ?? '');
    if (input.length <= limit) return [input];

    const chunks = [];
    let rest = input;

    while (rest.length > limit) {
        const window = rest.slice(0, limit);
        // Prefer the latest clean break inside the window.
        let cut = window.lastIndexOf('\n\n');
        if (cut < limit * 0.5) cut = window.lastIndexOf('\n');
        if (cut < limit * 0.5) cut = window.lastIndexOf(' ');
        if (cut < limit * 0.5) cut = limit;

        chunks.push(rest.slice(0, cut).trim());
        rest = rest.slice(cut).trim();
    }

    if (rest) chunks.push(rest);
    return chunks;
}
