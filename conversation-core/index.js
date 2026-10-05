/**
 * Conversation Core — public surface.
 *
 * Boundaries are enforced by tests/architecture.test.mjs: nothing here
 * imports SIE, an LLM, MCP, a channel implementation, or a database client.
 */

export { createConversationCore } from './core.js';
export { createSupabaseConversationStore, ConversationStoreError } from './store-supabase.js';
export { assertConversationStore } from './ports.js';
export {
    AUTHORS, CHANNELS, DELIVERY_STATES, PART_TYPES, MessageValidationError,
    validatePart, validateParts, partsToText, messageFromRow
} from './model.js';
export { CONVERSATION_EVENTS, eventFromRow } from './events.js';
export { CORE_FLAG_KEYS, readCoreFlags, isChannelOnCore } from './flags.js';
