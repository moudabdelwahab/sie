/**
 * model.js — الرسالة القياسية في Conversation Core.
 *
 * Message { id, conversationId, seq, author, source, content: { parts }, metadata, delivery }
 * Part    = text | media | location | choices | choice_reply | template | event
 *
 * WHY A WHITELIST, NOT A BLACKLIST
 *
 * Core must not carry provider structures (a WhatsApp `interactive.button_reply`,
 * a Telegram `callback_query`, a Graph API envelope). Naming them here to reject
 * them would put vendor vocabulary inside Core. Instead every part type lists the
 * keys it may have, and anything else is refused — so a provider shape fails the
 * same way a typo does, and the adapter has to translate it first.
 */

export const AUTHORS = Object.freeze(['customer', 'agent', 'human', 'system']);

/** Where a message entered. Channels are the ones 064 accepts on chat_sessions. */
export const CHANNELS = Object.freeze(['website', 'telegram']);

export const DELIVERY_STATES = Object.freeze(['pending', 'sending', 'sent', 'delivered', 'read', 'failed']);

/**
 * Optional keys carry their type: an optional field is still part of the
 * canonical shape, so a provider object in `caption` is refused the same way
 * an unknown key is.
 */
const PART_SHAPES = Object.freeze({
    text: { required: ['text'], optional: {} },
    media: { required: ['kind', 'ref'], optional: { mime: 'string', name: 'string', size: 'number', caption: 'string', durationMs: 'number' } },
    location: { required: ['latitude', 'longitude'], optional: { name: 'string', address: 'string' } },
    choices: { required: ['options'], optional: { prompt: 'string' } },
    choice_reply: { required: ['value'], optional: { label: 'string' } },
    template: { required: ['name'], optional: { language: 'string', params: 'array' } },
    event: { required: ['name'], optional: { data: 'object' } }
});

const OPTIONAL_TYPE = {
    string: (v) => typeof v === 'string',
    number: (v) => Number.isFinite(v) && v >= 0,
    array: (v) => Array.isArray(v),
    object: (v) => isPlainObject(v)
};

export const PART_TYPES = Object.freeze(Object.keys(PART_SHAPES));

const MEDIA_KINDS = new Set(['image', 'audio', 'video', 'file', 'sticker']);
const MAX_TEXT = 10000;

export class MessageValidationError extends Error {
    constructor(message) {
        super(message);
        this.name = 'MessageValidationError';
    }
}

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)
    && Object.getPrototypeOf(v) === Object.prototype;

/**
 * Validates one part and returns a frozen copy. Throws MessageValidationError.
 *
 * @param {Object} part
 * @returns {Readonly<Object>}
 */
