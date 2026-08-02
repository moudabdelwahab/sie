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
 * Scans raw text for non-overlapping glossary matches, longest/most
 * specific pattern wins when patterns overlap.
 * @returns {Array<{start: number, end: number, canonical: string, labels: Object}>}
 */
function matchGlossary(text, rules) {
    const matches = [];
    const consumed = []; // list of [start, end) already claimed

    const overlaps = (start, end) =>
        consumed.some(([cStart, cEnd]) => start < cEnd && end > cStart);

    for (const rule of rules) {
        const escaped = escapeRegExp(rule.pattern).replace(/\s+/g, '\\s+');
        // Unicode-aware word boundaries instead of `\b`. JavaScript's `\b`
        // is defined against ASCII [A-Za-z0-9_], so every character of an
        // Arabic pattern counts as a NON-word character and `\bمش شغال\b`
        // can never match — which silently made Arabic glossary entries
        // impossible, the exact opposite of what a bilingual engine needs.
        // These lookarounds treat any letter or digit in any script as a
        // word character, so "مش شغال" and "error 401" both match on a real
        // boundary, while "401" still refuses to match inside "4012".
        const regex = new RegExp(`(?<![\\p{L}\\p{N}_])${escaped}(?![\\p{L}\\p{N}_])`, 'giu');
        let match;
        while ((match = regex.exec(text)) !== null) {
            const start = match.index;
            const end = start + match[0].length;
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

function stripArabicClitic(word, vocabulary) {
    if (!word || !vocabulary) return null;
    // A word the glossary already knows is never re-analysed. Without this
    // guard "بتشتغل" (it works) gets stripped to "تشتغل", which is also a
    // real vocabulary word — so the remainder test alone happily destroys
    // a perfectly good match. Known words are taken at face value; only
    // unknown ones are candidates for carrying a clitic.
    if (vocabulary.has(word)) return null;
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

            const words = window.map((t) => stripArabicClitic(t.canonical, vocabulary) || t.canonical);
            const canonical = phraseIndex.get(words.join(' '));
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
        arabiziProvider = arabiziMapProvider
    } = options;

    const rawText = text || '';
    const tokens = tokenize(rawText);

    const [glossaryEntries, arabiziMap] = await Promise.all([
        glossaryProvider.getEntries(),
        arabiziProvider.getMap()
    ]);
    const glossaryRules = buildGlossaryRules(glossaryEntries);
    const glossaryMatches = matchGlossary(rawText, glossaryRules);
    const normalizedWordIndex = buildNormalizedWordIndex(glossaryEntries);
    const { index: normalizedPhraseIndex, maxWords: maxPhraseWords } =
        buildNormalizedPhraseIndex(glossaryEntries);
    const normalizedVocabulary = buildNormalizedVocabulary(glossaryEntries);

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
        responseLanguage
    };
}
