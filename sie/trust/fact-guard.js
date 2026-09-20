/**
 * fact-guard.js
 * ------------------------------------------------------------
 * CHECKPOINT 3 — authorizes writes to durable customer memory.
 *
 * Evidence expires with the session. A stored fact does not: it is read back
 * on every future conversation and quoted into replies. That asymmetry is why
 * facts get their own checkpoint rather than riding on the evidence budget —
 * the blast radius of a bad fact is measured in weeks, not turns.
 *
 * Three rules, in order of how much they matter:
 *
 *   1. CLOSED KEY VOCABULARY. The set of things the engine will remember is
 *      fixed in code. Without this, the key is attacker-chosen, and a store
 *      whose keys are attacker-chosen is a store whose SCHEMA is attacker-
 *      chosen — the durable version of state poisoning.
 *   2. NO WRITES BELOW TRUSTED. A turn that tripped any sensor may still be
 *      answered; it may not leave anything behind.
 *   3. CONTRADICTION NEEDS A FRESH TURN. Overwriting a stored value is not
 *      forbidden — people do change their email — but it may not happen as a
 *      side effect of a turn that is doing something else.
 */
import { factContradictionSignal } from './risk-signals.js';
import { escalate } from './trust-types.js';

/**
 * Every key the engine will ever store, matching what memory-intent.js
 * actually produces. Adding one is a deliberate code change, reviewed — which
 * is the entire security property.
 */
export const ALLOWED_FACT_KEYS = Object.freeze(['name', 'role', 'company', 'note']);

/** A stored value is quoted back to the customer later; cap it there, not
 *  at the database boundary, so the limit is visible where the risk is. */
const MAX_VALUE_LENGTH = 500;

/**
 * @param {Array<{key: string, value: string}>} proposed
 * @param {import('./trust-types.js').TrustEnvelope} envelope
 * @param {Object} [context]
 * @param {Map<string,string>|Object} [context.storedFacts] what is on record now
 * @returns {{facts: Array, envelope: Object, rejected: Array<{key: string, reason: string}>}}
 */
export function guardFacts(proposed, envelope, { storedFacts = null } = {}) {
    const incoming = Array.isArray(proposed) ? proposed : [];
    const rejected = [];
    let env = envelope;

    if (!env.mayWriteFacts) {
        for (const f of incoming) rejected.push({ key: f?.key, reason: `trust level ${env.level}` });
        return { facts: [], envelope: env, rejected };
    }

    const lookup = storedFacts instanceof Map
        ? (k) => storedFacts.get(k)
        : (k) => (storedFacts && typeof storedFacts === 'object' ? storedFacts[k] : undefined);

    const facts = [];
    for (const f of incoming) {
        if (!f || typeof f.key !== 'string' || typeof f.value !== 'string') {
            rejected.push({ key: f?.key, reason: 'malformed' });
            continue;
        }
        if (!ALLOWED_FACT_KEYS.includes(f.key)) {
            rejected.push({ key: f.key, reason: 'key outside the closed vocabulary' });
            continue;
        }
        const value = f.value.slice(0, MAX_VALUE_LENGTH);
        const stored = lookup(f.key);
        if (typeof stored === 'string' && stored !== '' && stored !== value) {
            env = escalate(env, factContradictionSignal({ key: f.key, stored, proposed: value }));
            rejected.push({ key: f.key, reason: 'contradicts a stored value; needs a deliberate turn' });
            continue;
        }
        facts.push({ key: f.key, value });
    }

    // A contradiction may have escalated the envelope past the point where
    // writing is allowed at all. Re-check rather than trusting the earlier read.
    if (!env.mayWriteFacts && facts.length > 0) {
        for (const f of facts) rejected.push({ key: f.key, reason: `trust level ${env.level} after escalation` });
        return { facts: [], envelope: env, rejected };
    }
    return { facts, envelope: env, rejected };
}
