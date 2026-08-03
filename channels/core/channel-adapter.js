/**
 * channel-adapter.js
 * ------------------------------------------------------------
 * الواجهة اللي كل قناة بتنفّذها، والمسار المشترك اللي بيمشي عليه أي دور
 * مهما كانت القناة.
 *
 * ------------------------------------------------------------
 * THE CONTRACT
 *
 * An adapter is four functions and a name. Nothing more, because
 * everything else — session lookup, entitlement, calling SIE, retrying a
 * failed send, deduplication — is identical across channels and lives in
 * handleInbound() below. An adapter that had to reimplement any of that
 * would be an invitation for the channels to drift apart in behaviour.
 *
 *   name        the CHANNELS value this adapter serves
 *   verify      (request) -> {ok, reason}   is this request genuinely from the channel?
 *   parse       (payload) -> InboundMessage[]   the channel's format -> the standard one
 *   send        (chatId, OutboundMessage) -> Promise   the standard one -> the channel's format
 *   typing      (chatId) -> Promise         optional; a no-op where the channel has no such concept
 *
 * `parse` returns an ARRAY because several channels batch: a WhatsApp
 * webhook carries multiple entries, and Messenger batches messaging
 * events. Telegram sends one update per call, so its adapter returns a
 * one-element array. Making the common case return an array too means
 * handleInbound() has exactly one code path instead of two.
 *
 * ------------------------------------------------------------
 * WHAT ADAPTERS MUST NOT DO
 *
 * No adapter talks to SIE, to chat_sessions, or to the entitlement RPCs.
 * Those all sit behind the pipeline here, so "how a turn is run" is
 * defined once. This is the same reasoning that put every SIE call behind
 * sie-runtime.js: one seam, so the thing behind it can change.
 */
import { CHANNELS, hasProcessableContent, hasUnsupportedAttachmentOnly, deduplicationKey } from './channel-message.js';
import { createLogger } from './logger.js';

/**
 * @typedef {Object} ChannelAdapter
 * @property {string} name
 * @property {(request: {headers: Object, body: *, url: string}) => {ok: boolean, reason?: string}} verify
 * @property {(payload: *) => import('./channel-message.js').InboundMessage[]} parse
 * @property {(chatId: string, message: import('./channel-message.js').OutboundMessage) => Promise<void>} send
 * @property {(chatId: string) => Promise<void>} [typing]
 */

const REQUIRED_METHODS = ['verify', 'parse', 'send'];

/**
 * Fails loudly at registration rather than at 3am on a real customer
 * message. An adapter missing `send` is a programming error, and the only
 * useful moment to find out is startup.
 *
 * @param {ChannelAdapter} adapter
 * @returns {ChannelAdapter}
 */
export function defineAdapter(adapter) {
    if (!adapter || typeof adapter !== 'object') {
        throw new TypeError('adapter must be an object');
    }
    if (!Object.values(CHANNELS).includes(adapter.name)) {
        throw new TypeError(`unknown channel name: ${adapter.name}`);
    }
    for (const method of REQUIRED_METHODS) {
        if (typeof adapter[method] !== 'function') {
            throw new TypeError(`adapter "${adapter.name}" is missing ${method}()`);
        }
    }
    return adapter;
}

/**
 * سجلّ القنوات. بيسمح بإضافة قناة جديدة من غير ما أي كود تاني يتغير.
 */
export function createAdapterRegistry() {
    const adapters = new Map();

    return {
        register(adapter) {
            const validated = defineAdapter(adapter);
            if (adapters.has(validated.name)) {
                throw new Error(`channel "${validated.name}" is already registered`);
            }
            adapters.set(validated.name, validated);
            return validated;
        },
        get(name) {
            return adapters.get(name) ?? null;
        },
        names() {
            return [...adapters.keys()];
        },
        get size() {
            return adapters.size;
        }
    };
}

/**
 * ردود ثابتة للحالات اللي المحرك مابيشوفهاش أصلاً. عربي، لأن دي القناة
 * اللي العميل بيتكلم بيها.
 *
 * These live here and not in an adapter because every channel needs the
 * same four, and a customer should get the same explanation whichever one
 * they used.
 */
export const CHANNEL_REPLIES = Object.freeze({
    unsupportedAttachment:
        'وصلتني الحاجة اللي بعتها، بس أنا لسه بقرا الرسايل المكتوبة بس. '
        + 'ممكن تكتبلي المشكلة في رسالة؟',
    notLinked:
        'أهلاً بيك! عشان أقدر أساعدك، لازم تربط حسابك في مدعوم بالمحادثة دي الأول. '
        + 'ابعتلي الكود اللي هتلاقيه في صفحة الإعدادات بتاعتك على المنصة.',
    notEntitled:
        'حسابك مش مفعّل على المساعد الذكي دلوقتي. تقدر تتواصل مع فريق الدعم من المنصة وهما هيساعدوك.',
    temporaryFailure:
        'حصلت مشكلة مؤقتة عندي وأنا بحاول أرد عليك. جرّب تبعت الرسالة تاني بعد شوية.'
});

