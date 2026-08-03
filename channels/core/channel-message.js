/**
 * channel-message.js
 * ------------------------------------------------------------
 * الصيغة القياسية اللي كل القنوات بتتكلم بيها.
 *
 * This is the whole point of the layer: Telegram, WhatsApp, Messenger and
 * the website all speak different wire formats, and SIE speaks none of
 * them. Every adapter converts its own payload into an InboundMessage on
 * the way in, and renders an OutboundMessage into its own format on the
 * way out. SIE therefore never learns that Telegram exists.
 *
 * ------------------------------------------------------------
 * WHY THE SHAPE IS WHAT IT IS
 *
 * `text` is the only field SIE consumes today. Everything else exists so
 * an adapter can do its job (reply to the right chat, deduplicate a
 * retried webhook, attribute a message to an account) without SIE
 * needing to know about any of it.
 *
 * `attachments` is present from day one and empty for now — requirement 6
 * is "text first, designed so images/files/voice can be added later".
 * Defining the field now means adding voice later is an adapter change
 * plus one engine change, not a reshaping of every adapter at once. The
 * shape is deliberately vendor-neutral: a Telegram file_id and a WhatsApp
 * media id both become `{ kind, id, mimeType, ... }`.
 *
 * Nothing here imports anything. It is a data contract and a couple of
 * constructors, so both sides can depend on it without depending on each
 * other.
 */

/** القنوات المعروفة. القيمة بتتخزن مع المحادثة، فمتتغيرش من غير هجرة بيانات. */
export const CHANNELS = Object.freeze({
    WEBSITE: 'website',
    TELEGRAM: 'telegram',
    WHATSAPP: 'whatsapp',
    MESSENGER: 'messenger',
    API: 'api'
});

/** أنواع المرفقات. النص بس هو المدعوم دلوقتي؛ الباقي محجوز. */
export const ATTACHMENT_KINDS = Object.freeze({
    IMAGE: 'image',
    FILE: 'file',
    VOICE: 'voice',
    VIDEO: 'video'
});

/**
 * @typedef {Object} Attachment
 * @property {string} kind - one of ATTACHMENT_KINDS
 * @property {string} id - the channel's own handle for the media
 * @property {string|null} mimeType
 * @property {number|null} sizeBytes
 * @property {string|null} caption
 *
 * @typedef {Object} InboundMessage
 * @property {string} channel - one of CHANNELS
 * @property {string} channelUserId - who sent it, in the channel's own id space
 * @property {string} channelChatId - where to reply, in the channel's own id space
 * @property {string} text - '' when the message carries no text
 * @property {Attachment[]} attachments
 * @property {string} messageId - the channel's id for this message, for deduplication
 * @property {string|null} locale
 * @property {string|null} displayName
 * @property {Object} raw - the untouched original payload, for logging and future use
 * @property {number} receivedAt - epoch ms
 *
 * @typedef {Object} OutboundMessage
 * @property {string} text
 * @property {Array<{label: string, value: string}>} options - quick replies, if the channel has them
 * @property {string|null} ticketNumber - set when the turn opened a support ticket
 */

/**
 * Builds an InboundMessage, filling defaults so every adapter produces the
 * same shape even when its payload omits a field.
 *
 * Ids are coerced to strings on purpose: Telegram sends numeric chat ids
 * that exceed the safe integer range in some accounts, and comparing a
 * number to a stored string is a bug that only appears for those users.
 *
 * @param {Partial<InboundMessage>} fields
 * @returns {InboundMessage}
 */
export function createInboundMessage(fields) {
    return {
        channel: fields.channel,
        channelUserId: String(fields.channelUserId ?? ''),
        channelChatId: String(fields.channelChatId ?? ''),
        text: typeof fields.text === 'string' ? fields.text : '',
        attachments: Array.isArray(fields.attachments) ? fields.attachments : [],
        messageId: String(fields.messageId ?? ''),
        locale: fields.locale ?? null,
        displayName: fields.displayName ?? null,
        raw: fields.raw ?? {},
        receivedAt: fields.receivedAt ?? Date.now()
    };
}

/**
 * @param {Partial<OutboundMessage>} fields
 * @returns {OutboundMessage}
 */
export function createOutboundMessage(fields) {
    return {
        text: typeof fields.text === 'string' ? fields.text : '',
        options: Array.isArray(fields.options) ? fields.options : [],
        ticketNumber: fields.ticketNumber ?? null
    };
}

/**
 * Whether a message carries anything the engine can currently act on.
 *
 * An image with no caption is a valid message that SIE cannot yet read —
 * the adapter needs to say so rather than sending an empty string into
 * the pipeline and getting a confused reply back.
 *
 * @param {InboundMessage} message
 * @returns {boolean}
 */
export function hasProcessableContent(message) {
    return Boolean(message?.text && message.text.trim().length > 0);
}

/**
 * @param {InboundMessage} message
 * @returns {boolean}
 */
export function hasUnsupportedAttachmentOnly(message) {
    return !hasProcessableContent(message) && (message?.attachments?.length ?? 0) > 0;
}

/**
 * A stable key for "have I already handled this exact message".
 *
 * Every channel in this layer redelivers on non-2xx, and Telegram in
 * particular retries aggressively. Without deduplication a slow turn gets
 * answered two or three times and the customer's quota is spent for each.
 *
 * @param {InboundMessage} message
 * @returns {string}
 */
export function deduplicationKey(message) {
    return `${message.channel}:${message.channelChatId}:${message.messageId}`;
}
