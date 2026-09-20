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
 * MEASURED, and the measurement carries a negative result worth stating.
 *
 * Over the 345-message reference corpus a single legitimate turn puts p50=1,
 * p90=2, p95=3 scenarios across 0.6 — but the maximum is 11, reached by the
 * perfectly ordinary question "عايز اعرف عن منصه ازاي بتشتغل" ("how does the
 * platform work?"). A greedy search over the catalog shows an attacker
 * reaches exactly 11 with one well-chosen token.
 *
 * So AT THE LOW END THIS SENSOR CANNOT DISCRIMINATE AT ALL. The vague
 * question and the single-token probe produce identical effects, because they
 * ARE the same input as far as the engine is concerned. No threshold
 * separates them; one can only be traded for the other.
 *
 * The sensor is still worth having, but only for what it can actually see.
 * The greedy search reaches 19 scenarios at three tokens and 98 at thirty, so
 * a threshold of 15 sits above every legitimate case observed and below any
 * multi-token flood. It catches the flood; it does not pretend to catch the
 * single-token case.
 *
 * The single-token case is a CATALOG defect, not a message defect: 465 of 650
 * scenarios (71.5%) are auto-resolvable from one token because confidence is
 * a coverage ratio over signatures too thin to discriminate. It is recorded
 * in SIE-ARCHITECTURE.md and fixed by changing signatures, not by adding
 * detectors. A sensor tuned to catch it would block "how does the platform
 * work?", which is a worse outcome than the defect.
 */
const BREADTH_CONSTRAIN = 15;
const BREADTH_QUARANTINE = 40;

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
