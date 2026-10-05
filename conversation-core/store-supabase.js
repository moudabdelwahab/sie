/**
 * store-supabase.js — ConversationStore فوق دوال 064.
 *
 * The client is injected. This file never builds one and never reads a key:
 * which credentials the caller holds is the caller's decision (an Edge
 * function with its own server client). The conv_* functions are granted to
 * service_role only, so a browser client is refused by the database.
 */

export class ConversationStoreError extends Error {
    constructor(operation, cause) {
        super(`${operation}: ${cause?.message || cause}`);
        this.name = 'ConversationStoreError';
        this.operation = operation;
        this.code = cause?.code ?? null;
    }
}

async function call(client, fn, args) {
    const { data, error } = await client.rpc(fn, args);
    if (error) throw new ConversationStoreError(fn, error);
    return data;
}

/**
 * @param {{client: {rpc: Function}}} params
 * @returns {import('./ports.js').ConversationStore}
 */
export function createSupabaseConversationStore({ client }) {
    if (typeof client?.rpc !== 'function') throw new TypeError('محتاج client فيه rpc()');
    return {
        ingest: (r) => call(client, 'conv_ingest_message', {
            p_channel: r.channel,
            p_user_id: r.userId,
            p_external_thread_id: r.externalThreadId,
            p_external_id: r.externalId,
            p_text: r.text,
            p_parts: r.parts,
            p_metadata: r.metadata,
            p_channel_identity_id: r.channelIdentityId,
            p_idle_after: r.idleAfterMinutes == null ? null : `${r.idleAfterMinutes} minutes`
        }),
        commitTurn: (r) => call(client, 'conv_commit_turn', {
            p_conversation_id: r.conversationId,
            p_expected_version: r.expectedVersion,
            p_turn_key: r.turnKey,
            p_reply_text: r.text,
            p_reply_parts: r.parts,
            p_state: r.state,
            p_agent_id: r.agentId,
            p_delivery_required: r.deliveryRequired,
            p_ticket: r.ticket,
            p_handoff_reason: r.handoffReason
        }),
        claimDelivery: (messageId) => call(client, 'conv_claim_delivery', { p_message_id: messageId }),
        recordDelivery: (messageId, state, providerMessageId = null, error = null, attempt = null) =>
            call(client, 'conv_record_delivery', {
                p_message_id: messageId, p_state: state,
                p_provider_message_id: providerMessageId, p_error: error, p_attempt: attempt
            })
    };
}
