/**
 * ports.js — ما يحتاجه Core من التخزين.
 *
 * Core talks to storage only through this port. The production implementation
 * (store-supabase.js) calls the atomic functions from Mad3oom's 064; tests use
 * an in-memory fake. Core never sees a table, a key or a client constructor.
 *
 * @typedef {Object} IngestRequest
 * @property {string} channel
 * @property {string} userId
 * @property {string} externalThreadId - '' for website
 * @property {string} externalId - the channel's message id (idempotency key)
 * @property {string} text - plain-text rendering of the parts
 * @property {ReadonlyArray<Object>} parts
 * @property {Object} metadata
 * @property {string|null} channelIdentityId
 * @property {number|null} idleAfterMinutes
 *
 * @typedef {Object} CommitRequest
 * @property {string} conversationId
 * @property {number} expectedVersion
 * @property {string} turnKey
 * @property {string} text
 * @property {ReadonlyArray<Object>} parts
 * @property {Object|null} state
 * @property {string|null} agentId
 * @property {boolean} deliveryRequired
 * @property {Object|null} ticket
 * @property {string|null} handoffReason
 *
 * @typedef {Object} ConversationStore
 * @property {(req: IngestRequest) => Promise<Object>} ingest
 * @property {(req: CommitRequest) => Promise<Object>} commitTurn
 * @property {(messageId: string) => Promise<Object>} claimDelivery
 * @property {(messageId: string, state: string, providerMessageId?: string|null, error?: string|null, attempt?: number|null) => Promise<Object>} recordDelivery
 */

const STORE_METHODS = ['ingest', 'commitTurn', 'claimDelivery', 'recordDelivery'];

/**
 * @param {*} store
 * @returns {ConversationStore}
 */
export function assertConversationStore(store) {
    for (const m of STORE_METHODS) {
        if (typeof store?.[m] !== 'function') throw new TypeError(`ConversationStore ناقصه ${m}()`);
    }
    return store;
}
