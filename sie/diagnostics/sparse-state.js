/**
 * sparse-state.js
 * ------------------------------------------------------------
 * حالة تشخيصية مضغوطة — the diagnostic state, minus what can be recomputed.
 *
 * ------------------------------------------------------------
 * WHAT THE STATE COSTS TODAY, MEASURED
 *
 * `updateHypotheses` returns one record per catalog scenario, every turn, and
 * the whole array is persisted in the session. Measured on a real three-turn
 * conversation against the shipped 650-scenario catalog:
 *
 *   turn 1   203.7 KB    650 hypotheses,  1 with confidence > 0
 *   turn 2   204.9 KB    650 hypotheses, 17 with confidence > 0
 *   turn 3   207.1 KB    650 hypotheses, 51 with confidence > 0
 *
 *   of which:  missingEvidenceTokens  ~37 KB
 *              history                ~33 KB
 *              accumulator (evidence)  ~0.2 KB
 *
 * The evidence ledger — the only thing in there that cannot be recomputed —
 * is 0.1% of the payload. The other 99.9% is a cache of a pure function,
 * written to the database on every turn.
 *
 * At 10,000 scenarios the same shape is ~3.1 MB per session. There is no
 * session store where that is acceptable, so this is the wall the catalog hits
 * first — before CPU, before retrieval, before anything else.
 *
 * ------------------------------------------------------------
 * WHAT IS ACTUALLY IRREDUCIBLE
 *
 * Confidence is a pure function of the evidence ledger and the scenario's
 * signature. So are `supportingEvidenceTokens` and `missingEvidenceTokens`.
 * Given the ledger and the catalog, all three can be recomputed exactly, which
 * means storing them is storing a cache in the wrong place.
 *
 * Two things are genuinely path-dependent and cannot be recovered from the
 * ledger alone:
 *
 *   hasEverBeenActive — hysteresis. A hypothesis that once crossed the
 *                       activation threshold stays 'active' until it falls
 *                       below the LOWER rejection threshold, and becomes
 *                       'rejected' rather than 'unconsidered' when it does.
 *                       Which of those two a zero-confidence scenario is
 *                       depends on history, not on current evidence.
 *   history           — the per-turn trail itself.
 *
 * Both are only interesting for scenarios that have actually been in play. So
 * the sparse state keeps the ledger plus a record for each of those, and
 * recomputes the rest. Which scenarios count as "in play" is the one design
 * decision here that is not obvious — see the next section.
 *
 * Measured on the same conversation: 1, 17 and 51 tracked records instead of
 * 650, and the tracked records are the ones a human reading an escalated
 * ticket actually wants. Session state falls from 203.7 KB to 0.35 KB on
 * turn 1 and from 204.6 KB to 7.7 KB on turn 3.
 *
 * ------------------------------------------------------------
 * WHAT IS TRACKED, AND WHY THAT EXACT LINE
 *
 * The obvious criterion is "has this scenario ever been active", since that is
 * the flag hysteresis needs. It was the first implementation, and the
 * equivalence test rejected it: a scenario that becomes active on turn 3 has a
 * history in the full tracker reaching back to turn 1, because the full tracker
 * created its record on turn 1 and appended to it whenever its confidence
 * moved. Starting the trail at turn 3 loses real entries — and starting it with
 * a synthesised zero is only right when the confidence really was zero
 * throughout, which is not guaranteed (0.1 never crosses the 0.15 activation
 * threshold but is not 0).
 *
 * So the line is drawn one step earlier: a scenario is tracked once its
 * confidence has ever been NON-ZERO.
 *
 * That makes expansion EXACT, with no exception, and the reason is worth
 * spelling out because it is what the test actually checks. An untracked
 * scenario has had confidence 0 on every turn of the session. The full tracker
 * appends to history only when status or confidence CHANGED, and for such a
 * scenario nothing ever changed — so its history is exactly one entry,
 * `[{turn: firstTurn, confidence: 0, status: 'unconsidered'}]`, from turn 1 to
 * the end of the session. Every field of an untracked hypothesis is therefore a
 * constant, and reconstructing it is arithmetic rather than approximation.
 *
 * The cost of the wider criterion is close to nothing: on the measured
 * conversation it tracks 51 scenarios at turn 3 instead of 48.
 *
 * ------------------------------------------------------------
 * WHAT THIS DOES NOT FIX
 *
 * The tracked set only grows. A long conversation that touches many topics
 * accumulates a tracked record for every scenario that ever scored above zero,
 * and nothing removes them — correctly, since hysteresis and the diagnostic
 * trail both depend on them persisting. So session state is bounded by the
 * conversation's breadth rather than by the catalog, which is the intended
 * change, but it is a bound rather than a constant. Measured growth over turns
 * is in the test file.
 */
