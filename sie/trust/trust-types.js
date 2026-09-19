/**
 * trust-types.js
 * ------------------------------------------------------------
 * المفردات المشتركة لطبقة الثقة — الطبقة العاشرة.
 *
 * ------------------------------------------------------------
 * WHAT THIS LAYER IS FOR
 *
 * Every other layer in SIE assumes its input is a description of a problem.
 * That assumption is what makes the engine useful, and it is also the one
 * thing an adversary controls completely.
 *
 * This layer exists to make one distinction the rest of the engine cannot
 * make for itself:
 *
 *     Is this text DESCRIBING a situation, or trying to CHANGE THE RULES
 *     under which the engine operates?
 *
 * A support engine has no "instructions" channel to hijack, so there is no
 * literal prompt injection. But the abstract attack survives the change of
 * substrate: user text crosses from being an INPUT to being part of the
 * engine's CONTROL STATE at four specific places, and each is a boundary
 * that has to be defended on its own terms:
 *
 *   1. text -> evidence -> belief          (ranking manipulation, state poisoning)
 *   2. text -> stored facts                (memory poisoning)
 *   3. belief -> action                    (action injection)
 *   4. stored text -> bot output           (system-voice impersonation)
 *
 * ------------------------------------------------------------
 * WHY NOT KEYWORDS
 *
 * A phrase list ("ignore previous instructions") fails twice over. It misses
 * every rephrasing, and — far worse — it pretends the problem is lexical when
 * it is structural. The engine is not harmed by a customer SAYING something;
 * it is harmed when one turn can move belief further than a turn should, or
 * write a fact that changes what the engine will do next week.
 *
 * So the signals here are behavioural and, where possible, EFFECT-BASED:
 * measured against what the turn would DO, not what it looks like.
 * `state_leverage` is the clearest example — it fires when a single turn
 * would by itself flip a scenario over the answer threshold, no matter how
 * innocent the wording. An attack that evades every other sensor still has
 * to produce that effect to be an attack at all.
 *
 * ------------------------------------------------------------
 * WHY FOUR CHECKPOINTS AND NOT ONE FILTER
 *
 * A single "is this bad?" gate in front of the pipeline would be a filter,
 * not a boundary: it would have to be right first time, about text, before
 * anything is known. Instead this layer splits the classic way:
 *
 *   ONE decision point  (admission-control) — classifies the turn once
 *   FOUR enforcement points                 — apply that verdict where a
 *                                             crossing actually happens
 *
 * The enforcement points are cheap and total: they cannot be bypassed by a
 * cleverer sentence, because they act on evidence, writes, actions and
 * output — not on words.
 */

/** Graded, never binary. Blocking a confused customer is also a failure. */
export const TRUST_LEVELS = Object.freeze({
    /** Ordinary traffic. Full processing, no constraints. */
    TRUSTED: 'trusted',
    /** Unusual, not hostile. Answered normally, but it cannot move belief far
     *  and it cannot write facts. This band is what keeps false positives cheap:
     *  being wrong here costs a customer nothing they would notice. */
    CONSTRAINED: 'constrained',
    /** Behaves like an attempt to rewrite the engine's rules. Answered, but
     *  contributes no evidence, writes no state, and triggers no action. */
    QUARANTINED: 'quarantined',
    /** Structurally hostile (e.g. forged transcript). Not interpreted at all. */
    REJECTED: 'rejected'
});

const ORDER = [TRUST_LEVELS.TRUSTED, TRUST_LEVELS.CONSTRAINED, TRUST_LEVELS.QUARANTINED, TRUST_LEVELS.REJECTED];

/** @returns {string} the stricter of two levels */
export function strictest(a, b) {
    return ORDER.indexOf(a) >= ORDER.indexOf(b) ? a : b;
}

/** @returns {boolean} true when `level` is at least as strict as `atLeast` */
export function atOrAbove(level, atLeast) {
    return ORDER.indexOf(level) >= ORDER.indexOf(atLeast);
}

/**
 * The sensors. Each names a BEHAVIOUR, and each carries the level it argues
 * for on its own — the envelope takes the strictest, so one sensor can never
 * be talked out of its verdict by quieter neighbours.
 */
export const RISK_KINDS = Object.freeze({
    /** Far more distinct diagnostic signals than a real problem report carries. */
    SIGNAL_FLOOD: 'signal_flood',
    /** Signals sprayed across unrelated domains at once. */
    DOMAIN_SPRAY: 'domain_spray',
    /** Text shaped like a conversation transcript — forging other speakers. */
    TRANSCRIPT_MIMICRY: 'transcript_mimicry',
    /** A directive aimed at the assistant's own behaviour or rules. */
    DIRECTIVE_AT_SYSTEM: 'directive_at_system',
    /** A claim of role, permission or entitlement that would change what is allowed. */
    AUTHORITY_CLAIM: 'authority_claim',
    /** A proposed fact that contradicts one already stored. */
    FACT_CONTRADICTION: 'fact_contradiction',
    /** EFFECT-BASED: this single turn would by itself flip a decision. */
    STATE_LEVERAGE: 'state_leverage',
    /** Input far outside the size band any real message occupies. */
    OVERSIZED_INPUT: 'oversized_input'
});

