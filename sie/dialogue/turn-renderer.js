/**
 * turn-renderer.js — Layer 6: the words for whatever Layer 5 decided.
 * ------------------------------------------------------------
 * Until WP4 the conversational routes' replies were string constants in
 * sie-chat-bridge.js, chosen by the bridge. Layer 5 now names the reply
 * (`turnDecision.reply.template`) and this module words it, from the
 * templates in templates/conversational.js and, for engine decisions,
 * renderDecision(). Nothing here decides anything.
 *
 * Some words depend on what an effect actually did — a decline promises a
 * follow-up only if the review row was written, a memory reply quotes only
 * the facts actually stored — so this runs AFTER the Action layer's
 * pre-commit effects, with their outcomes.
 */
import { renderDecision } from './dialogue-renderer.js';
import {
    SMALL_TALK_REPLIES, MEMORY_REPLIES, acknowledgementFor, TICKET_CONFIRM_TEXT, TICKET_CONFIRM_OPTIONS,
    REVIEW_QUEUED_TEXT, REVIEW_QUEUE_FAILED_TEXT, ESCALATION_REPLY_TEXT, CONVERSATION_CLOSED_TEXT,
    RESOLVED_CONTINUE_TEXT, TICKET_DISABLED_TEXT, TICKET_EXISTING_TEXT, TICKET_WITHHELD_TEXT, greetingPersonalisation
} from './templates/conversational.js';

/**
 * Presentation choices from settings: whether to name the likely cause, and
 * whether to list runners-up. Phrasing questions, so they live here.
 */
export function presentationPolicy(settings = {}) {
    return {
        explainRootCause: settings.explain_root_cause !== false,
        suggestAlternatives: Boolean(settings.suggest_multiple_solutions),
        maxAlternatives: settings.max_suggested_solutions
    };
}

/**
 * «يقترح أكتر من حل»: the candidates after the first, real candidates only
 * (at or above activation). Moved from the bridge.
 */
export function collectAlternatives(ranking, max, activationThreshold) {
    const limit = typeof max === 'number' && max > 0 ? max : 2;
    const rest = (ranking?.ranked || [])
        .slice(1)
        .filter((entry) => entry.hypothesis.confidence >= activationThreshold && entry.scenario)
        .slice(0, limit);
    if (rest.length === 0) return null;
    return rest.map((entry) => ({
        scenarioId: entry.hypothesis.scenarioId,
        label: entry.scenario.label || null,
        confidence: entry.hypothesis.confidence
    }));
}

/**
 * @param {Object} turnDecision - Layer 5's finalizeTurn()
 * @param {Object} params
 * @param {'ar'|'en'} params.language
 * @param {Object} [params.outcomes] - pre-commit effect outcomes: {queued, saved}
 * @param {Object} [params.presentation] - presentationPolicy()
 * @param {Object|null} [params.ranking] - for alternatives
 * @param {number} [params.activationThreshold]
 * @returns {{text: string, options: Array, intendedText: string|null}}
 */
export function renderTurn(turnDecision, { language = 'ar', outcomes = {}, presentation = {}, ranking = null, activationThreshold = 0 } = {}) {
    const lang = language === 'en' ? 'en' : 'ar';
    const reply = turnDecision.reply || {};
    const prefix = [
        reply.resolvedAck ? RESOLVED_CONTINUE_TEXT[lang] : null,
        reply.acknowledge ? acknowledgementFor(reply.acknowledge, lang) : null,
        reply.escalation ? ESCALATION_REPLY_TEXT[reply.escalation]?.[lang] : null
    ].filter(Boolean).map((t) => `${t}\n\n`).join('');

    const forRender = (decision) => ({
        ...decision,
        explainRootCause: presentation.explainRootCause !== false,
        alternatives: presentation.suggestAlternatives ? collectAlternatives(ranking, presentation.maxAlternatives, activationThreshold) : null
    });
    const decisionText = (decision) => (decision ? prefix + renderDecision(forRender(decision), lang).text : null);
    const done = (text, options = []) => ({
        text,
        options,
        intendedText: turnDecision.decision ? decisionText(turnDecision.decision) : null
    });

    switch (reply.template) {
        case 'decision': {
            const r = renderDecision(forRender(reply.decision), lang);
            return { text: prefix + r.text, options: r.options, intendedText: prefix + r.text };
        }
        case 'ticket_question':
            return done(prefix + TICKET_CONFIRM_TEXT[lang], TICKET_CONFIRM_OPTIONS[lang]);
        case 'ticket_declined':
            return done(outcomes.queued ? REVIEW_QUEUED_TEXT[lang] : REVIEW_QUEUE_FAILED_TEXT[lang]);
        case 'ticket_withheld':
            return done(prefix + TICKET_WITHHELD_TEXT[lang]);
        case 'ticket_existing':
            return done(prefix + TICKET_EXISTING_TEXT[lang](reply.ticketNumber));
        case 'tickets_disabled':
            return done(prefix + TICKET_DISABLED_TEXT[lang]);
        case 'conversation_closed':
            return done(CONVERSATION_CLOSED_TEXT[lang]);
        case 'small_talk':
            return done(greetingPersonalisation({ name: reply.name, lastIssue: reply.lastIssue }, lang) + SMALL_TALK_REPLIES[reply.type][lang]);
        case 'memory_forgotten':
            return done(MEMORY_REPLIES.forgotten);
        case 'memory_recalled':
            return done(MEMORY_REPLIES.recalled(reply.facts || []));
        case 'memory_saved':
            // A fact the store did not take is never reported as remembered.
            return done(outcomes.saved > 0 ? MEMORY_REPLIES.saved(reply.facts) : MEMORY_REPLIES.nothingToSave);
        default:
            return done(renderDecision(null, lang).text);
    }
}
