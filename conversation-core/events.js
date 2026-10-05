/**
 * events.js — أحداث المحادثة.
 *
 * The events are rows in Mad3oom's existing inbox_events, written by 064 in the
 * same transaction as the change they describe. Core names them; it does not
 * publish them anywhere else (no bus, no queue).
 */

/** Canonical event name → inbox_events.kind. */
export const CONVERSATION_EVENTS = Object.freeze({
    ConversationCreated: 'conversation_created',
    MessageReceived: 'message_received',
    HumanTakeover: 'handoff_to_human',
    AgentResumed: 'handoff_to_ai',
    AgentReplied: 'agent_replied',
    HumanReply: 'human_reply',
    ConversationClosed: 'closed'
});

const BY_KIND = new Map(Object.entries(CONVERSATION_EVENTS).map(([name, kind]) => [kind, name]));

/**
 * inbox_events row → canonical event, or null for inbox-only kinds (tags,
 * notes, assignment) that are not conversation events.
 *
 * @param {Object} row
 * @returns {Readonly<Object>|null}
 */
export function eventFromRow(row) {
    const name = BY_KIND.get(row?.kind);
    if (!name) return null;
    return Object.freeze({
        id: row.id,
        type: name,
        conversationId: row.session_id,
        actorId: row.actor_id ?? null,
        payload: Object.freeze({ ...(row.payload || {}) }),
        at: row.created_at
    });
}