/**
 * المسار المشترك لأي رسالة داخلة، مهما كانت القناة.
 *
 * The order is not arbitrary:
 *
 *   1. verify   — an unverified request is dropped before it can cost
 *                 anything. Never do work for a caller you have not
 *                 authenticated.
 *   2. parse    — vendor format dies here; everything downstream is standard.
 *   3. dedupe   — before entitlement, because a redelivered message must
 *                 not spend a second message from the customer's quota.
 *   4. resolve  — who is this, in Mad3oom's terms?
 *   5. run      — the single SIE seam.
 *   6. send     — with retry, because the reply already cost a quota unit
 *                 and losing it to one flaky HTTP call would be the worst
 *                 possible failure.
 *
 * Returns a summary rather than throwing: webhooks must answer 200 even
 * for messages that could not be processed, or the channel retries
 * forever. The caller decides the status code; this function's job is to
 * say what happened.
 *
 * @param {Object} params
 * @param {ChannelAdapter} params.adapter
 * @param {Object} params.request - {headers, body, url}
 * @param {Object} params.deps - {sieClient, identity, dedupe, logger}
 * @returns {Promise<{status: string, handled: number, results: Array}>}
 */
export async function handleInbound({ adapter, request, deps }) {
    const log = deps.logger ?? createLogger(adapter.name);

    const verification = adapter.verify(request);
    if (!verification.ok) {
        log.warn('rejected an unverified request', { reason: verification.reason });
        return { status: 'unverified', handled: 0, results: [] };
    }

    let messages;
    try {
        messages = adapter.parse(request.body) ?? [];
    } catch (err) {
        // A payload we cannot parse is not retryable — the same bytes will
        // fail identically next time — so this is logged and swallowed.
        log.error('could not parse the payload', { error: err?.message });
        return { status: 'unparseable', handled: 0, results: [] };
    }

    const results = [];
    for (const message of messages) {
        results.push(await handleOneMessage({ adapter, message, deps, log }));
    }

    return { status: 'ok', handled: results.length, results };
}

async function handleOneMessage({ adapter, message, deps, log }) {
    const context = { channel: message.channel, chat: message.channelChatId, messageId: message.messageId };

    if (deps.dedupe) {
        const key = deduplicationKey(message);
        if (await deps.dedupe.seen(key)) {
            log.info('skipped a message already handled', context);
            return { outcome: 'duplicate' };
        }
        await deps.dedupe.remember(key);
    }

    // Media with no caption: answer honestly instead of sending '' into the
    // engine, which would read as an empty turn and produce a non-sequitur.
    if (hasUnsupportedAttachmentOnly(message)) {
        log.info('received an attachment with no text', { ...context, kinds: message.attachments.map((a) => a.kind) });
        await deliver(adapter, message, { text: CHANNEL_REPLIES.unsupportedAttachment, options: [] }, deps, log);
        return { outcome: 'unsupported_attachment' };
    }

    if (!hasProcessableContent(message)) {
        log.info('ignored a message with nothing to act on', context);
        return { outcome: 'empty' };
    }

    const identity = await deps.identity.resolve(message);
    if (!identity.linked) {
        log.info('message from an unlinked account', context);
        await deliver(adapter, message, { text: identity.reply ?? CHANNEL_REPLIES.notLinked, options: [] }, deps, log);
        return { outcome: 'not_linked' };
    }

    if (adapter.typing) {
        // Best-effort: a failed typing indicator must never cost the reply.
        await adapter.typing(message.channelChatId).catch(() => {});
    }

    let reply;
    try {
        reply = await deps.sieClient.reply({ message, identity });
    } catch (err) {
        log.error('the SIE call failed', { ...context, error: err?.message });
        await deliver(adapter, message, { text: CHANNEL_REPLIES.temporaryFailure, options: [] }, deps, log);
        return { outcome: 'sie_error' };
    }

    // null means SIE declined the turn — not entitled, quota spent, or an
    // internal fallback. On the website Mad3oom falls back to its own bot;
    // on a messaging channel there is no second engine to fall back to, so
    // the customer is told plainly rather than left with silence. The
    // explainer reads (never spends) the access row to say WHICH of those
    // it was, because "expired" and "try again later" call for very
    // different actions from the customer.
    if (!reply) {
        log.info('SIE did not handle the turn', context);
        const explanation = deps.entitlement
            ? await deps.entitlement.explainRefusal(identity.userId)
            : CHANNEL_REPLIES.notEntitled;
        await deliver(adapter, message, { text: explanation, options: [] }, deps, log);
        return { outcome: 'not_handled' };
    }

    await deliver(adapter, message, reply, deps, log);
    return { outcome: 'replied', ticketNumber: reply.ticketNumber ?? null };
}

async function deliver(adapter, message, outbound, deps, log) {
    try {
        await adapter.send(message.channelChatId, outbound);
    } catch (err) {
        // The reply is already lost at this point — the quota was spent and
        // the answer computed. Log loudly; there is nothing left to try.
        log.error('could not deliver the reply', {
            channel: message.channel,
            chat: message.channelChatId,
            error: err?.message
        });
    }
}
