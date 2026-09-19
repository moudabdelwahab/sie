/**
 * evidence-guard.js
 * ------------------------------------------------------------
 * CHECKPOINT 2 — bounds how far one turn may move belief.
 *
 * This is the enforcement point that makes the whole layer worth having,
 * because it is the only one that does not depend on detection being right.
 *
 * The sensors upstream can all be evaded; any classifier can. What cannot be
 * evaded is arithmetic: evidence reaching the accumulator is capped at the
 * envelope's budget, so a turn classified CONSTRAINED moves belief by at most
 * the weight of one ordinary sentence no matter how it is phrased, and a turn
 * classified QUARANTINED moves belief not at all. An attacker who defeats
 * every sensor is left with a turn that behaves like a normal turn — which is
 * to say, is not an attack.
 */
import { stateLeverageSignal } from './risk-signals.js';
import { escalate, TRUST_LEVELS } from './trust-types.js';

/**
 * How many scenarios one turn may carry over the auto-resolution threshold
 * before the breadth itself is the anomaly.
 *
 * MEASURED: over the 1,077-message reference corpus, a single turn carries
 * p50=1, p90=2, max=5 scenarios across 0.6. A greedy search over the catalog
 * reaches 11 with one token and 98 with thirty, so the attacker's reachable
 * range starts well above the legitimate one and there is room for a
 * threshold between them.
 *
 * HONEST CAVEAT, because it matters: the single token `intent_how_to` alone
 * lifts 11 scenarios over the threshold, so a customer typing nothing but
 * "ازاي؟" will trip this. That is not a defect in the sensor — it is the
 * catalog defect documented in SIE-ARCHITECTURE.md ("71.5% of scenarios are
 * auto-resolvable from a single token") showing through. Constraining that
 * turn costs the customer nothing measurable (a one-token message contributes
 * weight 1.0 against a budget of 4.0), and the trace entry is the point: it
 * makes the catalog defect visible in production rather than theoretical.
 */
const BREADTH_CONSTRAIN = 8;
const BREADTH_QUARANTINE = 20;

/**
 * @param {Array<{token: string, weight: number}>} evidence this turn's evidence
 * @param {import('./trust-types.js').TrustEnvelope} envelope
 * @param {Object} [context]
 * @param {number|null} [context.resolvableCount] how many scenarios this turn
 *        would carry over the resolution threshold. Supplied by the caller,
 *        which is the only place holding the catalog — the guard stays pure.
 * @returns {{evidence: Array, envelope: import('./trust-types.js').TrustEnvelope, dropped: number}}
 */
export function guardEvidence(evidence, envelope, { resolvableCount = null } = {}) {
    const incoming = Array.isArray(evidence) ? evidence : [];
    let env = envelope;

    // Escalate BEFORE clipping, so a budget tightened by the effect-based
    // check is the budget actually applied. Order is load-bearing here.
    if (typeof resolvableCount === 'number' && resolvableCount >= BREADTH_CONSTRAIN) {
        env = escalate(env, stateLeverageSignal({
            scenarioId: `${resolvableCount} scenarios`,
            before: 0,
            after: resolvableCount,
            threshold: resolvableCount >= BREADTH_QUARANTINE ? BREADTH_QUARANTINE : BREADTH_CONSTRAIN
        }));
        if (resolvableCount >= BREADTH_QUARANTINE) {
            env = { ...env, level: TRUST_LEVELS.QUARANTINED, evidenceBudget: 0, mayWriteFacts: false, mayMutateState: false, mayTriggerAction: false };
        }
    }

    const budget = env.evidenceBudget;
    if (budget === 0) return { evidence: [], envelope: env, dropped: incoming.length };
    if (!Number.isFinite(budget)) return { evidence: incoming, envelope: env, dropped: 0 };

    // Clipped in ARRIVAL order, not strongest-first. A message's opening words
    // are what it is about; keeping the heaviest tokens instead would let an
    // attacker choose which of their signals survives the cap, which is the
    // opposite of what a cap is for.
    const kept = [];
    let spent = 0;
    for (const e of incoming) {
        const w = typeof e.weight === 'number' ? e.weight : 0;
        if (spent + w > budget) continue;
        kept.push(e);
        spent += w;
    }
    return { evidence: kept, envelope: env, dropped: incoming.length - kept.length };
}

export const BREADTH_THRESHOLDS = Object.freeze({ BREADTH_CONSTRAIN, BREADTH_QUARANTINE });
