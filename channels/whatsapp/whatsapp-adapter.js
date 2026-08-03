/**
 * whatsapp-adapter.js
 * ------------------------------------------------------------
 * قناة واتساب (WhatsApp Cloud API).
 *
 * ------------------------------------------------------------
 * STATUS: the shape is real, the transport is not wired.
 *
 * Mad3oom already runs a `whatsapp-webhook` Edge Function against the
 * Cloud API, in the platform repo. This adapter exists so WhatsApp can
 * move onto the same contract as Telegram rather than keeping a second,
 * divergent idea of what a turn is — but the actual migration is a
 * platform-repo change and is deliberately NOT done here, because
 * silently rerouting live WhatsApp traffic through untested code would be
 * reckless.
 *
 * What IS real here: the verification method, the payload walk, and the
 * outbound shape, all matching Meta's documented format. Wiring it needs
 * the phone-number id and access token from the existing deployment.
 *
 * ------------------------------------------------------------
 * WHY SIGNATURE VERIFICATION, NOT A SHARED SECRET
 *
 * Meta signs the raw request body with the app secret and sends
 * X-Hub-Signature-256. That is stronger than Telegram's echoed token —
 * it authenticates the body, not just the caller — but it requires the
 * RAW bytes: verifying a re-serialised JSON object fails, because key
 * order and whitespace change. Hence `rawBody` on the request.
 */
import { CHANNELS, ATTACHMENT_KINDS, createInboundMessage } from '../core/channel-message.js';
import { defineAdapter } from '../core/channel-adapter.js';
import { readHeader } from '../core/request-verify.js';

/**
 * @param {Object} params
 * @param {(rawBody: string, signature: string) => Promise<boolean>|boolean} params.verifySignature
 * @param {(chatId: string, message: Object) => Promise<void>} params.sendMessage
 * @param {Object} [params.logger]
 * @returns {import('../core/channel-adapter.js').ChannelAdapter}
 */
export function createWhatsAppAdapter({ verifySignature, sendMessage, logger = null }) {
    return defineAdapter({
        name: CHANNELS.WHATSAPP,

        verify(request) {
            const signature = readHeader(request?.headers, 'x-hub-signature-256');
            if (!signature) return { ok: false, reason: 'missing_signature' };
            if (typeof request.rawBody !== 'string') {
                // Failing closed rather than verifying a re-serialised body,
                // which would pass for forged payloads that happen to
                // round-trip identically.
                logger?.error('the raw body is required to verify the signature');
                return { ok: false, reason: 'raw_body_unavailable' };
            }
            const valid = verifySignature(request.rawBody, signature);
            return valid ? { ok: true } : { ok: false, reason: 'signature_mismatch' };
        },

        /**
         * Meta batches: entry[] -> changes[] -> value.messages[]. A single
         * webhook call can therefore carry several messages from several
         * conversations, which is exactly why the contract returns an array.
         */
        parse(payload) {
            const messages = [];
            for (const entry of payload?.entry ?? []) {
                for (const change of entry.changes ?? []) {
                    const value = change.value ?? {};
                    const contacts = value.contacts ?? [];
                    for (const message of value.messages ?? []) {
                        const contact = contacts.find((c) => c.wa_id === message.from);
                        messages.push(createInboundMessage({
                            channel: CHANNELS.WHATSAPP,
                            channelUserId: message.from,
                            channelChatId: message.from,
                            text: message.text?.body ?? message.button?.text ?? '',
                            attachments: whatsappAttachments(message),
                            messageId: message.id,
                            displayName: contact?.profile?.name ?? null,
                            raw: message,
                            receivedAt: message.timestamp ? Number(message.timestamp) * 1000 : Date.now()
                        }));
                    }
                }
            }
            return messages;
        },

        async send(chatId, message) {
            await sendMessage(chatId, message);
        }
    });
}

function whatsappAttachments(message) {
    const kinds = {
        image: ATTACHMENT_KINDS.IMAGE,
        document: ATTACHMENT_KINDS.FILE,
        audio: ATTACHMENT_KINDS.VOICE,
        voice: ATTACHMENT_KINDS.VOICE,
        video: ATTACHMENT_KINDS.VIDEO
    };

    const attachments = [];
    for (const [field, kind] of Object.entries(kinds)) {
        const media = message[field];
        if (!media) continue;
        attachments.push({
            kind,
            id: media.id,
            mimeType: media.mime_type ?? null,
            sizeBytes: media.file_size ?? null,
            caption: media.caption ?? null
        });
    }
    return attachments;
}
