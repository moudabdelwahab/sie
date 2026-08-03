/**
 * telegram-normalize.js
 * ------------------------------------------------------------
 * تحويل رسالة تيليجرام للصيغة القياسية.
 *
 * This is the only file that knows what a Telegram Update looks like on
 * the way in. Everything downstream sees an InboundMessage and could not
 * tell Telegram from WhatsApp.
 *
 * Reference: https://core.telegram.org/bots/api#update
 */
import { CHANNELS, ATTACHMENT_KINDS, createInboundMessage } from '../core/channel-message.js';

/**
 * The Update fields that carry a user message.
 *
 * `edited_message` is included because a customer correcting a typo
 * expects the correction to be read, and Telegram delivers that as an
 * edit rather than a new message. Channel posts and inline queries are
 * deliberately excluded: they are not one-to-one support conversations.
 */
const MESSAGE_FIELDS = ['message', 'edited_message'];

/**
 * Turns one Telegram Update into zero or one standard messages.
 *
 * Returns an array because the adapter contract is array-shaped for
 * channels that batch. Telegram sends exactly one update per request, so
 * this is always length 0 or 1 — but keeping the shape means
 * handleInbound() has one code path for every channel.
 *
 * @param {Object} update - a Telegram Update
 * @returns {import('../core/channel-message.js').InboundMessage[]}
 */
export function normalizeUpdate(update) {
    if (!update || typeof update !== 'object') return [];

    const source = MESSAGE_FIELDS.map((field) => update[field]).find(Boolean);
    if (!source) return [];

    const chat = source.chat ?? {};
    const from = source.from ?? {};

    // Bots talking to bots is a loop waiting to happen, and Telegram tells
    // us plainly, so drop it here rather than reasoning about it later.
    if (from.is_bot) return [];

    // Only private chats. In a group the bot sees every message, and
    // answering all of them would be both wrong and expensive — group
    // support would need its own mention-handling design.
    if (chat.type && chat.type !== 'private') return [];

    return [createInboundMessage({
        channel: CHANNELS.TELEGRAM,
        channelUserId: from.id,
        channelChatId: chat.id,
        // `caption` is where the text lives when a photo or document carries
        // one, so a captioned image is a readable message rather than an
        // empty one with an attachment.
        text: source.text ?? source.caption ?? '',
        attachments: extractAttachments(source),
        messageId: source.message_id,
        locale: from.language_code ?? null,
        displayName: buildDisplayName(from),
        raw: update,
        receivedAt: source.date ? source.date * 1000 : Date.now()
    })];
}

/**
 * Media on a Telegram message, in the vendor-neutral shape.
 *
 * Nothing downstream reads these yet — SIE is text-only today. They are
 * extracted anyway so that adding image or voice support later is a
 * change to the engine and this function's consumers, not a re-parse of
 * the Telegram payload from scratch. Requirement 6, in code rather than
 * in a comment promising it later.
 *
 * @param {Object} message
 * @returns {import('../core/channel-message.js').Attachment[]}
 */
export function extractAttachments(message) {
    const attachments = [];

    // Telegram sends photos as an array of sizes, smallest first. The last
    // is the largest, which is the one worth keeping a handle to.
    if (Array.isArray(message.photo) && message.photo.length > 0) {
        const largest = message.photo[message.photo.length - 1];
        attachments.push({
            kind: ATTACHMENT_KINDS.IMAGE,
            id: largest.file_id,
            mimeType: null,
            sizeBytes: largest.file_size ?? null,
            caption: message.caption ?? null
        });
    }

    if (message.document) {
        attachments.push({
            kind: ATTACHMENT_KINDS.FILE,
            id: message.document.file_id,
            mimeType: message.document.mime_type ?? null,
            sizeBytes: message.document.file_size ?? null,
            caption: message.caption ?? null
        });
    }

    // `voice` is a voice note; `audio` is a music file. Both are audio to
    // a future transcription step, so both map to VOICE.
    for (const field of ['voice', 'audio']) {
        if (message[field]) {
            attachments.push({
                kind: ATTACHMENT_KINDS.VOICE,
                id: message[field].file_id,
                mimeType: message[field].mime_type ?? null,
                sizeBytes: message[field].file_size ?? null,
                caption: message.caption ?? null
            });
        }
    }

    if (message.video || message.video_note) {
        const video = message.video ?? message.video_note;
        attachments.push({
            kind: ATTACHMENT_KINDS.VIDEO,
            id: video.file_id,
            mimeType: video.mime_type ?? null,
            sizeBytes: video.file_size ?? null,
            caption: message.caption ?? null
        });
    }

    return attachments;
}

function buildDisplayName(from) {
    const name = [from.first_name, from.last_name].filter(Boolean).join(' ').trim();
    return name || from.username || null;
}