import { computeScenarioConfidence, ACTIVATION_THRESHOLD, REJECTION_THRESHOLD } from './hypothesis-tracker.js';
import { mergeEvidence, getAllTokenPresences } from './evidence-accumulator.js';
import { retrieveCandidates } from '../retrieval/candidate-retrieval.js';
import { buildScenarioIndex } from '../retrieval/scenario-index.js';

/**
 * Bumped whenever the persisted shape changes. Written into every state this
 * module produces so a session stored by an older deployment is recognisable
 * rather than merely malformed — see `migrateState`.
 *
 * 1 — implicit: the original full-hypotheses shape, which carried no version.
 * 2 — sparse: ledger plus tracked hypotheses.
 */
export const DIAGNOSTIC_SCHEMA_VERSION = 2;

/**
 * Same three-way status as the tracker, reimplemented here rather than
 * imported because the tracker keeps it private. Kept adjacent to the
 * thresholds it reads so the two cannot drift apart unnoticed.
 */
function deriveStatus(confidence, hasEverBeenActive) {
    if (confidence >= ACTIVATION_THRESHOLD) return 'active';
    if (hasEverBeenActive) return confidence < REJECTION_THRESHOLD ? 'rejected' : 'active';
    return 'unconsidered';
}

/** @returns {Object} an empty v2 state */
export function createEmptySparseState() {
    return {
        schemaVersion: DIAGNOSTIC_SCHEMA_VERSION,
        accumulator: { entries: [] },
        tracked: [],
        // The session's first turn. In the full tracker every scenario's
        // record is created on that turn, so `firstSeenTurn` is the same
        // constant for all 650 of them — stored once here instead of 650 times.
        firstTurn: 0,
        turnCount: 0
    };
}

/** @returns {boolean} true when `state` is already in the sparse shape */
export function isSparseState(state) {
    return Boolean(state) && state.schemaVersion === DIAGNOSTIC_SCHEMA_VERSION && Array.isArray(state.tracked);
}

/**
 * Compresses a full (v1) diagnostic state into the sparse shape.
 *
 * This is the migration path for sessions already in the database, and it is
 * lossless: every field of every hypothesis is either kept or reconstructed
 * exactly by `expandHypotheses`.
 *
 * @param {Object} state a DiagnosticState with a full `hypotheses` array
 * @returns {Object} a v2 sparse state
 */
export function toSparseState(state) {
    if (!state) return createEmptySparseState();
    if (isSparseState(state)) return state;
    const hypotheses = state.hypotheses || [];
    // A v1 state's own `firstSeenTurn` is the authority for when the session
    // began; fall back to 1 for a state that carries no hypotheses at all.
    const firstTurn = hypotheses.length
        ? Math.min(...hypotheses.map((h) => h.firstSeenTurn ?? 1))
        : (state.turnCount ? 1 : 0);

    return {
        schemaVersion: DIAGNOSTIC_SCHEMA_VERSION,
        accumulator: state.accumulator || { entries: [] },
        // Tracked once confidence has ever been non-zero — not once active.
        // See the header for why that line and not the obvious one.
        tracked: hypotheses
            .filter((h) => h.hasEverBeenActive || h.confidence > 0 || (h.history || []).some((e) => e.confidence > 0))
            .map((h) => ({
                scenarioId: h.scenarioId,
                hasEverBeenActive: Boolean(h.hasEverBeenActive),
                history: h.history || []
            })),
        firstTurn,
        turnCount: state.turnCount || 0
    };
}

/**
 * Accepts either shape and returns the sparse one. The single entry point for
 * reading a session whose state may predate this module.
 */
export function migrateState(state) {
    return isSparseState(state) ? state : toSparseState(state);
}

/**
 * Processes one turn against the sparse state.
 *
 * The scenarios evaluated are the RETRIEVED candidates — those sharing a token
 * with the accumulated evidence — union the already-tracked ones. The union
 * matters: a tracked scenario whose confidence has fallen to zero must still
 * be evaluated, because that is exactly when it transitions to 'rejected', and
 * retrieval will not return it.
 *
 * @param {Object} params
 * @param {Array} params.scenarios  the catalog
 * @param {Object} params.previous  previous state, either shape, or null
 * @param {Array} params.newEvidence this turn's evidence
 * @param {number} params.turn
 * @returns {Object} a v2 sparse state
 */
