/**
 * messenger-adapter.js
 * ------------------------------------------------------------
 * قناة ماسنجر (Facebook Messenger Platform).
 *
 * ------------------------------------------------------------
 * STATUS: same posture as the WhatsApp adapter — the shape is real, the
 * transport is not wired. Mad3oom already has a `meta-webhook` function
 * in the platform repo; moving it onto this contract is a platform-side
 * change, not something to switch on from here.
 *
 * Messenger and WhatsApp are both Meta products and share the
 * X-Hub-Signature-256 scheme, so verification is identical — but their
 * payload shapes are NOT the same (entry[].messaging[] here versus
 * entry[].changes[].value.messages[] there), which is why they are two
 * adapters rather than one with a flag. A shared "Meta adapter" would
 * spend most of its body branching on which product sent the request.
 */
import { CHANNELS, ATTACHMENT_KINDS, createInboundMessage } from '../core/channel-message.js';
import { defineAdapter } from '../core/channel-adapter.js';
import { readHeader } from '../core/request-verify.js';

const ATTACHMENT_KIND_BY_TYPE = {
    image: ATTACHMENT_KINDS.IMAGE,
    file: ATTACHMENT_KINDS.FILE,
    audio: ATTACHMENT_KINDS.VOICE,
    video: ATTACHMENT_KINDS.VIDEO
};

/**
 * @param {Object} params
 * @param {(rawBody: string, signature: string) => Promise<boolean>|boolean} params.verifySignature
 * @param {(chatId: string, message: Object) => Promise<void>} params.sendMessage
 * @param {Object} [params.logger]
 * @returns {import('../core/channel-adapter.js').ChannelAdapter}
 */
export function createMessengerAdapter({ verifySignature, sendMessage, logger = null }) {
    return defineAdapter({
        name: CHANNELS.MESSENGER,

        verify(request) {
            const signature = readHeader(request?.headers, 'x-hub-signature-256');
            if (!signature) return { ok: false, reason: 'missing_signature' };
            if (typeof request.rawBody !== 'string') {
                logger?.error('the raw body is required to verify the signature');
                return { ok: false, reason: 'raw_body_unavailable' };
            }
            return verifySignature(request.rawBody, signature)
                ? { ok: true }
                : { ok: false, reason: 'signature_mismatch' };
        },

        parse(payload) {
            const messages = [];
            for (const entry of payload?.entry ?? []) {
                for (const event of entry.messaging ?? []) {
                    // `is_echo` marks our OWN sent messages coming back. Treating
                    // one as customer input would have the bot answer itself,
                    // forever, at the customer's expense.
                    if (!event.message || event.message.is_echo) continue;

                    messages.push(createInboundMessage({
                        channel: CHANNELS.MESSENGER,
                        channelUserId: event.sender?.id,
                        channelChatId: event.sender?.id,
                        // quick_reply.payload is what the customer picked, which
                        // is more precise than the label they saw.
                        text: event.message.quick_reply?.payload ?? event.message.text ?? '',
                        attachments: messengerAttachments(event.message),
                        messageId: event.message.mid,
                        raw: event,
                        receivedAt: event.timestamp ?? Date.now()
                    }));
                }
            }
            return messages;
        },

        async send(chatId, message) {
            await sendMessage(chatId, message);
        }
    });
}

function messengerAttachments(message) {
    return (message.attachments ?? [])
        .filter((attachment) => ATTACHMENT_KIND_BY_TYPE[attachment.type])
        .map((attachment) => ({
            kind: ATTACHMENT_KIND_BY_TYPE[attachment.type],
            id: attachment.payload?.url ?? attachment.payload?.attachment_id ?? '',
            mimeType: null,
            sizeBytes: null,
            caption: null
        }));
}