/**
 * @typedef {Object} RiskSignal
 * @property {string} kind      one of RISK_KINDS
 * @property {string} level     the TRUST_LEVEL this sensor argues for
 * @property {number} observed  what was measured
 * @property {number} threshold what would have been unremarkable
 * @property {string} detail    one line, for the trace and for a human
 *
 * @typedef {Object} TrustEnvelope
 * @property {string} level          the effective TRUST_LEVEL for this turn
 * @property {RiskSignal[]} signals  every sensor that fired, strongest first
 * @property {number} evidenceBudget max total evidence weight this turn may contribute
 * @property {boolean} mayWriteFacts
 * @property {boolean} mayMutateState
 * @property {boolean} mayTriggerAction
 * @property {string} rationale      why, in one line — this reaches the trace
 */

/** The envelope for traffic that tripped nothing. */
export function trustedEnvelope() {
    return {
        level: TRUST_LEVELS.TRUSTED,
        signals: [],
        evidenceBudget: Infinity,
        mayWriteFacts: true,
        mayMutateState: true,
        mayTriggerAction: true,
        rationale: 'no risk signal fired'
    };
}

/**
 * Capabilities per level. Deliberately a table rather than branches: what a
 * level permits is a policy statement, and it should be readable as one.
 */
const CAPABILITIES = Object.freeze({
    [TRUST_LEVELS.TRUSTED]:     { evidenceBudget: Infinity, mayWriteFacts: true,  mayMutateState: true,  mayTriggerAction: true },
    // Constrained traffic is still answered and still remembered as a turn —
    // it simply cannot move belief far or assert facts.
    //
    // The budget of 4.0 is not a round number: measured over the reference
    // corpus, a real customer message contributes p90=2.8 and p95=4.0 total
    // evidence weight (max 7.4). Setting the cap at p95 means a FALSE
    // positive costs a genuine customer nothing in 95% of cases, while a
    // flooding attack is clipped to the weight of one ordinary sentence.
    // The asymmetry is the point: this band has to be cheap to be wrong in,
    // or it will be tuned off the first time it inconveniences someone.
    [TRUST_LEVELS.CONSTRAINED]: { evidenceBudget: 4,        mayWriteFacts: false, mayMutateState: true,  mayTriggerAction: true },
    [TRUST_LEVELS.QUARANTINED]: { evidenceBudget: 0,        mayWriteFacts: false, mayMutateState: false, mayTriggerAction: false },
    [TRUST_LEVELS.REJECTED]:    { evidenceBudget: 0,        mayWriteFacts: false, mayMutateState: false, mayTriggerAction: false }
});

/**
 * Builds the envelope from whatever fired. The level is the STRICTEST any
 * single sensor argued for — risk does not average out.
 *
 * @param {RiskSignal[]} signals
 * @returns {TrustEnvelope}
 */
export function envelopeFrom(signals) {
    const fired = Array.isArray(signals) ? signals.slice() : [];
    if (fired.length === 0) return trustedEnvelope();

    let level = TRUST_LEVELS.TRUSTED;
    for (const s of fired) level = strictest(level, s.level);

    fired.sort((a, b) => ORDER.indexOf(b.level) - ORDER.indexOf(a.level));
    const caps = CAPABILITIES[level];

    return {
        level,
        signals: fired,
        ...caps,
        rationale: `${level}: ${fired.map((s) => s.kind).join(', ')}`
    };
}

/**
 * The compact projection that belongs in a TraceEvent. The full signal list
 * carries measurements that are useful live and noise a week later; the trace
 * keeps the verdict and the names, which is what a reader actually needs.
 * @param {TrustEnvelope} envelope
 */
export function traceProjection(envelope) {
    if (!envelope) return null;
    return {
        level: envelope.level,
        kinds: envelope.signals.map((s) => s.kind),
        evidenceBudget: Number.isFinite(envelope.evidenceBudget) ? envelope.evidenceBudget : null
    };
}

/**
 * Adds a signal to an existing envelope.
 *
 * THE INVARIANT THIS EXISTS TO PRESERVE: an envelope can only ever get
 * STRICTER as a turn progresses. Never looser.
 *
 * That matters because two of the sensors cannot run at admission time —
 * `state_leverage` needs the belief delta the turn would produce, and
 * `fact_contradiction` needs the stored value. Letting the guards that CAN
 * see those inputs raise the verdict keeps the "one decision point" property
 * where it counts: no code downstream of admission can widen what a turn is
 * allowed to do. Everything downstream can only narrow it.
 *
 * Monotonicity falls out of `envelopeFrom` taking the strictest level over a
 * list that only ever grows, so it holds by construction rather than by
 * discipline. `trust-boundary.test.mjs` pins it anyway.
 *
 * @param {TrustEnvelope} envelope
 * @param {RiskSignal|null} signal
 * @returns {TrustEnvelope}
 */
export function escalate(envelope, signal) {
    if (!signal) return envelope;
    const base = envelope && Array.isArray(envelope.signals) ? envelope.signals : [];
    return envelopeFrom([...base, signal]);
}
