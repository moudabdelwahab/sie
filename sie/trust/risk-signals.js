/**
 * risk-signals.js
 * ------------------------------------------------------------
 * المجسّات — the sensors behind the trust boundary.
 *
 * ------------------------------------------------------------
 * THE DESIGN RULE THIS FILE OBEYS
 *
 * A sensor here may measure one of two things:
 *
 *   (a) a STRUCTURE the text has     — line-anchored speaker labels,
 *                                      control-token markup, size;
 *   (b) a STATISTIC of the turn      — how many distinct signals it carries,
 *                                      how far it would move belief.
 *
 * What a sensor may NOT do is enumerate the ways an attack can be phrased.
 * That distinction is the whole point, so it is worth being exact about it,
 * because two of the sensors below do contain word lists and a reader is
 * right to be suspicious of them.
 *
 * The word lists here name WHAT THE TEXT IS ABOUT, not HOW AN ATTACK IS
 * WORDED:
 *
 *   - SPEAKER_ROLES names who a line claims to be speaking. The set of
 *     speakers in a support conversation is small, stable and enumerable.
 *   - SYSTEM_SELF_REFERENTS names the assistant's own configuration — its
 *     instructions, rules, prompt, role. Again small, stable, enumerable.
 *   - PRIVILEGE_ROLES names roles that, if believed, would change what is
 *     allowed. Small, stable, enumerable.
 *
 * Contrast a phrase list: "ignore previous instructions", "disregard the
 * above", "forget everything"... that set is unbounded and the attacker
 * picks from it. The sets here are bounded and the DOMAIN picks them.
 *
 * And they are not load-bearing. An attack that avoids every word in this
 * file still has to move belief to be an attack, and the effect-based
 * checks — `signal_flood`, `domain_spray`, `state_leverage` — do not read
 * words at all. The lexical sensors buy early, cheap, explainable warning;
 * the statistical ones are the floor.
 *
 * ------------------------------------------------------------
 * CALIBRATION IS MEASURED, NOT GUESSED
 *
 * Every numeric threshold below was set from an observed distribution. The
 * reference corpus is 345 distinct Arabic strings extracted from the
 * repository's own test files (excluding sie/trust/tests, which holds the
 * ATTACK corpus) plus the small-talk baseline fixture — the closest thing
 * available here to a sample of real customer phrasing. Measured over that
 * corpus, after full normalization and evidence extraction:
 *
 *   distinct evidence tokens   p50=2   p90=6   p95=7   p99=9   max=12
 *   total evidence weight      p50=1.8 p90=4.8 p95=6.2 p99=8.4 max=11
 *   distinct entity_* tokens   p50=0   p90=1   p95=1   p99=2   max=2
 *   message length (chars)     p50=16  p90=52  p95=68  p99=103 max=171
 *   scenarios crossing 0.6     p50=1   p90=2   p95=3   p99=11  max=11
 *
 * Thresholds sit above the observed MAXIMUM, not at a percentile of it. A
 * sensor that fires on the loudest real message in the corpus is a sensor
 * that will fire on customers all day.
 *
 * ------------------------------------------------------------
 * A CORRECTION, LEFT VISIBLE ON PURPOSE
 *
 * The first calibration of this file was wrong, and the way it was wrong is
 * worth keeping in front of whoever tunes it next.
 *
 * The corpus was extracted with `grep -E "[\u0600-\u06FF]"`. GNU grep does
 * not support \uXXXX escapes, so that bracket expression matched the literal
 * ASCII characters \, u, 0-6 and F — not Arabic. The resulting "corpus" of
 * 1,077 "messages" was mostly English test titles and code fragments, and
 * every threshold derived from it was calibrated against noise. It looked
 * entirely convincing: it had a plausible size, plausible percentiles, and it
 * produced a 0% false-positive rate.
 *
 * What exposed it was not review but a contradiction: an end-to-end test
 * failed with 11 scenarios crossing the resolution threshold, on a message
 * the corpus claimed could reach at most 5. A measurement that disagrees with
 * a real execution is wrong, whatever its percentiles look like.
 *
 * The lesson for this file specifically: the thresholds here are only as good
 * as the corpus behind them, a corpus can be silently empty of the thing it
 * claims to sample, and the only way to catch that is to check it against a
 * case observed some other way. The numbers above have been checked that way.
 * Numbers that replace them should be too.
 *
 * LIMIT OF THIS CALIBRATION, STATED PLAINLY: the corpus is still test-suite
 * text, not production traffic. It under-represents long messages and
 * contains no pasted logs. Any false-positive rate quoted from it should be
 * read as "measured against this corpus". Re-deriving these numbers from real
 * traces is open work, and `observeOnly` mode exists to make it possible.
 */
