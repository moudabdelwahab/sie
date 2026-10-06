/**
 * lexicon-match.js — how Layer 1 matches a phrase list against a message.
 * ------------------------------------------------------------
 * Every conversational detector (small talk, emotion, resolution, memory,
 * reply polarity) used to ask `text.includes(phrase)`. A substring is not a
 * word, and the audit found the consequences in production:
 *
 *   «انصب» (install) contains «نصب» (fraud)        → anger → hand-off to a human
 *   «مشكلة» (problem) contains «مش» (not)          → "yes" read as a decline
 *   «ما اشتغلش» (it didn't work) contains «اشتغل»  → "glad it's sorted"
 *
 * This module is the one place those rules live, so every detector gets the
 * same three guarantees:
 *
 *   G-L1-1  a phrase matches only as whole words — never inside a longer word.
 *           The only allowance is the attached conjunction «و»/«ف» on the
 *           phrase's first word («وشكرا»), which is how Arabic is written.
 *   G-L1-2  a match inside a negation scope is reported as negated. A scope
 *           opens at a negator («مش، ما، مفيش، لا، لم، not, didn't…») and
 *           closes at the next clause boundary («و، بس، لكن», punctuation) or
 *           after NEGATION_WINDOW words. Egyptian «ما…ش» fused into one word
 *           («ماشتغلش») is a negated word on its own.
 *   —       a match in a clause that ends with «?» / «؟» is a question, not an
 *           assertion («حلت المشكلة؟» does not say it was solved).
 *
 * Pure, synchronous, no I/O. Deterministic for any input.
 */

