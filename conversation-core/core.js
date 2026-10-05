/**
 * core.js — Conversation Core.
 *
 * Owns: conversation and customer identity, ingest, idempotency, ordering,
 * ownership, handoff, state version, commitTurn, outbound state and
 * conversation events. Every one of those guarantees is enforced inside the
 * database transaction (064); this layer validates the canonical message,
 * shapes the request, and tells the caller what the database decided.
 *
 * Does not know: SIE, any LLM, MCP, channel implementations, provider APIs,
 * UI. An agent is "whoever calls commitTurn with a version"; a channel is
 * "whoever calls ingest with an external id".
 */

import { CHANNELS, DELIVERY_STATES, MessageValidationError, partsToText, validateParts } from './model.js';
import { assertConversationStore } from './ports.js';

const nonEmpty = (v) => typeof v === 'string' && v.trim() !== '';

function requireField(ok, message) {
    if (!ok) throw new MessageValidationError(message);
}

/**
 * @param {{store: import('./ports.js').ConversationStore}} deps
 */
export function createConversationCore({ store }) {
    assertConversationStore(store);

    return Object.freeze({
        /**
         * A customer message arrives. Exactly one caller per (thread, externalId)
         * ever sees `created: true`; only that caller may start an agent, and
         * only when `shouldRunAgent` is true (the agent owns the conversation).
         */
        async ingest({
            channel, userId, externalThreadId = '', externalId, parts,
            metadata = {}, channelIdentityId = null, idleAfterMinutes = null
        }) {
            requireField(CHANNELS.includes(channel), `قناة غير معروفة: ${channel}`);
            requireField(nonEmpty(userId), 'userId مطلوب');
            requireField(nonEmpty(externalId), 'externalId مطلوب لمنع التكرار');
            requireField(typeof externalThreadId === 'string', 'externalThreadId نص');
            requireField(channel === 'website' ? externalThreadId === '' : nonEmpty(externalThreadId),
                channel === 'website' ? 'محادثة الموقع من غير externalThreadId' : 'externalThreadId مطلوب');
            requireField(metadata !== null && typeof metadata === 'object' && !Array.isArray(metadata) && !('parts' in metadata),
                'metadata كائن (ومن غير parts)');
            requireField(idleAfterMinutes === null || (Number.isInteger(idleAfterMinutes) && idleAfterMinutes > 0),
                'idleAfterMinutes رقم صحيح موجب');
            const valid = validateParts(parts);

            const r = await store.ingest({
                channel, userId, externalThreadId, externalId: externalId.trim(),
                text: partsToText(valid), parts: valid, metadata, channelIdentityId, idleAfterMinutes
            });
            const created = r?.created === true;
            return Object.freeze({
                created,
                duplicate: r?.duplicate === true,
                conversation: r?.conversation ?? null,
                message: r?.message ?? null,
                owner: r?.owner ?? null,
                stateVersion: r?.stateVersion ?? null,
                shouldRunAgent: created && r?.owner === 'agent' && r?.conversation?.status === 'active'
            });
        },

        /**
         * The agent's whole turn, committed atomically or not at all. A
         * rejection (`committed: false`) means nothing was written — no reply,
         * no state, no ticket, no handoff — and the reason says why:
         * version_conflict | human_owner | closed.
         */
        async commitTurn({
            conversationId, expectedVersion, turnKey, parts, state = null, agentId = null,
            deliveryRequired = false, ticket = null, handoffReason = null
        }) {
            requireField(nonEmpty(conversationId), 'conversationId مطلوب');
            requireField(Number.isInteger(expectedVersion) && expectedVersion >= 0, 'expectedVersion رقم صحيح');
            requireField(nonEmpty(turnKey), 'turnKey مطلوب لمنع التكرار');
            requireField(state === null || (typeof state === 'object' && !Array.isArray(state)), 'state كائن');
            requireField(ticket === null || (typeof ticket === 'object' && !Array.isArray(ticket)), 'ticket كائن');
            const valid = validateParts(parts);
            const text = partsToText(valid);
            requireField(text.trim() !== '', 'الرد مالوش نص يتعرض');

            const r = await store.commitTurn({
                conversationId, expectedVersion, turnKey: turnKey.trim(), text, parts: valid, state,
                agentId, deliveryRequired: deliveryRequired === true, ticket, handoffReason
            });
            return Object.freeze({
                committed: r?.committed === true,
                duplicate: r?.duplicate === true,
                reason: r?.committed === true ? null : (r?.reason ?? 'unknown'),
                messageId: r?.messageId ?? null,
                seq: r?.seq ?? null,
                stateVersion: r?.stateVersion ?? null,
                owner: r?.owner ?? null,
                ticketNumber: r?.ticketNumber ?? null,
                handoff: r?.handoff === true,
                deliveryState: r?.deliveryState ?? null
            });
        },

        /** Only one sender per outbound message: `claimed: false` means do not send. */
        async claimDelivery(messageId) {
            requireField(nonEmpty(messageId), 'messageId مطلوب');
            const r = await store.claimDelivery(messageId);
            return Object.freeze({ ...r, claimed: r?.claimed === true });
        },

        async recordDelivery(messageId, deliveryState, { providerMessageId = null, error = null } = {}) {
            requireField(nonEmpty(messageId), 'messageId مطلوب');
            requireField(DELIVERY_STATES.includes(deliveryState) && !['pending', 'sending'].includes(deliveryState),
                `حالة إرسال مش مسموح تتسجل: ${deliveryState}`);
            const r = await store.recordDelivery(messageId, deliveryState, providerMessageId, error);
            return Object.freeze({ ...r, updated: r?.updated === true });
        }
    });
}
