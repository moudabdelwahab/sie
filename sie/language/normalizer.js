/**
 * normalizer.js
 * ------------------------------------------------------------
 * Orchestrates the full Language & Normalization pipeline for one
 * customer message. This is the single entry point the rest of the
 * engine (starting with the Diagnostic Engine, in a later module) calls
 * — nothing downstream needs to know about tokenization, glossary
 * matching, dialect folding, or Arabizi resolution individually.
 *
 * Pipeline order (per approved architecture):
 *   1. Tokenize (script-aware, tracks character offsets)
 *   2. Technical-glossary matching FIRST, on the raw text, before any
 *      dialect/Arabizi transformation touches Latin tokens
 *   3. Arabic-script normalization (dialect-normalizer) on tokens NOT
 *      consumed by the glossary
 *   4. Arabizi normalization on Latin/mixed tokens NOT consumed by the
 *      glossary (so "DNS" is never mistaken for Arabizi digits+letters)
 *   5. Response-language policy, evaluated from the classified tokens
 *
 * Providers (technical glossary, Arabizi map) are accepted as
 * dependencies with local-JSON-backed defaults, so this file never knows
 * or cares whether the data behind them is a JSON file today or a
 * Supabase table later.
 */
import { tokenize } from './tokenizer.js';
import { normalizeArabicToken } from './dialect-normalizer.js';
import { decideResponseLanguage } from './response-language-policy.js';
import { technicalGlossaryProvider } from './technical-glossary.local.js';
import { arabiziMapProvider } from './arabizi-map.local.js';

/**
 * The hard bound on how much text one message may put through this pipeline.
 *
 * ------------------------------------------------------------
 * WHY THERE HAS TO BE ONE
 *
 * Before this, there was no input cap anywhere between the channel webhook and
 * the engine — not in the channels, not in the bridge, not here. The cost of a
 * turn was therefore whatever the sender chose to make it, and normalization
 * is superlinear in input length. Measured on this machine with the shipped
 * glossary:
 *
 *      490 chars ->     1.0 ms      2.14 ms/KB
 *    2,450 chars ->     5.8 ms      2.44 ms/KB
 *    9,800 chars ->    29.8 ms      3.11 ms/KB
 *   49,000 chars ->   223.9 ms      4.68 ms/KB
 *  196,000 chars -> 2,696.7 ms     14.09 ms/KB
 *
 * A single 196 KB message burns 2.7 seconds of CPU in this function alone.
 * This engine runs in a Supabase Edge Function with a CPU budget measured in
 * hundreds of milliseconds, so one message like that is a denial of service
 * against every other customer sharing the isolate — no volume required.
 *
 * ------------------------------------------------------------
 * WHY HERE AND NOT IN THE TRUST LAYER
 *
 * sie/trust also measures input size, and rejects above the same 8,000
 * characters. That is a POLICY: it is graded, it is explainable, it reaches the
 * trace, and it can be switched off.
 *
 * This is not a policy. It is a resource bound, and a resource bound that can
 * be switched off is not a bound. The two coexist deliberately — the trust
 * layer decides what an oversized message MEANS, and this decides what it
 * COSTS. If the trust layer is disabled, misconfigured, or bypassed by a new
 * caller that forgets it, this still holds.
 *
 * ------------------------------------------------------------
 * WHY 8,000
 *
 * A real customer message runs to 171 characters at the observed maximum and
 * 103 at p99. One Telegram message is capped at 4,096 by Telegram itself.
 * 8,000 is therefore roughly 47x the longest message ever measured and still
 * leaves room for a customer pasting a stack trace or a webhook payload, which
 * is legitimate and common support behaviour. It costs ~25 ms — an order of
 * magnitude inside the budget.
 *
 * Truncating rather than throwing is deliberate: a customer who pasted too
 * much still has a problem, and the first 8,000 characters of it are almost
 * certainly enough to diagnose. The return value carries `truncated` so
 * nothing downstream has to guess.
 */