/** Tashkeel, tatweel, alef/ya/ta-marbuta variants, and stretched letters folded away. */
export function foldForMatch(text) {
    return String(text ?? '')
        .replace(/[ً-ْٰ]/g, '')   // tashkeel and tanween
        .replace(/ـ/g, '')                    // tatweel
        .replace(/[أإآٱ]/g, 'ا')
        .replace(/ى/g, 'ي')
        .replace(/ة/g, 'ه')
        .replace(/['’]/g, '')                   // didn't → didnt
        .toLowerCase();
}

/** «مرحبااااا» → «مرحبا»: three or more of the same letter is emphasis, not spelling. */
function collapseStretch(word) {
    return word.replace(/(\p{L})\1{2,}/gu, '$1');
}

const PUNCT = /^[.,،!؟?؛;:\n]$/;
const QUESTION = /^[؟?]$/;

/**
 * Splits a message into word and punctuation tokens.
 * @param {string} text
 * @returns {Array<{t: string, punct: boolean}>}
 */
export function tokenizeForMatch(text) {
    const folded = foldForMatch(text);
    const out = [];
    for (const m of folded.matchAll(/[\p{L}\p{N}]+|[.,،!؟?؛;:\n]/gu)) {
        const raw = m[0];
        out.push(PUNCT.test(raw) ? { t: raw, punct: true } : { t: collapseStretch(raw), punct: false });
    }
    return out;
}

/** Words that open a negation scope. Folded forms. */
export const NEGATORS = Object.freeze(new Set([
    'مش', 'ما', 'مفيش', 'مافيش', 'لا', 'لم', 'لن', 'ليس', 'مابقاش', 'مبقاش', 'ولا', 'بدون',
    'not', 'no', 'never', 'dont', 'didnt', 'doesnt', 'isnt', 'wasnt', 'cant', 'cannot', 'wont'
]));

/**
 * «لا» reaches one word: «لا يعمل» is negation, but «لا خلاص اشتغلت» is an
 * interjection ("no — it's fine, it worked") followed by an assertion.
 */
const SHORT_SCOPE = Object.freeze(new Map([['لا', 1], ['no', 1]]));

/**
 * «ما» after these words is a conjunction, not a negation: «بعد ما غيرت
 * الإعدادات اشتغل» says it worked. Nor in «ما شاء الله».
 */
const MA_CONJUNCTION_BEFORE = new Set(['بعد', 'قبل', 'زي', 'كل', 'اول', 'لحد', 'طول', 'عشان', 'لغايه', 'يوم', 'ساعه', 'وقت']);
const MA_NOT_NEGATION_AFTER = new Set(['شاء']);

/** Words that close a clause (and therefore a negation scope). */
export const CLAUSE_WORDS = Object.freeze(new Set(['و', 'بس', 'لكن', 'ولكن', 'بعدين', 'but', 'and', 'then']));

/**
 * Words that open a conditional or temporal clause. A phrase inside one is
 * not asserted: «لما اشتغل على الموبايل بيقفل» ("when I work on mobile it
 * closes") does not say anything worked.
 */
const CONDITIONALS = new Set(['لما', 'لو', 'اذا', 'when', 'if']);
/** «لو سمحت» is "please", not a condition. */
const NOT_CONDITIONAL_BEFORE = new Set(['سمحت', 'سمحتي', 'سمحتو', 'سمحتم', 'تكرمت']);

/** How many words a negation reaches when no boundary closes it sooner. */
export const NEGATION_WINDOW = 4;

/** Egyptian circumfix negation fused into one word: «ماشتغلش», «مانفعش», «مبيشتغلش». */
export function isFusedNegative(word) {
    return word.length >= 4 && /^م/.test(word) && /ش$/.test(word) && !NOT_FUSED.has(word);
}

/** Words shaped م…ش that are not negations. */
const NOT_FUSED = new Set(['معلش', 'معليش', 'مدهش', 'منعش', 'مشمش', 'معاش', 'مفتش', 'مشوش', 'مغشوش', 'متوحش', 'منقوش', 'منكمش', 'مرعش']);

const SPLIT_NEGATORS = new Set(['ما', 'مش']);
const stripConjunction = (w) => (w && w.length > 2 && (w.startsWith('و') || w.startsWith('ف')) ? w.slice(1) : w);

/**
 * The positive words a negated form stands for, so «ما اشتغلش» and
 * «ماشتغلش» are found by a lexicon that lists «اشتغل» — as NEGATED hits.
 *   «ماشتغلش» → «اشتغل» (م…ش), «شتغل» (ما…ش)
 *   «اشتغلش» after «ما»/«مش» → «اشتغل»
 */
function negatedBases(word, previous) {
    const bases = [];
    if (isFusedNegative(word)) {
        bases.push(word.slice(1, -1));
        if (word.startsWith('ما')) bases.push(word.slice(2, -1));
    } else if (word.length >= 4 && word.endsWith('ش') && SPLIT_NEGATORS.has(stripConjunction(previous))) {
        bases.push(word.slice(0, -1));
    }
    return bases.filter((b) => b.length >= 2);
}

/** «ومش», «فمش», «وما» — a conjunction fused to a negator: a new clause that opens negated. */
function cliticNegator(word) {
    return (word.startsWith('و') || word.startsWith('ف')) && NEGATORS.has(word.slice(1)) && word.length > 2;
}

function isNegatorAt(words, j) {
    const w = words[j];
    if (cliticNegator(w)) return true;
    if (!NEGATORS.has(w)) return isFusedNegative(w);
    if (w === 'ما') {
        if (MA_CONJUNCTION_BEFORE.has(words[j - 1])) return false;
        if (MA_NOT_NEGATION_AFTER.has(words[j + 1])) return false;
    }
    return true;
}

/**
 * Pre-computes, for one message, the folded words and, per word index:
 * its clause, whether it lies in a negation scope, whether its clause is a
 * question or a condition, and the positive forms a negated word stands for.
 * Detectors call `analyzeMessage` once and match many phrases.
 */
export function analyzeMessage(text) {
    const tokens = tokenizeForMatch(text);
    const words = [];
    const wordClause = [];
    // A question mark makes its whole sentence a question («اشتغل ولا لا؟»),
    // so sentences (split by punctuation only) are tracked apart from clauses.
    const wordSentence = [];
    const questionSentences = new Set();
    let clause = 0;
    let sentence = 0;
    for (const tok of tokens) {
        if (tok.punct) {
            if (QUESTION.test(tok.t)) questionSentences.add(sentence);
            clause += 1;
            sentence += 1;
            continue;
        }
        if (CLAUSE_WORDS.has(tok.t) || cliticNegator(tok.t) || tok.t === 'ولا') clause += 1;
        words.push(tok.t);
        wordClause.push(clause);
        wordSentence.push(sentence);
    }

    const negatedAt = new Array(words.length).fill(false);
    const conditionalAt = new Array(words.length).fill(false);
    const bases = words.map((w, i) => negatedBases(w, words[i - 1]));
    let hasNegation = false;
    for (let j = 0; j < words.length; j++) {
        const negator = isNegatorAt(words, j);
        const conditional = (CONDITIONALS.has(words[j]) || CONDITIONALS.has(stripConjunction(words[j]))) && !NOT_CONDITIONAL_BEFORE.has(words[j + 1]);
        if (!negator && !conditional) continue;
        if (negator) hasNegation = true;
        const reach = negator ? (SHORT_SCOPE.get(words[j]) ?? NEGATION_WINDOW) : NEGATION_WINDOW;
        for (let k = j + 1; k < words.length && k <= j + reach; k++) {
            if (wordClause[k] !== wordClause[j]) break;
            if (negator) negatedAt[k] = true;
            else conditionalAt[k] = true;
        }
    }

    // Every form a phrase's FIRST word could take here — the word, the word
    // without an attached «و»/«ف», a positive base of a negated form — so
    // findPhrase can skip a phrase that cannot start anywhere in one lookup.
    const starts = new Set(words);
    for (let i = 0; i < words.length; i++) {
        if (/^[وف]./.test(words[i])) starts.add(words[i].slice(1));
        for (const b of bases[i]) starts.add(b);
    }

    return { words, wordClause, wordSentence, questionSentences, negatedAt, conditionalAt, bases, hasNegation, starts };
}

/** A phrase, folded and split into the words it must match. */
export function phraseWords(phrase) {
    return tokenizeForMatch(phrase).filter((tok) => !tok.punct).map((tok) => tok.t);
}

/**
 * Every whole-word occurrence of `phrase` in an analysed message.
 *
 * `negated`   the phrase lies in a negation scope, or one of its words was
 *             found through its negated form («ما اشتغلش» for «اشتغل»).
 * `asserted`  false when the phrase sits in a question or a condition.
 * @returns {Array<{start: number, end: number, negated: boolean, question: boolean, conditional: boolean, asserted: boolean}>}
 */
export function findPhrase(analysis, phrase) {
    const p = Array.isArray(phrase) ? phrase : phraseWords(phrase);
    if (p.length === 0 || (analysis.starts && !analysis.starts.has(p[0]))) return [];
    const { words, wordSentence, questionSentences, negatedAt, conditionalAt, bases } = analysis;
    const hits = [];
    for (let i = 0; i + p.length <= words.length; i++) {
        let ok = true;
        let viaNegatedForm = false;
        let viaConjunction = false;
        for (let k = 0; k < p.length; k++) {
            const w = words[i + k];
            const want = p[k];
            if (w === want) continue;
            // The attached conjunction on the first word only: «وشكرا», «فاشتغلت».
            if (k === 0 && (w === `و${want}` || w === `ف${want}`)) { viaConjunction = true; continue; }
            if (bases[i + k].includes(want)) { viaNegatedForm = true; continue; }
            ok = false;
            break;
        }
        if (!ok) continue;
        // The conjunction opens a new clause, so a negation from before it
        // does not reach the phrase: «مش بيبعت رسايل وهرفع عليكم قضية».
        const negated = viaNegatedForm || (negatedAt[i] && !viaConjunction);
        const question = questionSentences.has(wordSentence[i]);
        const conditional = conditionalAt[i];
        hits.push({ start: i, end: i + p.length, negated, question, conditional, asserted: !question && !conditional });
    }
    return hits;
}

/** The first phrase from `phrases` that occurs (any hit), with its hits. */
export function firstPhrase(analysis, phrases) {
    for (const phrase of phrases) {
        const hits = findPhrase(analysis, phrase);
        if (hits.length) return { phrase, hits };
    }
    return null;
}

// ------------------------------------------------------------
// Diagnostic content (G-L1-3)
// ------------------------------------------------------------

/**
 * Glossary token families that describe a PROBLEM. The conversational
 * families — social_*, trigger_*, emotion_*, behaviour_* (the same four the
 * catalog's integrity test treats as conversational) — describe how
 * something is said, not what is wrong, so they do not count.
 */
const DIAGNOSTIC_FAMILY = /^(entity|symptom|intent|http|qualifier|atom)_/;

/** The families that say something is WRONG or something must be DONE — not merely named. */
const PROBLEM_FAMILY = /^(symptom|intent|http)_/;

/** Whether a normalized token says something is wrong or asks for something to be done. */
export function isProblemToken(token) {
    return typeof token?.canonical === 'string' && PROBLEM_FAMILY.test(token.canonical);
}

/** Whether a normalized token names part of a problem. */
export function isDiagnosticToken(token) {
    return typeof token?.canonical === 'string' && DIAGNOSTIC_FAMILY.test(token.canonical);
}

/** Whether the message carries anything to diagnose. */
export function hasDiagnosticContent(normalizedTokens) {
    return Array.isArray(normalizedTokens) && normalizedTokens.some(isDiagnosticToken);
}

/** Whether the message names a symptom (something is wrong). */
export function hasSymptom(normalizedTokens) {
    return Array.isArray(normalizedTokens) && normalizedTokens.some((t) => typeof t?.canonical === 'string' && t.canonical.startsWith('symptom_'));
}
