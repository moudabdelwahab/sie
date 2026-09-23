/**
 * pipeline.js
 * ------------------------------------------------------------
 * مسار SIE كاملًا في دالة واحدة — one turn, both variants, one code path.
 *
 * ------------------------------------------------------------
 * WHY ONE FUNCTION WITH A CONFIG, NOT TWO PIPELINES
 *
 * The point of this module is comparison, and a comparison between two
 * separately-written pipelines measures the two implementations as much as it
 * measures the change. So there is exactly one path here, and "current" and
 * "vNext" are **configurations of it**, not branches through it.
 *
 * That has a second payoff which turned out to matter more: because every
 * component is an independent flag, a difference between the variants can be
 * ATTRIBUTED. When vNext and current disagree, the comparator re-runs with
 * each component alone and learns which one caused it. An aggregate
 * "vNext differs on 3.2% of turns" is not actionable; "retrieval causes all
 * of them, and here is the turn" is.
 *
 * ------------------------------------------------------------
 * THE STAGES
 *
 *   Language        normalize, with a hard input cap
 *   Interpretation  what KIND of message is this          ← new stage
 *   Trust (CP1)     classify the turn, once
 *   Evidence        extract, then CP2 bounds it
 *   Scope           which scenarios this turn will score   ← new stage
 *   Diagnostics     confidence per scoped scenario
 *   Ranking         order them
 *   Decision        R0–R9
 *   Trust (CP3b)    authorize effects that leave the engine
 *   State           persist, full or sparse
 *
 * Two stages are new relative to the nine, and both were extracted rather
 * than invented — the work was already happening, unnamed, in
 * `sie-chat-bridge.js`. Naming them makes them testable and traceable, which
 * is most of the value.
 *
 * Dialogue and Action are deliberately NOT here. They perform effects, and a
 * comparator that performs effects is not a comparator. The pipeline stops at
 * the decision; the bridge keeps everything downstream of it.
 */
import { normalize } from '../language/normalizer.js';
import { extractTextEvidence } from '../diagnostics/evidence-extractor.js';
import { mergeEvidence, getAllTokenPresences } from '../diagnostics/evidence-accumulator.js';
import { updateHypotheses } from '../diagnostics/hypothesis-tracker.js';
import { rankHypotheses, activationThresholdForLevel } from '../ranking/ranking-engine.js';
import { decide } from '../decision/decision-engine.js';
import { openTurn, admitEvidence, admitAction, trustTrace } from '../trust/trust-boundary.js';
import { migrateState, updateSparseState, expandHypotheses, isSparseState } from '../diagnostics/sparse-state.js';
import { interpretTurn, interpretationTrace, TURN_KINDS } from './interpretation.js';
import { scopeCandidates } from './candidate-scope.js';
import { evidenceFromQuestionAnswer } from '../diagnostics/question-answer.js';

export { TURN_KINDS };

/**
 * The variants. `current` must reproduce today's production behaviour
 * exactly; every test that compares them depends on that being true.
 *
 * The isolation variants exist for attribution and are not proposals.
 */
export const VARIANTS = Object.freeze({
    current:        { retrieval: false, sparseState: false, trust: 'off' },
    vnext:          { retrieval: true,  sparseState: true,  trust: 'enforce' },
    // Attribution: one component at a time, everything else as today.
    retrieval_only: { retrieval: true,  sparseState: false, trust: 'off' },
    sparse_only:    { retrieval: false, sparseState: true,  trust: 'off' },
    trust_only:     { retrieval: false, sparseState: false, trust: 'enforce' },
    trust_observe:  { retrieval: false, sparseState: false, trust: 'observe' }
});

function resolveVariant(variant) {
    if (typeof variant === 'string') {
        const found = VARIANTS[variant];
        if (!found) throw new Error(`unknown pipeline variant: ${variant}`);
        return { name: variant, ...found };
    }
    return { name: 'custom', retrieval: false, sparseState: false, trust: 'off', ...(variant || {}) };
}

const now = () => Number(process.hrtime.bigint()) / 1e6;