export const MAX_INPUT_CHARS = 8000;

function escapeRegExp(str) {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Builds a flat, priority-ordered list of (pattern -> canonical) rules
 * from the glossary entries, longest pattern first, so multi-word
 * phrases like "internal server error" are preferred over shorter
 * overlapping single-word patterns like "error".
 */
function buildGlossaryRules(entries) {
    const rules = [];
    for (const entry of entries) {
        for (const pattern of entry.patterns) {
            rules.push({ pattern, canonical: entry.canonical, labels: entry.labels });
        }
    }
    rules.sort((a, b) => {
        const wordCountDiff = b.pattern.split(/\s+/).length - a.pattern.split(/\s+/).length;
        if (wordCountDiff !== 0) return wordCountDiff;
        return b.pattern.length - a.pattern.length;
    });
    return rules;
}

/**
 * A "word" for boundary purposes: exactly the character class the old
 * lookarounds used, so a span found here begins and ends on precisely the
 * boundaries `(?<![\p{L}\p{N}_])` and `(?![\p{L}\p{N}_])` accepted.
 */
const WORD_RUN = /[\p{L}\p{N}_]+/gu;
const WHITESPACE_ONLY = /^\s+$/;
/** A pattern that is word runs joined by whitespace — nothing else. */
const SIMPLE_PATTERN = /^[\p{L}\p{N}_]+(?:\s+[\p{L}\p{N}_]+)*$/u;

/**
 * فهرس المطابقة: بحث بالكلمة بدل مسح النص بألف regex.
 *
 * WHY THIS REPLACED ONE REGEX PER PATTERN
 *
 * matchGlossary() used to run `regex.exec(text)` once per glossary
 * pattern — 3,224 executions for every customer message. Measured cold,
 * that single loop was ~2.8s of CPU and ~89% of the whole turn, which is
 * what exhausted the edge runtime's budget. Caching the compiled regexes
 * did not help: V8 generates a regex's matcher lazily on first exec, and
 * in production almost every request lands on a cold isolate that only
 * ever makes that first call.
 *
 * The observation that removes the loop: every match must begin and end
 * on a `[\p{L}\p{N}_]` boundary, and 3,213 of the 3,224 patterns are
 * word runs joined by whitespace. Such a pattern can only match a run of
 * whole words of the message. So instead of asking every pattern
 * "are you in this text?", the message offers its own word spans and asks
 * "does any pattern equal this?" — a Map lookup. Cost becomes a function
 * of message length (words × 6) instead of glossary size.
 *
 * The 11 patterns that are not word runs (hyphenated terms like
 * "two-factor", and two carrying Arabic diacritics) keep a real regex.
 * Eleven executions per message is not the loop this replaced.
 *
 * @param {Array<{pattern: string}>} rules already in priority order
 */
function buildGlossaryMatchIndex(rules) {
    const spanIndex = new Map();
    const regexRules = [];
    let maxSpanWords = 1;

    rules.forEach((rule, order) => {
        if (SIMPLE_PATTERN.test(rule.pattern)) {
            const words = rule.pattern.split(/\s+/);
            if (words.length > maxSpanWords) maxSpanWords = words.length;
            // Case folding matches the old 'i' flag. Whitespace runs collapse
            // to one space because the old pattern turned them into `\s+`,
            // which accepts any run.
            const key = words.join(' ').toLowerCase();
            const existing = spanIndex.get(key);
            // Two entries may list the same surface form. Both rules survive,
            // in priority order, exactly as they did in the scan.
            if (existing) existing.push(order);
            else spanIndex.set(key, [order]);
        } else {
            const escaped = escapeRegExp(rule.pattern).replace(/\s+/g, '\\s+');
            regexRules.push({
                order,
                regex: new RegExp(`(?<![\\p{L}\\p{N}_])${escaped}(?![\\p{L}\\p{N}_])`, 'giu')
            });
        }
    });

    return { spanIndex, regexRules, maxSpanWords };
}

/**
 * Scans raw text for non-overlapping glossary matches, longest/most
 * specific pattern wins when patterns overlap.
 *
 * Same result as the old per-pattern scan, reached the other way round:
 * the message's own word spans are looked up in the index, then the
 * winners are replayed in the ORIGINAL rule order through the ORIGINAL
 * claiming rule, so precedence and overlap handling are unchanged.
 *
 * @returns {Array<{start: number, end: number, canonical: string, labels: Object}>}
 */
function matchGlossary(text, rules, matchIndex) {
    const matches = [];
    const consumed = []; // list of [start, end) already claimed

    const overlaps = (start, end) =>
        consumed.some(([cStart, cEnd]) => start < cEnd && end > cStart);

    const { spanIndex, regexRules, maxSpanWords } = matchIndex;

    // Every occurrence found, grouped by the rule that found it. Recorded
    // in ascending start order, which is the order the old left-to-right
    // scan produced them in.
    const occurrences = new Map();
    const record = (order, start, end) => {
        const list = occurrences.get(order);
        if (list) list.push([start, end]);
        else occurrences.set(order, [[start, end]]);
    };

    // ONE pass over the message — the only scan of the text that remains.
    const words = [];
    for (const match of text.matchAll(WORD_RUN)) {
        words.push({ start: match.index, end: match.index + match[0].length, lower: match[0].toLowerCase() });
    }

    for (let i = 0; i < words.length; i++) {
        let key = words[i].lower;
        for (let span = 1; span <= maxSpanWords && i + span <= words.length; span++) {
            if (span > 1) {
                // The old pattern joined its words with `\s+`, so anything
                // but whitespace between two words ends the phrase — and
                // ends it for every longer span from here too.
                const gap = text.slice(words[i + span - 2].end, words[i + span - 1].start);
                if (!WHITESPACE_ONLY.test(gap)) break;
                key += ' ' + words[i + span - 1].lower;
            }
            const orders = spanIndex.get(key);
            if (orders) {
                for (const order of orders) record(order, words[i].start, words[i + span - 1].end);
            }
        }
    }

    for (const { order, regex } of regexRules) {
        // Shared across messages, so lastIndex is reset before scanning.
        regex.lastIndex = 0;
        let match;
        while ((match = regex.exec(text)) !== null) {
            record(order, match.index, match.index + match[0].length);
        }
    }

    // Replay in rule order. Rules with no occurrence contributed nothing to
    // the old scan either, so skipping them changes no outcome.
    for (const order of [...occurrences.keys()].sort((a, b) => a - b)) {
        const rule = rules[order];
        // A /g/ exec never returns a match starting inside the previous one:
        // lastIndex jumps to its end whether or not the match was kept. The
        // cursor reproduces that, so a repeated-word phrase cannot claim a
        // second, shifted span the old scan would never have offered.
        let cursor = -1;
        for (const [start, end] of occurrences.get(order)) {
            if (start < cursor) continue;
            cursor = end;
            if (!overlaps(start, end)) {
                matches.push({ start, end, canonical: rule.canonical, labels: rule.labels });
                consumed.push([start, end]);
            }
        }
    }

    matches.sort((a, b) => a.start - b.start);
    return matches;
}

function isTokenInsideAnyMatch(token, glossaryMatches) {
    return glossaryMatches.some((m) => token.start >= m.start && token.end <= m.end);
}

/**
 * Egyptian Arabic glues single-letter conjunctions and prepositions
 * straight onto the following word ("و" and, "ب" with, "ف" so, "ل" to,
 * "ك" like), optionally on top of the definite article "ال". A customer
 * writing "الموقع ومش بتشتغل" produces the token "ومش", which matches no
 * glossary pattern at all unless the clitic comes off first.
 *
 * Stripping is guided by the glossary's own vocabulary rather than by
 * word length: a prefix comes off only when what remains is a word the
 * glossary actually knows. Length alone cannot decide this — "ومش" (and
 * not) and "وصل" (arrived) are both three letters starting with و, but
 * only the first is a clitic. Checking the remainder against the
 * vocabulary keeps "مش" and rejects "صل", which no length rule could.
 */
const ARABIC_CLITIC_PREFIXES = ['وال', 'بال', 'فال', 'كال', 'لل', 'ال', 'و', 'ب', 'ف', 'ل', 'ك'];

/**
 * @param {string} word
 * @param {Set<string>} vocabulary
 * @param {Object} [options]
 * @param {boolean} [options.trustVocabulary=true] when false, strips even a
 *   word the glossary knows. Only safe as a FALLBACK after an unstripped
 *   lookup has already failed — see the note in foldNormalizedPhrases.
 */
function stripArabicClitic(word, vocabulary, { trustVocabulary = true } = {}) {
    if (!word || !vocabulary) return null;
    // A word the glossary already knows is never re-analysed. Without this
    // guard "بتشتغل" (it works) gets stripped to "تشتغل", which is also a
    // real vocabulary word — so the remainder test alone happily destroys
    // a perfectly good match. Known words are taken at face value; only
    // unknown ones are candidates for carrying a clitic.
    //
    // THE GUARD IS ALSO HOW THIS BROKE. The vocabulary is built from every
    // word of every pattern, so a pattern that happens to contain a
    // clitic-prefixed form puts that form in the vocabulary — and the guard
    // then refuses to strip it anywhere in the engine. Exactly one pattern,
    // `symptom_stuck_loading :: "بيلف ومش بيخلص"`, put "ومش" in the
    // vocabulary, and that single entry stopped 32.2% of Arabic glossary
    // patterns (868 of 2,699) from matching after the conjunction "و" — one
    // of the commonest words in the language.
    //
    // 413 of the 2,430 vocabulary words are clitic-prefixed forms of another
    // vocabulary word, so this is a class, not an incident. The guard is
    // still right by default: "كده" and "الوقت" must be taken at face value.
    // What was wrong was having no fallback when the face value finds nothing.
    if (trustVocabulary && vocabulary.has(word)) return null;
    for (const prefix of ARABIC_CLITIC_PREFIXES) {
        if (!word.startsWith(prefix) || word.length <= prefix.length) continue;
        const remainder = word.slice(prefix.length);
        if (vocabulary.has(remainder)) return remainder;
    }
    return null;
}

/**
 * Index of single-word glossary patterns, keyed by their DIALECT-NORMALIZED
 * form, so one listed spelling covers all of its variants: the pattern
 * "مشكلة" is stored as "مشكله" and therefore also matches a customer who
 * writes "مشكلہ", "مشكلة", or "مشكلللة".
 *
 * This is what lets the glossary reach text the raw-text pass structurally
 * cannot see — Arabizi resolved to Arabic mid-pipeline, and Arabic written
 * with any of the spelling variants the dialect normalizer folds together.
 *
 * @param {Array<{canonical: string, patterns: string[]}>} entries
 * @returns {Map<string, string>} normalized single word -> canonical token
 */
function buildNormalizedWordIndex(entries) {
    const index = new Map();
    for (const entry of entries) {
        for (const pattern of entry.patterns) {
            if (/\s/.test(pattern)) continue; // multi-word handled by the phrase pass
            if (!/[؀-ۿ]/.test(pattern)) continue; // Arabic-script patterns only
            const key = normalizeArabicToken(pattern);
            // First entry wins, mirroring the raw-text pass's "first rule
            // that claims a span keeps it" so both passes agree on
            // precedence when two entries list the same word.
            if (key && !index.has(key)) index.set(key, entry.canonical);
        }
    }
    return index;
}

/**
 * Resolves one already-normalized Arabic word to a glossary canonical,
 * retrying once without a leading clitic.
 * @returns {string|null}
 */
function lookupNormalizedWord(normalizedWord, index, vocabulary) {
    if (!normalizedWord) return null;
    const direct = index.get(normalizedWord);
    if (direct) return direct;
    const stripped = stripArabicClitic(normalizedWord, vocabulary);
    return stripped ? index.get(stripped) || null : null;
}

/**
 * Every normalized Arabic word the glossary knows, whether it was listed
 * as a standalone pattern or as one word inside a phrase. This is the
 * vocabulary clitic-stripping is checked against.
 * @param {Array<{patterns: string[]}>} entries
 * @returns {Set<string>}
 */
function buildNormalizedVocabulary(entries) {
    const vocabulary = new Set();
    for (const entry of entries) {
        for (const pattern of entry.patterns) {
            if (!/[؀-ۿ]/.test(pattern)) continue;
            for (const word of pattern.split(/\s+/)) {
                const normalized = normalizeArabicToken(word);
                if (normalized) vocabulary.add(normalized);
            }
        }
    }
    return vocabulary;
}

/**
 * Multi-word Arabic patterns, keyed by their normalized word sequence.
 * @param {Array<{canonical: string, patterns: string[]}>} entries
 * @returns {{ index: Map<string, string>, maxWords: number }}
 */
function buildNormalizedPhraseIndex(entries) {
    const index = new Map();
    let maxWords = 0;
    for (const entry of entries) {
        for (const pattern of entry.patterns) {
            if (!/\s/.test(pattern)) continue;
            if (!/[؀-ۿ]/.test(pattern)) continue;
            const words = pattern.split(/\s+/).map(normalizeArabicToken).filter(Boolean);
            if (words.length < 2) continue;
            const key = words.join(' ');
            if (!index.has(key)) index.set(key, entry.canonical);
            maxWords = Math.max(maxWords, words.length);
        }
    }
    return { index, maxWords };
}

/**
 * Folds runs of normalized Arabic tokens into a single glossary canonical
 * when they spell out a multi-word pattern.
 *
 * The raw-text pass cannot do this job: "الموقع ومش بتشتغل" contains the
 * phrase "مش بتشتغل" only AFTER the "و" clitic comes off the middle word,
 * and clitics are stripped per token, which by definition happens after
 * tokenization has already split the phrase apart. So the phrase is
 * reassembled here, from the normalized stream, where the clitic is gone.
 *
 * Longest match wins, and only 'arabic'/'arabizi' tokens participate —
 * a token already carrying a glossary canonical has been resolved by a
 * more specific pass and is never re-folded.
 *
 * @param {Array<{canonical: string, source: string, raw: string}>} tokens
 * @param {Map<string, string>} phraseIndex
 * @param {number} maxWords
 */
function foldNormalizedPhrases(tokens, phraseIndex, maxWords, vocabulary) {
    if (phraseIndex.size === 0 || maxWords < 2) return tokens;

    const foldable = (t) => t && (t.source === 'arabic' || t.source === 'arabizi');
    const result = [];

    for (let i = 0; i < tokens.length; ) {
        let matched = false;

        for (let span = Math.min(maxWords, tokens.length - i); span >= 2; span--) {
            const window = tokens.slice(i, i + span);
            if (!window.every(foldable)) continue;

            // THREE KEYS, IN INCREASING ORDER OF LIBERTY. Each one is tried
            // only after the previous fails, so this can add matches and
            // cannot remove them.
            //
            //   1. as written          — a phrase that matches verbatim
            //   2. guarded strip       — today's behaviour: clitics come off
            //                            words the glossary does NOT know
            //   3. unguarded FIRST word — the blocked case below
            //
            // Key 3 exists because the vocabulary is built from every word of
            // every pattern, so a pattern containing a clitic-prefixed form
            // puts that form in the vocabulary and the guard then refuses to
            // strip it anywhere. Exactly one pattern,
            // `symptom_stuck_loading :: "بيلف ومش بيخلص"`, put "ومش" in the
            // vocabulary, and that single entry stopped 32% of Arabic patterns
            // from matching after the conjunction "و".
            //
            // WHY ONLY THE FIRST WORD. Dropping the guard on every word was
            // tried and measured WORSE — 59.2% against 67.8%. Unguarded, "كده"
            // strips to "ده" and "الوقت" to "وقت", both real vocabulary words,
            // so phrases that used to match stopped. A conjunction attaches to
            // the front of a phrase, so that is the only position where the
            // guard needs relaxing, and relaxing it anywhere else destroys
            // more than it recovers.
            const words = window.map((t) => t.canonical);
            const asWritten = words.join(' ');
            let canonical = phraseIndex.get(asWritten);

            if (!canonical) {
                const guarded = window.map((t) => stripArabicClitic(t.canonical, vocabulary) || t.canonical);
                const guardedKey = guarded.join(' ');
                if (guardedKey !== asWritten) canonical = phraseIndex.get(guardedKey);

                if (!canonical) {
                    const head = stripArabicClitic(words[0], vocabulary, { trustVocabulary: false });
                    if (head) {
                        const headKey = [head, ...guarded.slice(1)].join(' ');
                        if (headKey !== guardedKey && headKey !== asWritten) canonical = phraseIndex.get(headKey);
                    }
                }
            }
            if (!canonical) continue;

            result.push({
                canonical,
                // A phrase resolved from transliteration keeps the lower
                // confidence of its weakest link.
                source: window.some((t) => t.source === 'arabizi') ? 'arabizi' : 'arabic',
                raw: window.map((t) => t.raw).join(' ')
            });
            i += span;
            matched = true;
            break;
        }

        if (!matched) result.push(tokens[i++]);
    }

    return result;
}

/**
 * Attempts to resolve a Latin/mixed-script token as Arabizi (Franco-Arabic).
 * Dictionary lookup first (whole-word, most reliable); falls back to
 * digit-letter substitution as a best-effort signal when the word isn't
 * in the dictionary but clearly uses Arabizi digit conventions.
 */
function resolveArabizi(tokenLower, arabiziMap) {
    const { wordMap, digitLetterMap } = arabiziMap;

    if (Object.prototype.hasOwnProperty.call(wordMap, tokenLower)) {
        return { resolved: true, canonical: normalizeArabicToken(wordMap[tokenLower]) };
    }

    let substituted = '';
    let substitutedAnyDigit = false;
    for (const ch of tokenLower) {
        if (Object.prototype.hasOwnProperty.call(digitLetterMap, ch)) {
            substituted += digitLetterMap[ch];
            substitutedAnyDigit = true;
        } else {
            substituted += ch;
        }
    }

    if (substitutedAnyDigit) {
        // Best-effort partial transliteration — a real digit-letter
        // convention was detected, so this is Arabizi usage even though
        // the remaining Latin letters weren't fully converted. Still
        // useful as a language-policy signal ("this is Arabic, not
        // English") and a rough evidence token.
        return { resolved: true, canonical: substituted };
    }

    return { resolved: false, canonical: null };
}

/**
 * كل ما يُشتق من المعجم — يُبنى مرة واحدة لكل نسخة بيانات، مش كل رسالة.
 *
 * WHY THIS CACHE EXISTS
 *
 * normalize() used to rebuild five O(glossary) structures on EVERY call:
 * the rule list (plus a sort whose comparator splits both patterns), the
 * single-word index, the phrase index, the vocabulary — and, inside
 * matchGlossary(), one compiled RegExp per pattern. None of it depends on
 * the message; all of it depends only on the glossary.
 *
 * That made the cost of answering one customer scale with the size of the
 * glossary, and when the glossary grew from 268 entries / 2,272 patterns
 * to 523 / 3,224, the function started exhausting the CPU budget of the
 * edge runtime it runs in — on every request, warm or cold.
 *
 * KEYED ON THE ENTRIES ARRAY ITSELF, DELIBERATELY
 *
 * A module-level flag would go stale the moment the glossary is reloaded
 * or a caller injects a different provider (every test does). Keying a
 * WeakMap on the entries array means the cache is valid exactly as long
 * as the data is the same object and cannot possibly outlive it: a
 * reload produces a new array, which misses and rebuilds. Since the
 * provider caches its array for the life of the isolate, the steady
 * state is "built once", with no invalidation logic to get wrong.
 */
const glossaryDerivationCache = new WeakMap();

function deriveGlossary(entries) {
    // Non-object inputs cannot key a WeakMap. Derive without caching
    // rather than throwing: correctness does not depend on the cache.
    if (!entries || typeof entries !== 'object') {
        return buildGlossaryDerivation(entries || []);
    }
    const cached = glossaryDerivationCache.get(entries);
    if (cached) return cached;
    const derived = buildGlossaryDerivation(entries);
    glossaryDerivationCache.set(entries, derived);
    return derived;
}

function buildGlossaryDerivation(entries) {
    const { index: phraseIndex, maxWords } = buildNormalizedPhraseIndex(entries);
    const rules = buildGlossaryRules(entries);
    return {
        rules,
        matchIndex: buildGlossaryMatchIndex(rules),
        wordIndex: buildNormalizedWordIndex(entries),
        phraseIndex,
        maxPhraseWords: maxWords,
        vocabulary: buildNormalizedVocabulary(entries)
    };
}

/**
 * Normalizes one customer message end-to-end.
 *
 * @param {string} text - raw customer message
 * @param {Object} [options]
 * @param {'ar'|'en'} [options.previousLanguage='ar'] - session's current response language
 * @param {{getEntries: Function}} [options.glossaryProvider] - defaults to local-JSON provider
 * @param {{getMap: Function}} [options.arabiziProvider] - defaults to local-JSON provider
 * @returns {Promise<{
 *   rawText: string,
 *   normalizedTokens: Array<{canonical: string, source: string, raw: string}>,
 *   responseLanguage: 'ar'|'en'
 * }>}
 */
export async function normalize(text, options = {}) {
    const {
        previousLanguage = 'ar',
        glossaryProvider = technicalGlossaryProvider,
        arabiziProvider = arabiziMapProvider,
        maxInputChars = MAX_INPUT_CHARS
    } = options;

    // COERCED, not assumed. `text` arrives from a channel webhook's JSON, and
    // a field that is normally a string is not guaranteed to be one: a number,
    // a boolean, null, or an object all reach here in practice. Before this,
    // every one of them threw inside the glossary matcher's `text.matchAll`,
    // taking down the whole turn — a crash caused by the SHAPE of the input
    // rather than its content, which is the cheapest kind of outage to cause.
    const received = typeof text === 'string' ? text : (text === null || text === undefined ? '' : String(text));
    // The hard bound. See MAX_INPUT_CHARS for why it lives here and not in
    // the trust layer.
    const truncated = received.length > maxInputChars;
    const rawText = truncated ? received.slice(0, maxInputChars) : received;
    const tokens = tokenize(rawText);

    const [glossaryEntries, arabiziMap] = await Promise.all([
        glossaryProvider.getEntries(),
        arabiziProvider.getMap()
    ]);
    const {
        rules: glossaryRules,
        matchIndex: glossaryMatchIndex,
        wordIndex: normalizedWordIndex,
        phraseIndex: normalizedPhraseIndex,
        maxPhraseWords,
        vocabulary: normalizedVocabulary
    } = deriveGlossary(glossaryEntries);
    const glossaryMatches = matchGlossary(rawText, glossaryRules, glossaryMatchIndex);

    const normalizedTokens = [];
    const languagePolicyTokens = [];
    let lastEmittedMatchEnd = -1;

    for (const token of tokens) {
        const insideGlossary = isTokenInsideAnyMatch(token, glossaryMatches);

        if (insideGlossary) {
            // Emit the glossary canonical once per match span, not once
            // per token inside it (a match can span multiple tokens).
            const containingMatch = glossaryMatches.find(
                (m) => token.start >= m.start && token.end <= m.end
            );
            if (containingMatch && containingMatch.end !== lastEmittedMatchEnd) {
                normalizedTokens.push({
                    canonical: containingMatch.canonical,
                    source: 'glossary',
                    raw: rawText.slice(containingMatch.start, containingMatch.end)
                });
                lastEmittedMatchEnd = containingMatch.end;
            }
            languagePolicyTokens.push({
                raw: token.raw,
                script: token.script,
                isGlossaryMatch: true,
                isArabiziResolved: false
            });
            continue;
        }

        if (token.script === 'arabic') {
            const canonical = normalizeArabicToken(token.raw);
            if (canonical) {
                // Promote to the glossary's canonical vocabulary when this
                // word is one the glossary knows, so Arabic phrasing lands
                // in the SAME token space as English/technical phrasing and
                // a scenario signature only has to be written once.
                // `source` deliberately stays 'arabic': the match is real,
                // but an ordinary Arabic word is more polysemous than an
                // explicit technical term, and evidence-extractor weights
                // the two differently on purpose.
                const glossaryCanonical = lookupNormalizedWord(canonical, normalizedWordIndex, normalizedVocabulary);
                normalizedTokens.push({
                    canonical: glossaryCanonical || canonical,
                    source: 'arabic',
                    raw: token.raw
                });
            }
            languagePolicyTokens.push({
                raw: token.raw,
                script: token.script,
                isGlossaryMatch: false,
                isArabiziResolved: false
            });
            continue;
        }

        if (token.script === 'latin' || token.script === 'mixed') {
            const { resolved, canonical } = resolveArabizi(token.lower, arabiziMap);
            if (resolved) {
                // Same promotion as the Arabic branch. Without this, Arabizi
                // was a dead end for diagnosis: "eshtrak" resolved to the
                // Arabic word "اشتراك" but never to entity_subscription,
                // because the raw-text glossary pass ran BEFORE this
                // transliteration existed. Every scenario was therefore
                // unreachable for a customer typing in Franco-Arabic.
                const glossaryCanonical = lookupNormalizedWord(canonical, normalizedWordIndex, normalizedVocabulary);
                normalizedTokens.push({
                    canonical: glossaryCanonical || canonical,
                    source: 'arabizi',
                    raw: token.raw
                });
            } else {
                normalizedTokens.push({ canonical: token.lower, source: 'unrecognized-latin', raw: token.raw });
            }
            languagePolicyTokens.push({
                raw: token.raw,
                script: token.script,
                isGlossaryMatch: false,
                isArabiziResolved: resolved
            });
            continue;
        }

        // digit-only or other: keep as-is, no language-policy weight
        normalizedTokens.push({ canonical: token.lower, source: token.script, raw: token.raw });
        languagePolicyTokens.push({
            raw: token.raw,
            script: token.script,
            isGlossaryMatch: false,
            isArabiziResolved: false
        });
    }

    const responseLanguage = decideResponseLanguage({
        previousLanguage,
        tokens: languagePolicyTokens
    });

    return {
        rawText,
        normalizedTokens: foldNormalizedPhrases(normalizedTokens, normalizedPhraseIndex, maxPhraseWords, normalizedVocabulary),
        responseLanguage,
        // Additive: existing callers ignore it, and a caller that cares (the
        // trust layer's size sensor, the trace) can see that the text it is
        // reasoning about is not all of what arrived.
        truncated,
        receivedChars: received.length
    };
}
