/**
 * api-adapter.js
 * ------------------------------------------------------------
 * قناة الـ API — للعملاء اللي بيربطوا أنظمتهم بمدعوم برمجيًا.
 *
 * ------------------------------------------------------------
 * WHAT MAKES THIS CHANNEL DIFFERENT
 *
 * Every other channel has a vendor on the far side with its own identity
 * model. Here the caller IS a Mad3oom customer, holding a token the
 * platform issued (`create-api-token` / `regenerate-api-token-secret`
 * already exist in the platform repo), so the linking dance the messaging
 * channels need has no place: the token already names the account.
 *
 * That makes it the natural template for anyone adding a sixth channel
 * whose users are already authenticated.
 *
 * ------------------------------------------------------------
 * WHY IT STILL GOES THROUGH THE SAME PIPELINE
 *
 * It would be simpler to let API callers hit sie-runtime directly. But
 * then deduplication, entitlement handling, retry and logging would apply
 * to four channels and not the fifth — and the fifth is the one a
 * customer can call in a loop. Same contract, same guarantees.
 */
import { CHANNELS, createInboundMessage } from '../core/channel-message.js';
import { defineAdapter } from '../core/channel-adapter.js';
import { readHeader } from '../core/request-verify.js';

/**
 * @param {Object} params
 * @param {(token: string) => Promise<{valid: boolean, userId: string|null}>} params.authenticateToken
 * @param {(chatId: string, message: Object) => Promise<void>} params.deliver - webhook back to the caller, or a queue
 * @param {Object} [params.logger]
 * @returns {import('../core/channel-adapter.js').ChannelAdapter}
 */
export function createApiAdapter({ authenticateToken, deliver, logger = null }) {
    return defineAdapter({
        name: CHANNELS.API,

        /**
         * Structural only. The bearer token is validated in the identity
         * resolver rather than here, because validating it means a database
         * lookup and `verify` is synchronous by contract — a deliberate
         * choice so that the cheap rejections (missing header, wrong shape)
         * happen before any I/O.
         */
        verify(request) {
            const header = readHeader(request?.headers, 'authorization');
            if (!header) return { ok: false, reason: 'missing_authorization' };
            if (!/^Bearer\s+\S+$/i.test(header)) return { ok: false, reason: 'malformed_authorization' };
            return { ok: true };
        },

        parse(payload) {
            if (!payload?.message?.text) return [];
            const { message } = payload;
            return [createInboundMessage({
                channel: CHANNELS.API,
                // The caller supplies its own end-user id so several of its
                // users map to separate conversations under one account.
                channelUserId: message.endUserId ?? 'default',
                channelChatId: message.conversationId ?? message.endUserId ?? 'default',
                text: message.text,
                messageId: message.id ?? `api:${Date.now()}`,
                locale: message.locale ?? null,
                raw: payload
            })];
        },

        async send(chatId, message) {
            await deliver(chatId, message);
        }
    });
}

/**
 * The identity resolver for this channel: the token names the account, so
 * there is nothing to link.
 *
 * Kept beside the adapter rather than in core/channel-identity.js because
 * it is the exception — every messaging channel shares the linking-code
 * resolver, and mixing this into it would put an API concern in the path
 * of every Telegram message.
 *
 * @param {Object} params
 * @param {(token: string) => Promise<{valid: boolean, userId: string|null}>} params.authenticateToken
 * @returns {{resolve: Function}}
 */
export function createApiIdentityResolver({ authenticateToken }) {
    return {
        async resolve(message) {
            const header = message.raw?.headers?.authorization ?? '';
            const token = header.replace(/^Bearer\s+/i, '');
            if (!token) return { linked: false, userId: null, reply: null };

            const result = await authenticateToken(token);
            if (!result?.valid || !result.userId) {
                return { linked: false, userId: null, reply: null };
            }
            return { linked: true, userId: result.userId, reply: null };
        }
    };
}