/**
 * Runs one turn, up to and including the decision.
 *
 * @param {Object} params
 * @param {string} params.text
 * @param {Array} params.catalog                the scenario catalog
 * @param {Object} [params.previous]            previous SIE state: { diagnosticState, decisionState, turnCount, language, lastCustomerText }
 * @param {Object} [params.settings]
 * @param {string|Object} [params.variant='current']
 * @param {Object} [params.providers]           language providers, for Node tests
 * @returns {Promise<Object>}
 */
export async function runTurn({ text, catalog, previous = null, settings = {}, variant = 'current', providers = {}, rankingOptions = {} }) {
    const cfg = resolveVariant(variant);
    const timings = {};
    const turn = (previous?.turnCount || 0) + 1;

    // ── Language ───────────────────────────────────────────────
    let t = now();
    const normalized = await normalize(text, { previousLanguage: previous?.language || 'ar', ...providers });
    timings.language = now() - t;

    // ── Interpretation ─────────────────────────────────────────
    t = now();
    const interpretation = interpretTurn({ text, previous, settings });
    timings.interpretation = now() - t;

    // Non-diagnostic turns stop here. They are still classified and still
    // carry a trust envelope, because the memory kind can write durable state
    // and an escalation opens a ticket — both are boundary crossings.
    const evidence = extractTextEvidence(normalized.normalizedTokens, turn);

    // ── Trust CP1 ──────────────────────────────────────────────
    t = now();
    const trustEnvelope = openTurn({ rawText: text, evidence }, {
        enabled: cfg.trust !== 'off',
        observeOnly: cfg.trust === 'observe'
    });
    timings.trust = now() - t;

    if (interpretation.kind !== TURN_KINDS.DIAGNOSTIC) {
        return {
            variant: cfg.name, turn, interpretation, trustEnvelope,
            responseLanguage: normalized.responseLanguage,
            ranking: null, decision: null, decisionState: previous?.decisionState || null,
            diagnosticState: previous?.diagnosticState || null,
            evidenceAdmitted: 0, evidenceDropped: 0,
            scope: null, timings,
            trace: { interpretation: interpretationTrace(interpretation), trust: trustTrace(trustEnvelope) }
        };
    }

    // ── Evidence, bounded by CP2 ───────────────────────────────
    t = now();
    // A tapped discriminating-question option becomes the evidence it was
    // written to imply. It joins the text evidence BEFORE the trust boundary,
    // so it is bounded exactly like everything else the customer sends.
    const answered = await evidenceFromQuestionAnswer({
        text,
        decisionState: previous?.decisionState,
        lookup: (id) => catalog.find((s) => s.id === id) || null,
        turn
    });
    const { evidence: admitted, dropped } = admitEvidence(
        answered ? [...evidence, ...answered.evidence] : evidence,
        trustEnvelope
    );
    const priorState = previous?.diagnosticState || null;
    const priorAccumulator = priorState?.accumulator || { entries: [] };
    const accumulator = mergeEvidence(priorAccumulator, admitted, turn);
    const presences = getAllTokenPresences(accumulator);
    timings.evidence = now() - t;

    // Previous hypotheses, whichever shape the session was stored in. A
    // sparse state expands exactly; a full one is used as-is. Neither variant
    // is allowed to fail on the other's shape, because a rollback that cannot
    // read the sessions it wrote is not a rollback.
    const previousHypotheses = priorState
        ? (isSparseState(priorState) ? expandHypotheses(priorState, catalog, Math.max(1, turn - 1)) : (priorState.hypotheses || []))
        : [];

    // ── Scope ──────────────────────────────────────────────────
    t = now();
    const scope = cfg.retrieval
        ? scopeCandidates({
            scenarios: catalog,
            tokenPresences: presences,
            previousHypotheses,
            previousDecisionState: previous?.decisionState
        })
        : { scenarios: catalog, stats: { catalogSize: catalog.length, postingsScanned: null, retrieved: catalog.length, rememberedAdded: 0, referencedAdded: 0, total: catalog.length } };
    timings.scope = now() - t;

    // ── Diagnostics ────────────────────────────────────────────
    t = now();
    const hypotheses = updateHypotheses(scope.scenarios, presences, previousHypotheses, turn);
    timings.diagnostics = now() - t;

    // ── Ranking ────────────────────────────────────────────────
    t = now();
    const activationThreshold = activationThresholdForLevel(settings.diagnosis_level);
    // `catalogSize` is the CATALOG, not the scope. Under retrieval the scope
    // is empty whenever the message shares no vocabulary with any scenario,
    // and the decision engine has to be able to tell that from a catalog that
    // failed to load. See R4_EMPTY_SCOPE.
    const ranking = rankHypotheses(hypotheses, scope.scenarios, { ...rankingOptions, activationThreshold, catalogSize: catalog.length });
    timings.ranking = now() - t;

    // ── Decision ───────────────────────────────────────────────
    t = now();
    const newEvidenceAddedThisTurn = (accumulator.entries || []).filter((e) => e.turn === turn).length;
    const { decision, decisionState } = decide({
        ranking, turn,
        previousDecisionState: previous?.decisionState,
        newEvidenceAddedThisTurn,
        policy: buildPolicy(settings, activationThreshold),
        customerSignal: interpretation.resolutionSignal
    });
    timings.decision = now() - t;

    // ── Trust CP3b ─────────────────────────────────────────────
    const { decision: authorized, downgraded } = admitAction(decision, trustEnvelope);

    // ── State ──────────────────────────────────────────────────
    t = now();
    const diagnosticState = cfg.sparseState
        ? updateSparseState({ scenarios: catalog, previous: priorState, newEvidence: admitted, turn })
        : { accumulator, hypotheses: cfg.retrieval ? hypotheses : hypotheses, turnCount: turn };
    timings.state = now() - t;

    timings.total = Object.values(timings).reduce((a, b) => a + b, 0);

    return {
        variant: cfg.name, turn, interpretation, trustEnvelope,
        responseLanguage: normalized.responseLanguage,
        ranking, decision: authorized, actionDowngraded: downgraded, decisionState,
        diagnosticState,
        evidenceAdmitted: admitted.length, evidenceDropped: dropped,
        questionAnswer: answered ? { scenarioId: answered.scenarioId, questionId: answered.questionId, option: answered.optionValue } : null,
        scope: scope.stats, timings,
        trace: { interpretation: interpretationTrace(interpretation), trust: trustTrace(trustEnvelope) }
    };
}