export function validatePart(part) {
    if (!isPlainObject(part)) throw new MessageValidationError('part لازم يكون كائن');
    const shape = PART_SHAPES[part.type];
    if (!shape) throw new MessageValidationError(`نوع part غير معروف: ${String(part.type)}`);
    const allowed = new Set(['type', ...shape.required, ...Object.keys(shape.optional)]);
    for (const key of Object.keys(part)) {
        if (!allowed.has(key)) throw new MessageValidationError(`مفتاح مش قياسي في part ${part.type}: ${key}`);
        const type = shape.optional[key];
        if (type && part[key] !== undefined && !OPTIONAL_TYPE[type](part[key])) {
            throw new MessageValidationError(`part ${part.type}.${key} لازم يكون ${type}`);
        }
    }
    for (const key of shape.required) {
        if (part[key] === undefined || part[key] === null) {
            throw new MessageValidationError(`part ${part.type} ناقصه ${key}`);
        }
    }
    switch (part.type) {
        case 'text':
            if (typeof part.text !== 'string' || part.text.length > MAX_TEXT) {
                throw new MessageValidationError('text لازم يكون نص (أقصى طول 10000)');
            }
            break;
        case 'media':
            if (!MEDIA_KINDS.has(part.kind)) throw new MessageValidationError(`نوع وسائط غير معروف: ${part.kind}`);
            if (typeof part.ref !== 'string' || part.ref === '') throw new MessageValidationError('media.ref لازم يكون نص');
            break;
        case 'location':
            if (!Number.isFinite(part.latitude) || !Number.isFinite(part.longitude)
                || Math.abs(part.latitude) > 90 || Math.abs(part.longitude) > 180) {
                throw new MessageValidationError('إحداثيات غير صالحة');
            }
            break;
        case 'choices':
            if (!Array.isArray(part.options) || part.options.length === 0) {
                throw new MessageValidationError('choices.options لازم تكون مصفوفة فيها اختيار');
            }
            for (const o of part.options) {
                if (!isPlainObject(o) || typeof o.value !== 'string' || typeof o.label !== 'string'
                    || Object.keys(o).some((k) => k !== 'value' && k !== 'label')) {
                    throw new MessageValidationError('كل اختيار {value, label} بس');
                }
            }
            break;
        case 'choice_reply':
            if (typeof part.value !== 'string') throw new MessageValidationError('choice_reply.value لازم يكون نص');
            break;
        case 'template':
            if (typeof part.name !== 'string' || part.name === '') throw new MessageValidationError('template.name لازم يكون نص');
            if (part.params !== undefined && !part.params.every((x) => typeof x === 'string' || Number.isFinite(x))) {
                throw new MessageValidationError('template.params نصوص أو أرقام بس');
            }
            break;
        case 'event':
            if (typeof part.name !== 'string' || part.name === '') throw new MessageValidationError('event.name لازم يكون نص');
            break;
    }
    return Object.freeze(structuredClone(part));
}

/**
 * @param {Array<Object>} parts
 * @returns {ReadonlyArray<Object>}
 */
export function validateParts(parts) {
    if (!Array.isArray(parts) || parts.length === 0) throw new MessageValidationError('الرسالة لازم فيها part واحد على الأقل');
    return Object.freeze(parts.map(validatePart));
}

/**
 * The plain-text rendering stored in chat_messages.message_text, so every
 * existing reader (inbox, widget, Android) keeps showing the message.
 *
 * @param {ReadonlyArray<Object>} parts
 * @returns {string}
 */
export function partsToText(parts) {
    return parts.map((p) => {
        switch (p.type) {
            case 'text': return p.text;
            case 'media': return p.caption ?? '';
            case 'location': return p.name ?? p.address ?? `${p.latitude},${p.longitude}`;
            case 'choices': return p.prompt ?? '';
            case 'choice_reply': return p.label ?? p.value;
            default: return '';
        }
    }).filter((t) => t !== '').join('\n');
}

/**
 * chat_messages row → canonical Message. The reverse of what 064 writes.
 *
 * @param {Object} row
 * @returns {Readonly<Object>}
 */
export function messageFromRow(row) {
    const author = row.is_admin_reply ? 'human' : row.is_bot_reply ? 'agent' : 'customer';
    const stored = isPlainObject(row.metadata) ? row.metadata : {};
    const { parts: storedParts, ...metadata } = stored;
    const parts = Array.isArray(storedParts) && storedParts.length > 0
        ? storedParts
        : [{ type: 'text', text: row.message_text ?? '' }];
    return Object.freeze({
        id: row.id,
        conversationId: row.session_id,
        seq: row.seq ?? null,
        author,
        source: row.channel ?? 'legacy',
        content: Object.freeze({ parts: Object.freeze(parts.map((p) => Object.freeze({ ...p }))) }),
        metadata: Object.freeze(metadata),
        delivery: row.delivery_state
            ? Object.freeze({
                state: row.delivery_state,
                attempts: row.delivery_attempts ?? 0,
                providerMessageId: row.provider_message_id ?? null,
                error: row.delivery_error ?? null
            })
            : null,
        createdAt: row.created_at ?? null
    });
}
