/**
 * admission-control.js
 * ------------------------------------------------------------
 * CHECKPOINT 1 — the trust boundary's single decision point.
 *
 * Classifies one turn, once, and emits the TrustEnvelope that travels with
 * it. Everything else in this layer is enforcement; nothing else decides.
 *
 * ------------------------------------------------------------
 * WHERE THIS SITS, AND WHY IT IS NOT "IN FRONT OF THE PIPELINE"
 *
 * The obvious place for a security layer is before everything else. That
 * would be wrong here, and the reason is worth stating.
 *
 * Half of what this layer needs to know is only knowable AFTER normalization.
 * "How many distinct diagnostic signals does this message carry" is the most
 * discriminative measurement available, and it does not exist until the
 * glossary has resolved the text. A gate placed before Language would be
 * reduced to reading raw characters — which is exactly the naive filter this
 * layer is meant not to be.
 *
 * So admission runs in the seam between Language and Diagnostics:
 *
 *      normalize()  ->  extractTextEvidence()  ->  [ADMISSION]  ->  accumulate
 *
 * Normalization is pure and cheap; nothing it does is a state change. The
 * first irreversible step in a turn is evidence reaching the accumulator, and
 * admission sits immediately before that. The boundary is placed at the first
 * point where damage becomes possible, not at the first point where code runs.
 *
 * ------------------------------------------------------------
 * ONE CLASSIFICATION, NOT A CASCADE
 *
 * Every sensor runs on every turn, and all of them run even after one has
 * already argued for REJECTED. Short-circuiting would save microseconds and
 * cost the trace: an operator reading why a turn was refused wants the whole
 * picture, not the first thing that tripped. The cost is bounded — the
 * sensors are linear in message length over a message the size sensor has
 * already capped.
 */
import {
    detectOversizedInput,
    detectTranscriptMimicry,
    detectSystemDirective,
    detectAuthorityClaim,
    detectSignalFlood,
    detectDomainSpray
} from './risk-signals.js';
import { envelopeFrom } from './trust-types.js';

/**
 * @param {Object} turn
 * @param {string} turn.rawText   the customer's message, exactly as received
 * @param {Array<{token: string, weight: number}>} [turn.evidence]
 *        this turn's extracted evidence, BEFORE it reaches the accumulator
 * @returns {import('./trust-types.js').TrustEnvelope}
 */
export function admitTurn({ rawText, evidence = [] } = {}) {
    const text = typeof rawText === 'string' ? rawText : '';
    const ev = Array.isArray(evidence) ? evidence : [];

    const signals = [
        // Structural — the shape of what was sent.
        detectOversizedInput(text),
        detectTranscriptMimicry(text),
        detectSystemDirective(text),
        detectAuthorityClaim(text),
        // Statistical — the shape of what it would mean. These read no words.
        // (`repetition_pump` was measured, found to defend nothing, and removed;
        //  risk-signals.js records the measurement.)
        detectSignalFlood(ev),
        detectDomainSpray(ev)
    ].filter(Boolean);

    return envelopeFrom(signals);
}