import { normalizeArabicText } from '../language/dialect-normalizer.js';
import { RISK_KINDS, TRUST_LEVELS } from './trust-types.js';

// ------------------------------------------------------------
// Thresholds. Each carries the observed maximum it clears.

/** Distinct evidence tokens. Observed max in a real message: 12 (p99=9). */
const FLOOD_CONSTRAIN = 18;
const FLOOD_QUARANTINE = 30;

/** Distinct entity_* tokens — how many product areas one message names.
 *  Observed max: 2, and p90 is 1. A customer has one problem. A message
 *  naming five subsystems is not describing it, it is probing the catalog. */
const SPRAY_CONSTRAIN = 5;
const SPRAY_QUARANTINE = 8;

/** Characters. Observed max in the corpus: 171, but the corpus contains no
 *  pasted logs, and pasting a log is legitimate support behaviour. The
 *  constrain threshold is therefore set at the size of a long paste, and the
 *  reject threshold at one channel message (Telegram's own limit is 4096) —
 *  past which the text was not typed by a person at a keyboard. */
const SIZE_CONSTRAIN = 2000;
const SIZE_REJECT = 8000;

/** Line count. A message of 60+ lines is a document, not a question. */
const LINES_CONSTRAIN = 40;

// ------------------------------------------------------------
// Bounded vocabularies. See the header for why these are not phrase lists.

/** Who a line claims to be speaking. Folded forms (alef/ya/ta-marbuta
 *  unified, diacritics stripped) so spelling variants collapse. */
const SPEAKER_ROLES = new Set([
    // en
    'system', 'assistant', 'bot', 'agent', 'support', 'admin', 'operator',
    'ai', 'model', 'chatbot', 'human', 'user', 'customer', 'developer',
    // ar (folded)
    'النظام', 'نظام', 'المساعد', 'مساعد', 'البوت', 'بوت', 'الوكيل',
    'الدعم', 'المسؤول', 'المشرف', 'الاداره', 'الموظف', 'الذكاء',
    'العميل', 'المستخدم', 'انا', 'انت'
]);

/** Roles whose label, if it were believed, would change what is permitted.
 *  ACCOUNT ownership is deliberately absent: "انا صاحب الحساب" / "I'm the
 *  account owner" is ordinary, common and true most of the time. What is
 *  listed here is privilege over the SYSTEM, which no customer has. */
const PRIVILEGE_ROLES = new Set([
    'admin', 'administrator', 'superuser', 'root', 'moderator', 'staff',
    'developer', 'engineer', 'sysadmin', 'owner',
    'ادمن', 'المسؤول', 'مسؤول', 'المشرف', 'مشرف', 'مطور', 'المطور',
    'مبرمج', 'المبرمج', 'مهندس', 'الاداره', 'ادارة', 'الشركه', 'المالك'
]);

/** First-person identity openers — "I am", "we are", "this is". */
const FIRST_PERSON = new Set([
    'i', 'im', 'iam', 'we', 'were', 'me', 'this',
    'انا', 'احنا', 'نحن', 'معاك', 'معك', 'هنا'
]);

