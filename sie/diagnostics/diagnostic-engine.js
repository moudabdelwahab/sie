/**
 * diagnostic-engine.js
 * ------------------------------------------------------------
 * Orchestrates one turn of diagnostic reasoning:
 *   1. Extract text evidence from Module 1's normalized token stream
 *   2. Fetch live-account evidence (currently the no-op stub, per this
 *      module's isolation requirement)
 *   3. Merge everything into the running evidence accumulator
 *   4. Recompute every scenario's hypothesis (confidence + status)
 *   5. Return the updated DiagnosticState
 *
 * This module does NOT rank hypotheses against each other, does NOT
 * decide what to say or do next, and does NOT touch Supabase or any
 * live chat code — it is a pure, storage-agnostic reasoning step. The
 * caller is responsible for persisting the returned DiagnosticState
 * (e.g. into chat_sessions.bot_state) and for supplying the previous
 * turn's state back in on the next call — this module holds no memory
 * of its own between calls, which is what keeps it fully testable in
 * isolation.
 */
import { createEmptyDiagnosticState } from './evidence-types.js';
import { extractTextEvidence } from './evidence-extractor.js';
import { isSparseState, expandHypotheses } from './sparse-state.js';
import { mergeEvidence, getAllTokenPresences } from './evidence-accumulator.js';
import { updateHypotheses } from './hypothesis-tracker.js';
import { liveEvidenceProviderStub } from './live-evidence-provider.stub.js';
import { scenarioCatalogProvider } from '../scenarios/scenario-catalog.local.js';

/**
 * @param {Object} params
 * @param {Array<{canonical: string, source: string, raw: string}>} params.normalizedTokens
 *   Output of Module 1's normalize().normalizedTokens for this turn
 * @param {number} params.turn - current turn number (caller-managed, starts at 1)
 * @param {import('./evidence-types.js').DiagnosticState} [params.previousState] - defaults to an empty state
 * @param {{userId: string}} [params.liveEvidenceContext] - if omitted, no live evidence is fetched this turn
 * @param {import('./evidence-types.js').Evidence[]} [params.additionalEvidence] - e.g. from a
 *   discriminating-question answer (see evidence-extractor.extractDiscriminatingAnswerEvidence)
 * @param {{getAllScenarios: Function}} [params.scenarioProvider] - defaults to Module 2's local provider
 * @param {{getLiveEvidence: Function}} [params.liveEvidenceProvider] - defaults to the no-op stub
 * @returns {Promise<import('./evidence-types.js').DiagnosticState>}
 */
export async function processTurn({
    normalizedTokens,
    turn,
    previousState,
    liveEvidenceContext,
    additionalEvidence = [],
    scenarioProvider = scenarioCatalogProvider,
    liveEvidenceProvider = liveEvidenceProviderStub,
    evidenceFilter = null,
    scope = null
}) {
    const state = previousState || createEmptyDiagnosticState();

    const scenarios = await scenarioProvider.getAllScenarios();

    const textEvidence = extractTextEvidence(normalizedTokens, turn);
    const liveEvidence = liveEvidenceContext
        ? await liveEvidenceProvider.getLiveEvidence({ ...liveEvidenceContext, turn })
        : [];

    let allNewEvidence = [...textEvidence, ...liveEvidence, ...additionalEvidence];

    // The seam the trust boundary's evidence guard occupies.
    //
    // A CALLBACK rather than an import, deliberately: this module must not know
    // that a trust layer exists. What it needs to know is that the evidence
    // about to reach the accumulator may be bounded by its caller, and that the
    // bound applies HERE — immediately before the first irreversible step of a
    // turn, after extraction (so the filter can see what the message actually
    // means) and before accumulation (so nothing it removes has moved belief).
    //
    // Pure and total by contract: it returns a subset, it cannot add evidence,
    // and a filter that throws takes the turn down rather than silently
    // processing unbounded input.
    if (typeof evidenceFilter === 'function') {
        allNewEvidence = evidenceFilter(allNewEvidence) || [];
    }

    const newAccumulator = mergeEvidence(state.accumulator, allNewEvidence, turn);
    const tokenPresences = getAllTokenPresences(newAccumulator);

    // A session persisted in the sparse shape expands back to the full
    // hypotheses array here, so the tracker's hysteresis sees the same prior
    // state it would have seen before sparse persistence existed. Expansion is
    // exact — see sparse-state.js — so this is a decompression, not a
    // reconstruction from partial information.
    const previousHypotheses = isSparseState(state)
        ? expandHypotheses(state, scenarios, Math.max(1, turn - 1))
        : (state.hypotheses || []);

    // The seam retrieval occupies — a callback for the same reason
    // evidenceFilter is one: this module must not depend on how the caller
    // chooses which scenarios to score. The contract is exactness: the
    // callback returns a SUBSET of `scenarios` that contains every scenario
    // whose confidence could be non-zero, plus every scenario the
    // conversation already tracks (see pipeline/candidate-scope.js, and
    // retrieval/equivalence.test.mjs for the proof that nothing else can
    // score). Absent, every scenario is scored — the behaviour this module
    // has always had.
    let scopeStats = null;
    let scored = scenarios;
    if (typeof scope === 'function') {
        const scoped = scope({ scenarios, tokenPresences, previousHypotheses });
        scored = scoped.scenarios;
        scopeStats = scoped.stats || null;
    }

    const newHypotheses = updateHypotheses(scored, tokenPresences, previousHypotheses, turn);

    return {
        accumulator: newAccumulator,
        hypotheses: newHypotheses,
        turnCount: turn,
        // Not persisted by callers that spread only the three fields above;
        // read by the bridge for the trace.
        ...(scopeStats ? { scopeStats } : {})
    };
}

/**
 * Convenience accessor: hypotheses currently considered plausible.
 * A neutral filter over the existing `status` field — not a ranking or
 * comparison across scenarios, which remains the Ranking Engine's job.
 * @param {import('./evidence-types.js').DiagnosticState} state
 * @returns {import('./evidence-types.js').Hypothesis[]}
 */
export function getActiveHypotheses(state) {
    return (state?.hypotheses || []).filter((h) => h.status === 'active');
}

/**
 * Convenience accessor: hypotheses that were once plausible and have
 * since been ruled out — kept in state, never deleted.
 * @param {import('./evidence-types.js').DiagnosticState} state
 * @returns {import('./evidence-types.js').Hypothesis[]}
 */
export function getRejectedHypotheses(state) {
    return (state?.hypotheses || []).filter((h) => h.status === 'rejected');
}
