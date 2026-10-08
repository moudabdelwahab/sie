/**
 * turn-executor.js — Layer 8: execute exactly what Layer 5 decided.
 * ------------------------------------------------------------
 * Layer 5 returns a turn's effects in three phases:
 *
 *   pre     queue_review, write_facts, forget_facts — their outcome decides
 *           the words (a decline promises a follow-up only if the review row
 *           exists), so they run before Dialogue renders
 *   commit  ONE turn write: persist_reply, or create_ticket — the ticket,
 *           the bot's message and the session state in one transaction
 *           (executeDecision → one RPC)
 *   post    request_handoff — after the reply is persisted, never before:
 *           the database refuses a bot reply once a human owns the chat
 *
 * and this module executes them, recording each one with its REAL result.
 * It adds nothing and substitutes nothing (G-L8-5).
 *
 * It also owns the one field every write carries: `sie.lastTurnAt`, stamped
 * here on every route (G-L8-2). Before WP4 only the diagnostic route stamped
 * it, so a ticket question asked on the escalation route never expired.
 */
import { ACTIONS } from '../decision/decision-types.js';
import { executeDecision } from './action-layer.js';

/**
 * The bot_state to write: the session's other keys untouched, SIE's own
 * state as Layer 5 decided it, stamped.
 */
export function stampState(botState, nextSie, nowIso, shadowState = null) {
    // The shadow pipeline's own state (L9's measurement) is threaded apart
    // from the live state, so a divergence in it cannot reach the customer.
    return { ...(botState || {}), sie: { ...nextSie, ...(shadowState ? { shadowState } : {}), lastTurnAt: nowIso } };
}

/**
 * The Action port, observed: each turn write is recorded as an executed
 * effect with its real result.
 */
function observedPort(port, effects) {
    const observe = (type, fn) => async (args) => {
        try {
            const result = await fn(args);
            effects.push({
                type,
                ok: result?.success === true,
                ...(type === 'create_ticket' ? { ticketNumber: result?.ticketNumber ?? null } : {}),
                ...(result?.error ? { error: String(result.error) } : {})
            });
            return result;
        } catch (err) {
            effects.push({ type, ok: false, error: String(err?.message || err) });
            throw err;
        }
    };
    return {
        ...port,
        persistBotTurn: observe('persist_reply', port.persistBotTurn),
        createTicketWithMessageAndSessionUpdate: observe('create_ticket', port.createTicketWithMessageAndSessionUpdate)
    };
}

/**
 * Pre-commit effects.
 * @param {Array} pre - Layer 5's effects.pre
 * @param {Object} effectsPort - {queueReview, writeFacts, forgetFacts}
 * @param {Array} effects - the turn's effect record (appended to)
 * @returns {Promise<{queued?: boolean, saved?: number, forgot?: boolean}>}
 */
export async function runPreEffects(pre, effectsPort, effects) {
    const outcomes = {};
    for (const effect of pre || []) {
        if (effect.type === 'queue_review') {
            const r = await effectsPort.queueReview({ turn: effect.turn, scenarioId: effect.scenarioId, note: effect.note });
            outcomes.queued = r?.queued === true;
            effects.push({ type: 'queue_review', ok: outcomes.queued });
        } else if (effect.type === 'write_facts') {
            const r = await effectsPort.writeFacts(effect.facts);
            outcomes.saved = r?.saved || 0;
            effects.push({ type: 'write_facts', ok: outcomes.saved > 0, count: outcomes.saved });
        } else if (effect.type === 'forget_facts') {
            const r = await effectsPort.forgetFacts();
            outcomes.forgot = r?.success !== false;
            effects.push({ type: 'forget_facts', ok: outcomes.forgot });
        } else {
            throw new Error(`unknown pre-commit effect "${effect.type}"`);
        }
    }
    return outcomes;
}

/**
 * The turn's one commit.
 *
 * `create_ticket` writes the ticket and the state that says `created` in one
 * transaction; `persist_reply` never creates a ticket, whatever the decision
 * carries (the draft is stripped), so a decision can never open a ticket the
 * turn did not decide to commit.
 *
 * @returns {Promise<{actionResult: Object, botState: Object}>}
 */
export async function commitTurn({ turnDecision, rendered, sessionId, botState, port, nowIso, effects, shadowState = null }) {
    const nextBotState = stampState(botState, turnDecision.nextSie, nowIso, shadowState);
    const wantsTicket = turnDecision.effects.commit.type === 'create_ticket';
    const decision = wantsTicket
        ? turnDecision.commitDecision
        : { ...turnDecision.commitDecision, ticketDraft: null, action: turnDecision.commitDecision.action === ACTIONS.CREATE_TICKET || turnDecision.commitDecision.action === ACTIONS.ESCALATE_TO_HUMAN ? ACTIONS.WAIT_FOR_USER : turnDecision.commitDecision.action };
    if (wantsTicket && !decision?.ticketDraft) throw new Error('create_ticket without a ticket draft');
    const actionResult = await executeDecision({
        decision,
        rendered: { text: rendered.text, options: rendered.options },
        sessionId,
        nextBotState,
        port: observedPort(port, effects)
    });
    // The ticket number exists only after the commit; it is recorded on the
    // returned state and persisted with the next turn's write.
    const ticketNumber = actionResult?.ticketNumber ?? null;
    const sie = nextBotState.sie;
    const withRef = wantsTicket && actionResult?.success && sie.decisionState?.ticket
        ? { ...nextBotState, sie: { ...sie, decisionState: { ...sie.decisionState, ticket: { ...sie.decisionState.ticket, ref: ticketNumber } } } }
        : nextBotState;
    return { actionResult, botState: withRef };
}

/**
 * Post-commit effects.
 * @returns {Promise<{handedOff: boolean}>}
 */
export async function runPostEffects(post, effectsPort, effects) {
    let handedOff = false;
    for (const effect of post || []) {
        if (effect.type !== 'request_handoff') throw new Error(`unknown post-commit effect "${effect.type}"`);
        const r = await effectsPort.requestHandoff(effect.reason);
        handedOff = r?.handedOff === true;
        effects.push({ type: 'request_handoff', ok: handedOff });
    }
    return { handedOff };
}