/** The assistant's own configuration. Legitimate support traffic is about
 *  the PRODUCT — passwords, invoices, the API. It is essentially never
 *  about the assistant's instructions or rules. That asymmetry is what
 *  makes this set discriminative without being a phrase list.
 *
 *  ONLY UNAMBIGUOUS FORMS GO HERE. Measuring against the reference corpus
 *  showed bare 'prompt' and 'instructions' firing on ordinary English —
 *  a UI prompt and a set of instructions are both real support topics. The
 *  ambiguous nouns moved to the bigram set below, where a possessive or a
 *  system qualifier disambiguates them.
 *
 *  Arabic needs no bigram: its possessive suffix does the work inside the
 *  word. تعليماتك IS "your instructions" — one token, unambiguous. That is
 *  a genuine morphological advantage here, not an accident of the list. */
const SYSTEM_SELF_REFERENTS = new Set([
    'ruleset', 'sysprompt', 'systemprompt', 'preprompt', 'jailbreak',
    'تعليماتك', 'تعليماتة', 'تعليماته', 'برمجتك', 'برمجته',
    'قواعدك', 'دورك', 'شخصيتك', 'اوامرك', 'توجيهاتك'
]);

/** The ambiguous nouns, paired with what disambiguates them. A qualifier
 *  ("your", "system", "previous") turns a product topic into a reference to
 *  the engine itself. Stored as qualifier -> nouns, matched on adjacent
 *  folded words. */
const SELF_REFERENT_QUALIFIERS = new Set([
    'system', 'your', 'previous', 'original', 'above', 'initial', 'default',
    'النظام', 'السابقه', 'الاصليه', 'الاساسيه'
]);
const SELF_REFERENT_NOUNS = new Set([
    'prompt', 'prompts', 'instructions', 'instruction', 'rules', 'rule',
    'guidelines', 'directives', 'programming', 'persona', 'role', 'training',
    'message', 'config', 'configuration',
    'التعليمات', 'القواعد', 'الاوامر', 'التوجيهات', 'الاعدادات'
]);

/** Verbs that act ON something rather than describe it. Used only to
 *  ESCALATE a self-referent hit, never to fire on its own — "reset" and
 *  "تجاهل" are perfectly ordinary words about a product. */
const IMPERATIVE_CLASS = new Set([
    'ignore', 'disregard', 'forget', 'override', 'bypass', 'reset',
    'pretend', 'act', 'roleplay', 'simulate', 'reveal', 'print', 'repeat',
    'output', 'disable', 'unlock', 'jailbreak',
    'تجاهل', 'انسي', 'اهمل', 'تخطي', 'الغي', 'اعد', 'تصرف', 'افترض',
    'اظهر', 'اطبع', 'كرر', 'عطل', 'افتح', 'غير', 'استبدل'
]);

/** Chat-markup control tokens. Nothing a customer types at a keyboard.
 *  Matched structurally (delimiter + role), not as fixed strings. */
