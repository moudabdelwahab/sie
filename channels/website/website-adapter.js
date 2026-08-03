/**
 * website-adapter.js
 * ------------------------------------------------------------
 * قناة الموقع — الودجت اللي جوه منصة مدعوم.
 *
 * ------------------------------------------------------------
 * WHY THIS LOOKS DIFFERENT FROM THE OTHERS
 *
 * The website is not a webhook. Mad3oom's chat widget runs in the
 * customer's own browser with their own Supabase session, calls
 * sie-runtime.js directly, and renders the reply itself — there is no
 * inbound HTTP request from a third party and no outbound API to call.
 *
 * That difference is real and this adapter does not pretend otherwise:
 *
 *   verify  trivially true — the caller is the page itself, already
 *           authenticated by Supabase. There is no secret to check
 *           because there is no third party to authenticate.
 *   parse   wraps what the widget already has into the standard shape.
 *   send    hands the reply to a callback the widget supplies, because
 *           rendering belongs to the page, not to this layer.
 *
 * It is written anyway, for two reasons. First, it makes the interface
 * honest: an abstraction that only ever had webhook implementations would
 * have quietly grown webhook assumptions, and the website is the case
 * that keeps them out. Second, it gives the widget a migration path onto
 * the same contract as every other channel, so a change to how turns are
 * run reaches all five at once.
 *
 * NOTE: Mad3oom's widget does not use this yet — those files live in the
 * platform repo. Adopting it is a Mad3oom-side change, described in
 * channels/README.md.
 */
import { CHANNELS, createInboundMessage } from '../core/channel-message.js';
import { defineAdapter } from '../core/channel-adapter.js';

/**
 * @param {Object} params
 * @param {(message: Object) => void|Promise<void>} params.render - the widget's own renderer
 * @param {(isTyping: boolean) => void} [params.setTyping]
 * @returns {import('../core/channel-adapter.js').ChannelAdapter}
 */
export function createWebsiteAdapter({ render, setTyping = null }) {
    if (typeof render !== 'function') {
        throw new TypeError('createWebsiteAdapter requires a render(message) function');
    }

    return defineAdapter({
        name: CHANNELS.WEBSITE,

        /**
         * The page is the caller and Supabase already authenticated it.
         * Returning a constant here is the accurate answer, not a stub —
         * inventing a token to check would be theatre.
         */
        verify() {
            return { ok: true };
        },

        parse(payload) {
            if (!payload?.text) return [];
            return [createInboundMessage({
                channel: CHANNELS.WEBSITE,
                channelUserId: payload.userId,
                channelChatId: payload.sessionId,
                text: payload.text,
                messageId: payload.messageId ?? `${payload.sessionId}:${Date.now()}`,
                displayName: payload.displayName ?? null,
                raw: payload
            })];
        },

        async send(_chatId, message) {
            await render(message);
        },

        async typing(_chatId) {
            setTyping?.(true);
        }
    });
}