/** Exactly the policy the bridge builds, so the comparator is not comparing policies. */
function buildPolicy(settings, activationThreshold) {
    return {
        activationThreshold,
        allowAutoResolution: settings.answer_directly,
        allowScenarioAnswers: settings.knowledge_use_scenarios,
        allowEvidenceRequests: settings.auto_request_more_info,
        ticketOnAmbiguity: settings.ticket_on_low_confidence,
        includeTicketSummary: settings.ticket_include_summary,
        resolutionConfidenceThreshold: settings.answer_confidence,
        maxClarifyingQuestions: settings.max_clarifying_questions,
        maxTurnsBeforeEscalation: settings.ticket_after_turns,
        allowSmartGuess: settings.allow_smart_guess,
        requireCompleteEvidence: settings.inference_mode === 'knowledge_only'
    };
}

/**
 * Runs a whole conversation, threading state between turns. The unit a
 * comparator actually compares: a per-turn comparison cannot see a divergence
 * that only appears once state has accumulated.
 *
 * @param {Object} params
 * @param {string[]} params.messages
 * @returns {Promise<Object[]>} one result per turn
 */
export async function runConversation({ messages, catalog, settings = {}, variant = 'current', providers = {} }) {
    const results = [];
    let previous = null;
    for (const message of messages) {
        const result = await runTurn({ text: message, catalog, previous, settings, variant, providers });
        results.push(result);
        previous = {
            diagnosticState: result.diagnosticState,
            decisionState: result.decisionState,
            turnCount: result.turn,
            language: result.responseLanguage,
            lastCustomerText: String(message).slice(0, 500)
        };
    }
    return results;
}