const CONTROL_MARKUP = /(<\|[^|>]{1,40}\|>|\{\{\s*\w{1,20}\s*\}\}|\[\/?(?:INST|SYS|SYSTEM|ASSISTANT|USER)\]|^#{2,}\s*(?:system|assistant|user)\b)/mi;

/** A line that opens with a short label and a colon: "System: ...".
 *  Length-bounded so ordinary prose with a colon ("المشكلة: مش شغال")
 *  is still a candidate but a paragraph containing a colon is not. */
const LABELLED_LINE = /^[\s>*_\-\[\("']{0,6}([\p{L}\p{N} ]{1,24}?)[\s]*[:：][\s]/u;

// ------------------------------------------------------------

function fold(word) {
    return normalizeArabicText(String(word)).replace(/\s+/g, '');
}

/** Folded word list of a string, for set lookups only. */
function foldedWords(text) {
    return normalizeArabicText(String(text || '')).split(' ').filter(Boolean);
}

function signal(kind, level, observed, threshold, detail) {
    return { kind, level, observed, threshold, detail };
}

// ------------------------------------------------------------
// STRUCTURAL SENSORS — read the shape of the raw text.

/**
 * Size. The engine has no input cap of its own anywhere upstream of this
 * point, which makes every downstream cost a function of what the sender
 * chose to send. This sensor is the cap.
 *
 * @param {string} rawText
 * @returns {import('./trust-types.js').RiskSignal|null}
 */
export function detectOversizedInput(rawText) {
    const text = String(rawText || '');
    if (text.length >= SIZE_REJECT) {
        return signal(RISK_KINDS.OVERSIZED_INPUT, TRUST_LEVELS.REJECTED, text.length, SIZE_REJECT,
            `${text.length} chars — beyond one channel message; not typed by a person`);
    }
    if (text.length >= SIZE_CONSTRAIN) {
        return signal(RISK_KINDS.OVERSIZED_INPUT, TRUST_LEVELS.CONSTRAINED, text.length, SIZE_CONSTRAIN,
            `${text.length} chars — long paste, processed but bounded`);
    }
    const lines = text.split('\n').length;
    if (lines >= LINES_CONSTRAIN) {
        return signal(RISK_KINDS.OVERSIZED_INPUT, TRUST_LEVELS.CONSTRAINED, lines, LINES_CONSTRAIN,
            `${lines} lines — a document, not a question`);
    }
    return null;
}

/**
 * Text that attributes utterances to a speaker who is not the sender.
 *
 * GRADED ON PURPOSE. Pasting an earlier conversation with support is
 * ordinary customer behaviour — "الدعم: قالولي كذا" is someone showing
 * their evidence, not forging system voice. So one label constrains and
 * does not block; a full alternating transcript quarantines; and chat
 * control markup, which no keyboard produces, is rejected outright.
 *
 * @param {string} rawText
 * @returns {import('./trust-types.js').RiskSignal|null}
 */
export function detectTranscriptMimicry(rawText) {
    const text = String(rawText || '');
    if (!text) return null;

    if (CONTROL_MARKUP.test(text)) {
        return signal(RISK_KINDS.TRANSCRIPT_MIMICRY, TRUST_LEVELS.REJECTED, 1, 0,
            'chat control markup in a customer message');
    }

    const roles = new Set();
    let labelled = 0;
    for (const line of text.split('\n')) {
        const m = LABELLED_LINE.exec(line);
        if (!m) continue;
        labelled += 1;
        for (const w of foldedWords(m[1])) {
            if (SPEAKER_ROLES.has(w)) roles.add(w);
        }
    }

    if (roles.size === 0) return null;

    if (roles.size >= 2 && labelled >= 3) {
        return signal(RISK_KINDS.TRANSCRIPT_MIMICRY, TRUST_LEVELS.QUARANTINED, roles.size, 2,
            `forged dialogue: ${labelled} labelled lines across speakers [${[...roles].join(', ')}]`);
    }
    return signal(RISK_KINDS.TRANSCRIPT_MIMICRY, TRUST_LEVELS.CONSTRAINED, roles.size, 1,
        `speaker label "${[...roles][0]}" — quoted conversation, treated as hearsay`);
}

/**
 * Text whose subject is the assistant's own configuration.
 *
 * The self-referent noun carries the signal; the imperative only escalates.
 * That ordering is deliberate: "reset" is an ordinary product word and
 * firing on it would punish "عايز اعمل reset للباسورد". "reset your rules"
 * is not ambiguous.
 *
 * @param {string} rawText
 * @returns {import('./trust-types.js').RiskSignal|null}
 */
export function detectSystemDirective(rawText) {
    const words = foldedWords(rawText);
    if (words.length === 0) return null;

    const hits = words.filter((w) => SYSTEM_SELF_REFERENTS.has(w));
    for (let i = 0; i < words.length - 1; i++) {
        if (SELF_REFERENT_QUALIFIERS.has(words[i]) && SELF_REFERENT_NOUNS.has(words[i + 1])) {
            hits.push(`${words[i]} ${words[i + 1]}`);
        }
    }
    if (hits.length === 0) return null;

    const imperative = words.some((w) => IMPERATIVE_CLASS.has(w));
    if (imperative) {
        return signal(RISK_KINDS.DIRECTIVE_AT_SYSTEM, TRUST_LEVELS.QUARANTINED, hits.length, 1,
            `acts on the engine's own configuration: "${hits[0]}"`);
    }
    return signal(RISK_KINDS.DIRECTIVE_AT_SYSTEM, TRUST_LEVELS.CONSTRAINED, hits.length, 1,
        `refers to the engine's own configuration: "${hits[0]}"`);
}

/**
 * A claim of privilege over the system.
 *
 * This sensor does not exist to punish the claim. Nothing downstream of
 * here reads a role out of message text in the first place — authority comes
 * from the channel's resolved identity and, for the admin surface, from
 * `user.profile.role` in the database. The claim is therefore already inert.
 *
 * What the sensor buys is VISIBILITY: a turn that asserts privilege is worth
 * seeing in the trace, and worth not letting write facts, because the next
 * sentence is usually the one that matters. CONSTRAINED, never blocked —
 * a frustrated customer saying "انا صاحب الشركة" deserves an answer.
 *
 * @param {string} rawText
 * @returns {import('./trust-types.js').RiskSignal|null}
 */
export function detectAuthorityClaim(rawText) {
    const words = foldedWords(rawText);
    for (let i = 0; i < words.length; i++) {
        if (!FIRST_PERSON.has(words[i])) continue;
        // Within a short window, because "انا مش عارف ادخل، المشرف قالي..."
        // is a customer quoting someone else, not claiming to be them.
        for (let j = i + 1; j <= Math.min(i + 3, words.length - 1); j++) {
            if (PRIVILEGE_ROLES.has(words[j])) {
                return signal(RISK_KINDS.AUTHORITY_CLAIM, TRUST_LEVELS.CONSTRAINED, 1, 0,
                    `asserts privileged role "${words[j]}" — identity comes from the channel, not from text`);
            }
        }
    }
    return null;
}

// ------------------------------------------------------------
// STATISTICAL SENSORS — read the turn's shape in evidence space.
// These read no words at all, which is why they are the floor under the
// lexical sensors rather than a supplement to them.

/**
 * @param {Array<{token: string}>} evidence this turn's extracted evidence
 * @returns {import('./trust-types.js').RiskSignal|null}
 */
export function detectSignalFlood(evidence) {
    const distinct = new Set((evidence || []).map((e) => e.token)).size;
    if (distinct >= FLOOD_QUARANTINE) {
        return signal(RISK_KINDS.SIGNAL_FLOOD, TRUST_LEVELS.QUARANTINED, distinct, FLOOD_QUARANTINE,
            `${distinct} distinct signals — ${(distinct / 12).toFixed(1)}x the loudest real message measured`);
    }
    if (distinct >= FLOOD_CONSTRAIN) {
        return signal(RISK_KINDS.SIGNAL_FLOOD, TRUST_LEVELS.CONSTRAINED, distinct, FLOOD_CONSTRAIN,
            `${distinct} distinct signals — above the observed range (max 12)`);
    }
    return null;
}

/**
 * REMOVED SENSOR — `repetition_pump`, and why it is not here.
 *
 * This sensor was designed, implemented, calibrated, and then deleted after
 * measuring what it actually defended. The measurement is worth keeping,
 * because the reasoning generalises: a sensor is only worth its false
 * positives if the attack it stops can achieve something.
 *
 * Repeating a token cannot. `evidence-accumulator.js` combines repeated
 * observations with noisy-OR, which saturates almost immediately. Measured
 * directly, for an Arabic-source token (base weight 0.8):
 *
 *      1x -> 0.8000    2x -> 0.9600    3x -> 0.9920
 *      5x -> 0.9997   10x -> 1.0000   50x -> 1.0000
 *
 * The entire payoff from repetition is +0.20 presence, 80% of it delivered by
 * the SECOND occurrence, and the curve is flat by the third. For a glossary-
 * matched token (base weight 1.0) the payoff is exactly zero — one occurrence
 * already saturates.
 *
 * So the sensor could only have fired on repetitions that had already stopped
 * paying, while its threshold sat above two phrasings that are entirely
 * ordinary: a customer pasting a log with repeated lines, and a frustrated
 * customer typing "مش شغال مش شغال". Both were observed firing in the
 * adversarial corpus.
 *
 * The defence against repetition is the accumulator's own arithmetic. It is
 * unconditional, it cannot be evaded, and it needs no detector. Adding one on
 * top would have bought ~0.008 of presence protection and paid for it in
 * false positives — which is the definition of security theatre.
 *
 * If the accumulator is ever changed to a linear or additive combiner, this
 * reasoning expires and the sensor should come back. That is the condition to
 * watch, and it is why this comment is here rather than in a commit message.
 */

/**
 * Signals sprayed across unrelated product areas. A customer has one
 * problem; entity breadth is the cheapest measure of whether the message is
 * describing it or probing for whatever sticks.
 *
 * @param {Array<{token: string}>} evidence
 * @returns {import('./trust-types.js').RiskSignal|null}
 */
export function detectDomainSpray(evidence) {
    const entities = new Set();
    for (const e of evidence || []) {
        if (typeof e.token === 'string' && e.token.startsWith('entity_')) entities.add(e.token);
    }
    const n = entities.size;
    if (n >= SPRAY_QUARANTINE) {
        return signal(RISK_KINDS.DOMAIN_SPRAY, TRUST_LEVELS.QUARANTINED, n, SPRAY_QUARANTINE,
            `${n} product areas named at once — observed max in a real message is 2`);
    }
    if (n >= SPRAY_CONSTRAIN) {
        return signal(RISK_KINDS.DOMAIN_SPRAY, TRUST_LEVELS.CONSTRAINED, n, SPRAY_CONSTRAIN,
            `${n} product areas named at once — above the observed range`);
    }
    return null;
}

// ------------------------------------------------------------
// CONTEXTUAL SENSORS — need state the admission point does not hold.
// Constructed here so every signal in the system is built in one place,
// but fired from the guards that can actually see their inputs.

/**
 * A proposed fact that disagrees with one already stored. Fired by the
 * fact guard, which is the only place that holds both values.
 *
 * Contradiction is NOT by itself an attack — people change their email.
 * It is a reason to require a fresh, deliberate turn rather than letting a
 * passing mention overwrite something the engine will act on later.
 */
export function factContradictionSignal({ key, stored, proposed }) {
    return signal(RISK_KINDS.FACT_CONTRADICTION, TRUST_LEVELS.CONSTRAINED, 1, 0,
        `"${key}" would change from "${String(stored).slice(0, 24)}" to "${String(proposed).slice(0, 24)}"`);
}

/**
 * EFFECT-BASED, and the most important sensor here.
 *
 * It asks a question no amount of rephrasing can dodge: would THIS ONE TURN,
 * on its own, carry a scenario from below the decision threshold to above
 * it? Real diagnosis accumulates — a customer describes, the engine asks, the
 * customer confirms. A single turn that settles the matter by itself is
 * either a perfectly matched signature or someone who has worked out what
 * the signature is.
 *
 * Either way the correct response is the same and it is not to refuse: it is
 * to require one more turn's worth of agreement before acting.
 */
export function stateLeverageSignal({ scenarioId, before, after, threshold }) {
    return signal(RISK_KINDS.STATE_LEVERAGE, TRUST_LEVELS.CONSTRAINED, Number(after.toFixed(3)), threshold,
        `one turn moves "${scenarioId}" ${before.toFixed(2)} -> ${after.toFixed(2)}, across the ${threshold} threshold`);
}

/** Exposed for tests and for anyone re-deriving the thresholds from real traffic. */
export const THRESHOLDS = Object.freeze({
    FLOOD_CONSTRAIN, FLOOD_QUARANTINE,
    SPRAY_CONSTRAIN, SPRAY_QUARANTINE,
    SIZE_CONSTRAIN, SIZE_REJECT, LINES_CONSTRAIN
});
