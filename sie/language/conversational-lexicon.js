/**
 * conversational-lexicon.js — every word Layer 1's conversational detectors
 * know, as one folded set.
 * ------------------------------------------------------------
 * A word the engine already knows is not a misspelling. Typo tolerance
 * (normalizer.js) never "corrects" one of these into a problem token: the
 * audit-era failure mode it guards against is «السلام» (as in «السلام
 * عليكم») being one letter away from «السبام» (spam).
 */
import { tokenizeForMatch } from './lexicon-match.js';
import { SMALL_TALK_CATEGORIES, FILLER_WORDS } from './small-talk.js';
import { EMOTION_CATEGORIES, RESOLVED_PHRASES, UNRESOLVED_PHRASES } from './emotion-detector.js';
import { SAVE_TRIGGERS, RECALL_TRIGGERS, FORGET_TRIGGERS } from './memory-intent.js';
import { YES_WORDS, NO_WORDS } from './reply-polarity.js';

let cached = null;

/** @returns {Set<string>} folded words */
export function conversationalWords() {
    if (cached) return cached;
    const words = new Set([...FILLER_WORDS, ...YES_WORDS, ...NO_WORDS]);
    const phrases = [
        ...SMALL_TALK_CATEGORIES.flatMap((c) => c.phrases),
        ...EMOTION_CATEGORIES.flatMap((c) => c.phrases),
        ...RESOLVED_PHRASES, ...UNRESOLVED_PHRASES,
        ...SAVE_TRIGGERS, ...RECALL_TRIGGERS, ...FORGET_TRIGGERS
    ];
    for (const p of phrases) for (const t of tokenizeForMatch(p)) if (!t.punct) words.add(t.t);
    cached = words;
    return words;
}
