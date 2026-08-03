/**
 * telegram-adapter.js
 * ------------------------------------------------------------
 * قناة تيليجرام. بتنفّذ نفس الواجهة اللي كل القنوات بتنفّذها، ومفيش أي
 * حاجة خاصة بتيليجرام بره الملفات دي.
 *
 * Four functions, per the contract in core/channel-adapter.js:
 *   verify  -> telegram-verify.js  (the shared secret)
 *   parse   -> telegram-normalize.js (Update -> InboundMessage)
 *   send    -> telegram-api.js     (OutboundMessage -> sendMessage)
 *   typing  -> telegram-api.js     (best effort)
 *
 * The adapter itself holds no logic beyond wiring those together and
 * rendering quick-reply options into Telegram's keyboard format — which
 * is the one piece of formatting that is genuinely Telegram-shaped and
 * therefore belongs here rather than in core.
 */
import { CHANNELS } from '../core/channel-message.js';
import { defineAdapter } from '../core/channel-adapter.js';
import { withRetry } from '../core/delivery.js';
import { createVerifier, looksLikeUpdate } from './telegram-verify.js';
import { normalizeUpdate } from './telegram-normalize.js';
import { createTelegramApi, splitMessage } from './telegram-api.js';

/**
 * @param {Object} params
 * @param {string} params.botToken - from TELEGRAM_BOT_TOKEN; never hardcoded
 * @param {string} params.secretToken - from TELEGRAM_WEBHOOK_SECRET
 * @param {Object} [params.api] - injectable for tests
 * @param {Object} [params.logger]
 * @param {Object} [params.retry]
 * @returns {import('../core/channel-adapter.js').ChannelAdapter}
 */
export function createTelegramAdapter({ botToken, secretToken, api, logger = null, retry }) {
    const telegram = api ?? createTelegramApi({ botToken });
    const verify = createVerifier({ secretToken });

    return defineAdapter({
        name: CHANNELS.TELEGRAM,

        verify(request) {
            const authenticated = verify(request);
            if (!authenticated.ok) return authenticated;
            if (!looksLikeUpdate(request?.body)) return { ok: false, reason: 'not_an_update' };
            return { ok: true };
        },

        parse(payload) {
            return normalizeUpdate(payload);
        },

        /**
         * Sends the reply, splitting it if Telegram's length limit demands.
         *
         * Each chunk is retried independently. A partially delivered reply
         * is worse than a delayed one, so a mid-sequence failure stops the
         * remaining chunks rather than sending a message out of order after
         * a gap the customer has already tried to answer into.
         */
        async send(chatId, message) {
            const chunks = splitMessage(message.text);

            for (let i = 0; i < chunks.length; i += 1) {
                const isLast = i === chunks.length - 1;
                // The keyboard belongs on the final chunk only — attaching it
                // to each would stack several keyboards for one question.
                const options = isLast ? buildReplyMarkup(message.options) : {};

                await withRetry(
                    () => telegram.sendMessage(chatId, chunks[i], options),
                    { retry, logger, label: `sendMessage(${i + 1}/${chunks.length})` }
                );
            }
        },

        async typing(chatId) {
            // Not retried: it is a courtesy, and a stale "typing…" is worse
            // than none. One attempt or nothing.
            await telegram.sendChatAction(chatId);
        }
    });
}

/**
 * SIE's quick-reply options as a Telegram keyboard.
 *
 * A one-shot custom keyboard rather than inline buttons: an inline button
 * produces a callback_query, which is a different Update type needing its
 * own handling path, whereas a keyboard button sends its text as an
 * ordinary message — which the pipeline already understands. That keeps
 * "customer picked an option" and "customer typed the same words"
 * identical all the way down, which is exactly how the engine's ticket
 * confirmation already expects to be answered.
 *
 * The engine's labels carry [[icon:name]] markers that Mad3oom's web
 * widget renders as SVGs. Telegram has no such concept, so they are
 * stripped rather than shown as literal text.
 *
 * @param {Array<{label: string, value: string}>} options
 * @returns {Object}
 */
export function buildReplyMarkup(options) {
    if (!Array.isArray(options) || options.length === 0) {
        // Explicitly remove any keyboard left over from a previous turn;
        // otherwise the customer keeps seeing buttons for a question that
        // has already been answered.
        return { reply_markup: { remove_keyboard: true } };
    }

    return {
        reply_markup: {
            keyboard: options.map((option) => [{ text: stripIconMarkers(option.label) }]),
            resize_keyboard: true,
            one_time_keyboard: true
        }
    };
}

/**
 * @param {string} label
 * @returns {string}
 */
export function stripIconMarkers(label) {
    return String(label ?? '').replace(/\[\[icon:[a-z_-]+\]\]/gi, '').trim();
}