export function updateSparseState({ scenarios, previous, newEvidence = [], turn }) {
    const prior = migrateState(previous) || createEmptySparseState();
    const index = buildScenarioIndex(scenarios);
    const firstTurn = prior.firstTurn || turn;

    const accumulator = mergeEvidence(prior.accumulator || { entries: [] }, newEvidence, turn);
    const presences = getAllTokenPresences(accumulator);

    const priorById = new Map((prior.tracked || []).map((t) => [t.scenarioId, t]));

    // Candidates ∪ tracked. `minConfidence: -1` because a candidate at exactly
    // 0 is still worth evaluating here — the default filter drops zeroes, and
    // dropping a tracked scenario's zero is how a 'rejected' transition gets
    // missed.
    const evaluate = new Map();
    for (const c of retrieveCandidates(index, presences, { minConfidence: -1 }).candidates) {
        evaluate.set(c.scenario.id, c.scenario);
    }
    for (const id of priorById.keys()) {
        if (!evaluate.has(id)) {
            const scenario = index.scenarios.find((s) => s.id === id);
            if (scenario) evaluate.set(id, scenario);
        }
    }

    const tracked = [];
    for (const [id, scenario] of evaluate) {
        const before = priorById.get(id);
        const { confidence } = computeScenarioConfidence(scenario, presences);
        const hasEverBeenActive = Boolean(before?.hasEverBeenActive) || confidence >= ACTIVATION_THRESHOLD;

        // Not tracked, and never has been: its whole record is a constant that
        // expansion reconstructs. Skipping it here is the entire saving.
        if (!before && confidence === 0) continue;

        const status = deriveStatus(confidence, hasEverBeenActive);
        // A newly tracked scenario's trail must start where the full tracker's
        // did — at the session's first turn, with the zero it sat at until now.
        // That reconstruction is only sound because a scenario reaching this
        // branch for the first time HAS been at zero throughout: any earlier
        // non-zero confidence would already have tracked it.
        const history = before?.history
            ? [...before.history]
            : (turn > firstTurn ? [{ turn: firstTurn, confidence: 0, status: 'unconsidered' }] : []);
        const last = history[history.length - 1];
        if (!last || last.status !== status || last.confidence !== confidence) {
            history.push({ turn, confidence, status });
        }
        tracked.push({ scenarioId: id, hasEverBeenActive, history });
    }

    // Sorted by id so the persisted state is byte-stable across turns that
    // change nothing. A state that reorders itself defeats any diff a reviewer
    // or a shadow comparison wants to take of it.
    tracked.sort((a, b) => a.scenarioId.localeCompare(b.scenarioId));

    return { schemaVersion: DIAGNOSTIC_SCHEMA_VERSION, accumulator, tracked, firstTurn, turnCount: turn };
}

/**
 * Expands a sparse state back into the full hypotheses array that
 * `rankHypotheses` and the observability layer already consume.
 *
 * Exact for every field of every scenario. See the header for why.
 *
 * @param {Object} sparse
 * @param {Array} scenarios
 * @param {number} turn the turn being expanded for; becomes lastUpdatedTurn
 * @param {number|null} [firstTurnOverride] overrides the session's first turn,
 *        for a caller replaying a fragment rather than a whole session.
 * @returns {Array} hypotheses, one per scenario, in catalog order
 */
export function expandHypotheses(sparse, scenarios, turn, firstTurnOverride = null) {
    const state = migrateState(sparse) || createEmptySparseState();
    const firstTurn = firstTurnOverride ?? (state.firstTurn || 1);
    const presences = getAllTokenPresences(state.accumulator || { entries: [] });
    const trackedById = new Map((state.tracked || []).map((t) => [t.scenarioId, t]));

    return scenarios.map((scenario) => {
        const tracked = trackedById.get(scenario.id);
        const { confidence, supportingEvidenceTokens, missingEvidenceTokens } =
            computeScenarioConfidence(scenario, presences);
        const hasEverBeenActive = Boolean(tracked?.hasEverBeenActive);
        const status = deriveStatus(confidence, hasEverBeenActive);

        return {
            scenarioId: scenario.id,
            status,
            confidence,
            supportingEvidenceTokens,
            missingEvidenceTokens,
            hasEverBeenActive,
            firstSeenTurn: firstTurn,
            lastUpdatedTurn: turn,
            // An untracked scenario has been at confidence 0 on every turn, and
            // the full tracker appends to history only on CHANGE — so its trail
            // is exactly this one entry, dated the session's first turn, for the
            // whole session.
            history: tracked?.history ?? [{ turn: firstTurn, confidence, status }]
        };
    });
}

/**
 * Byte sizes of a state in both shapes, for benchmarks and for deciding
 * whether a catalog size is viable at all. Exposed because "how big is the
 * session" is the question that gates catalog growth.
 */
export function stateSize(sparse, scenarios, turn) {
    const sparseBytes = JSON.stringify(migrateState(sparse)).length;
    const fullBytes = JSON.stringify({
        accumulator: sparse.accumulator,
        hypotheses: expandHypotheses(sparse, scenarios, turn),
        turnCount: turn
    }).length;
    return { sparseBytes, fullBytes, ratio: fullBytes / Math.max(1, sparseBytes) };
}
