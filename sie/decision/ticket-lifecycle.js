/**
 * ticket-lifecycle.js — Layer 5: what the session knows about its ticket.
 * ------------------------------------------------------------
 * The audit's root cause RC1: the decision state recorded INTENT as FACT.
 * `ticketAlreadyCreated` was set the moment a ticket was decided — or merely
 * proposed — and every later override (the customer declined, the trust
 * boundary withheld it, tickets were switched off, the account already had
 * one, the write failed) left it true. The next ticket decision then said
 * "your ticket is still open" about a ticket that did not exist.
 *
 * The session now records a ticket STATE (G-L5-1):
 *
 *   none         no ticket business in this episode
 *   proposed     the customer was asked "shall I open a ticket?"
 *   created      a ticket row exists — written ONLY into the state that is
 *                committed in the same transaction as the ticket itself
 *                (Action layer, create_ticket effect)
 *   declined     the customer said no
 *   withheld     the trust boundary refused to open one on this turn
 *   unavailable  tickets are switched off in settings
 *   existing     the account already has an open ticket on this subject
 *
 * Only `created` and `existing` mean "a ticket is on file". The legacy
 * boolean `ticketAlreadyCreated` survives as a DERIVED field so Dialogue and
 * stored-session readers keep working; it is never an input.
 */

export const TICKET_STATES = Object.freeze({
    NONE: 'none',
    PROPOSED: 'proposed',
    CREATED: 'created',
    DECLINED: 'declined',
    WITHHELD: 'withheld',
    UNAVAILABLE: 'unavailable',
    EXISTING: 'existing'
});

const VALID = new Set(Object.values(TICKET_STATES));
const ON_FILE = new Set([TICKET_STATES.CREATED, TICKET_STATES.EXISTING]);

/**
 * The transitions a ticket may take. `created` is reachable only from the
 * Action layer's commit (event `commit`), never from a decision.
 */
const TRANSITIONS = Object.freeze({
    propose:     TICKET_STATES.PROPOSED,
    commit:      TICKET_STATES.CREATED,
    decline:     TICKET_STATES.DECLINED,
    withhold:    TICKET_STATES.WITHHELD,
    unavailable: TICKET_STATES.UNAVAILABLE,
    existing:    TICKET_STATES.EXISTING,
    lapse:       TICKET_STATES.NONE
});

/** A ticket on file stays on file: nothing but a new episode clears it. */
const LEAVES_ON_FILE = new Set(['existing', 'commit']);

/** @returns {{state: string, scenarioId: string|null, category: string|null, ref: (number|string|null), at: (string|null)}} */
export function emptyTicket() {
    return { state: TICKET_STATES.NONE, scenarioId: null, category: null, ref: null, at: null };
}

/**
 * Reads a stored ticket record, whatever a previous deployment wrote.
 *
 * A legacy session carries only `ticketAlreadyCreated: true`, which may have
 * been an intent (a proposal, a decline …). It is NOT trusted: it is read as
 * `none` with `legacyClaim`, and the duplicate-ticket check against the
 * account's real tickets settles it.
 *
 * @param {*} stored
 * @param {*} [legacyTicketAlreadyCreated]
 */
export function normalizeTicket(stored, legacyTicketAlreadyCreated = false) {
    if (stored && typeof stored === 'object' && !Array.isArray(stored) && VALID.has(stored.state)) {
        return {
            state: stored.state,
            scenarioId: typeof stored.scenarioId === 'string' ? stored.scenarioId : null,
            category: typeof stored.category === 'string' ? stored.category : null,
            ref: stored.ref ?? null,
            at: typeof stored.at === 'string' ? stored.at : null
        };
    }
    return legacyTicketAlreadyCreated === true ? { ...emptyTicket(), legacyClaim: true } : emptyTicket();
}

/** A ticket really exists for this conversation. */
export function isTicketOnFile(ticket) {
    return ON_FILE.has(ticket?.state);
}

/**
 * The next ticket record for an event.
 * @param {Object} ticket - current (normalized)
 * @param {'propose'|'commit'|'decline'|'withhold'|'unavailable'|'existing'|'lapse'} event
 * @param {Object} [details] - {scenarioId, category, ref, at}
 */
export function transitionTicket(ticket, event, details = {}) {
    const next = TRANSITIONS[event];
    if (!next) throw new Error(`unknown ticket event "${event}"`);
    const current = normalizeTicket(ticket);
    if (isTicketOnFile(current) && !LEAVES_ON_FILE.has(event)) {
        // A real ticket is not un-made by a later proposal, decline or
        // withhold: the row exists. The session keeps saying so.
        return current;
    }
    return {
        state: next,
        scenarioId: details.scenarioId !== undefined ? details.scenarioId : current.scenarioId,
        category: details.category !== undefined ? details.category : current.category,
        ref: details.ref !== undefined ? details.ref : (event === 'commit' || event === 'existing' ? null : current.ref),
        at: details.at !== undefined ? details.at : current.at
    };
}

/** The decision state with its ticket set, and the legacy boolean derived from it. */
export function withTicket(decisionState, ticket) {
    return { ...decisionState, ticket, ticketAlreadyCreated: isTicketOnFile(ticket) };
}
