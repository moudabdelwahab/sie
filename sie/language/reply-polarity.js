/**
 * reply-polarity.js — yes, no, or neither, for an answer to a yes/no prompt.
 * ------------------------------------------------------------
 * Layer 1 detects; it does not decide what a "yes" does. The pending ticket
 * question in the bridge, and Decision after WP4, read this signal.
 *
 * It replaces the bridge's regex classifier, which the audit (D1, D2) found
 * wrong three ways:
 *   - «لا» was unclear: `/^لا\b/` never matches, because JavaScript's `\b`
 *     is ASCII-only and there is no word boundary after an Arabic letter;
 *   - «اه» was unclear, for the same reason;
 *   - «أيوه عندي مشكلة في الدفع» was a NO, because «مشكلة» contains «مش».
 *
 * Rules (G-L1-5):
 *   1. A message that STARTS with a yes or no word has that polarity. A
 *      negator first («مش موافق», «لا مش عايز») is a no.
 *   2. A message that carries diagnostic content and does not start with one
 *      has no polarity: «الواتساب مش بيبعت رسايل» answers nothing — it
 *      restates the problem.
 *   3. Otherwise, a short message (≤ 4 words) takes the first yes/no word in
 *      it («طيب ماشي»). Anything longer is not an answer.
 * Words are matched whole and folded (G-L1-1).
 */
import { analyzeMessage } from './lexicon-match.js';

/** Folded. */
export const YES_WORDS = Object.freeze(new Set([
    'ايوه', 'ايوا', 'اه', 'نعم', 'اكيد', 'طبعا', 'موافق', 'تمام', 'ماشي', 'صح', 'اوك', 'اوكي',
    'yes', 'y', 'yep', 'yeah', 'yup', 'sure', 'ok', 'okay', 'confirmed', 'confirm'
]));

/** Folded. «لأ» folds to «لا». */
export const NO_WORDS = Object.freeze(new Set([
    'لا', 'لاء', 'مش', 'الغي', 'الغاء', 'كنسل', 'رفض',
    'no', 'n', 'nope', 'nah', 'not', 'cancel'
]));

/** «مش عارف» / «مش فاهم» / «مش متأكد» is not a no — it is not an answer at all. */
const NOT_AN_ANSWER_AFTER_MASH = new Set(['عارف', 'عارفه', 'فاهم', 'فاهمه', 'متاكد', 'متاكده']);

const MAX_SHORT_ANSWER_WORDS = 4;

function polarityAt(words, i) {
    const w = words[i];
    if (w === 'مش' && NOT_AN_ANSWER_AFTER_MASH.has(words[i + 1])) return 'none';
    if (NO_WORDS.has(w)) return 'no';
    if (YES_WORDS.has(w)) return 'yes';
    return null;
}

/**
 * @param {string} text - the text Layer 1 read
 * @param {Object} [options]
 * @param {boolean} [options.diagnosticContent] - the message carries a problem token
 * @param {Object} [options.analysis] - analyzeMessage(text), when the caller has it
 * @returns {'yes'|'no'|null}
 */
export function replyPolarity(text, { diagnosticContent = false, analysis = null } = {}) {
    const { words } = analysis || analyzeMessage(text);
    if (words.length === 0) return null;

    const first = polarityAt(words, 0);
    if (first === 'none') return null;
    if (first) return first;

    if (diagnosticContent || words.length > MAX_SHORT_ANSWER_WORDS) return null;
    for (let i = 1; i < words.length; i++) {
        const p = polarityAt(words, i);
        if (p === 'none') return null;
        if (p) return p;
    }
    return null;
}
