/**
 * memory-intent.js
 * ------------------------------------------------------------
 * العميل بيقول «احفظ ده» ولا «افتكرت إيه عني»؟
 *
 * ------------------------------------------------------------
 * WHY THIS IS ITS OWN MODULE
 *
 * "احفظ ده في ذاكرتك" is not a support problem and not small talk. It is
 * an instruction ABOUT the conversation rather than content within it, and
 * the diagnostic pipeline has no category for that — which is why it was
 * previously fed into diagnosis and answered with an unrelated WhatsApp
 * solution.
 *
 * Pure detection: no storage, no I/O, no Supabase. sie-chat-bridge decides
 * what to do with the intent, exactly as it does with emotion and small
 * talk. That keeps this testable with strings alone.
 *
 * ------------------------------------------------------------
 * WHAT IS DELIBERATELY NOT HERE
 *
 * No attempt to extract arbitrary facts from ordinary conversation. An
 * engine that silently decided which of a customer's sentences were worth
 * remembering would store things they never meant to save, and get them
 * wrong. Memory is written only when the customer asks for it, or when
 * they state a fact in one of a few unambiguous forms.
 */
import { foldForMatch } from './emotion-detector.js';

/** «افتكر» / «احفظ» — طلب صريح بالحفظ. */
const SAVE_TRIGGERS = [
    'احفظ ده', 'احفظ دي', 'احفظها', 'احفظ المعلومه', 'احفظ في ذاكرتك',
    'خليها في ذاكرتك', 'حطها في ذاكرتك', 'سجل ده', 'سجل عندك',
    'افتكر ده', 'افتكر كده', 'افتكرني', 'خليك فاكر', 'متنساش',
    'خزن ده', 'اوعي تنسي'
];

/** «انت فاكر إيه عني؟» */
const RECALL_TRIGGERS = [
    'فاكر ايه عني', 'انت فاكر ايه', 'ايه اللي فاكره عني', 'ايه اللي تعرفه عني',
    'تعرف ايه عني', 'ايه اللي في ذاكرتك', 'اعرض ذاكرتك', 'فاكرني'
];

/** «انسي اللي فات» */
const FORGET_TRIGGERS = [
    'انسي اللي قلته', 'انسي كل حاجه', 'امسح ذاكرتك', 'امسح اللي فاكره',
    'انسي المعلومات دي', 'شيل اللي حفظته'
];

/**
 * الكلمات اللي بتفصل الاسم عن الدور في جملة زي
 * «انا محمود عبدالوهاب صاحب منصة مدعوم».
 *
 * Without a boundary the name pattern swallowed the whole sentence and was
 * then rejected for being too long — so the one form the customer actually
 * used stored nothing at all.
 */
const ROLE_MARKERS = ['صاحب', 'مالك', 'مدير', 'مؤسس', 'من شركة', 'موظف', 'مسؤول'];

/**
 * @param {string} text
 * @returns {Array<{key: string, value: string}>}
 */
export function extractFacts(text) {
    const input = String(text || '').trim();
    if (!input) return [];

    const found = [];

    // «اسمي X» — the least ambiguous form, so it wins outright.
    const explicitName = input.match(/اسمي\s+([\u0600-\u06FF\s]{2,40}?)(?:\s*[,،]|$)/);
    if (explicitName) {
        const value = tidy(explicitName[1]);
        if (isPlausibleName(value)) found.push({ key: 'name', value });
    }

    // «انا …» — split at a role marker so the name and the role are stored
    // as two facts rather than one unusable string.
    const selfIntro = input.match(/(?:^|\s)(?:انا|أنا)\s+([\u0600-\u06FF\s]{2,80}?)(?:\s*[,،.]|$)/);
    if (selfIntro) {
        const rest = tidy(selfIntro[1]);
        const markerIndex = ROLE_MARKERS
            .map((marker) => ({ marker, at: rest.indexOf(marker) }))
            .filter((m) => m.at > 0)
            .sort((a, b) => a.at - b.at)[0];

        const namePart = markerIndex ? tidy(rest.slice(0, markerIndex.at)) : rest;
        const rolePart = markerIndex ? tidy(rest.slice(markerIndex.at)) : '';

        if (!found.some((f) => f.key === 'name') && isPlausibleName(namePart)) {
            found.push({ key: 'name', value: namePart });
        }
        if (rolePart.length >= 4) {
            found.push({ key: 'role', value: rolePart });
        }
    }

    const company = input.match(/شركتي\s+(?:اسمها\s+)?([\u0600-\u06FF\s]{2,40}?)(?:\s*[,،]|$)/);
    if (company) {
        const value = tidy(company[1]);
        if (value.length >= 2) found.push({ key: 'company', value });
    }

    return found;
}

function tidy(value) {
    return String(value || '').trim().replace(/\s+/g, ' ');
}

/**
 * @typedef {Object} MemoryIntent
 * @property {'save'|'recall'|'forget'} kind
 * @property {Array<{key: string, value: string}>} facts - for 'save'
 * @property {string} raw
 */

/**
 * @param {string} rawText
 * @param {string} [previousText] - the message before this one, so a bare
 *   "احفظ ده" can refer to what was just said
 * @returns {MemoryIntent|null}
 */
export function detectMemoryIntent(rawText, previousText = '') {
    const text = String(rawText || '').trim();
    if (!text) return null;
    const folded = foldForMatch(text);

    if (FORGET_TRIGGERS.some((t) => folded.includes(foldForMatch(t)))) {
        return { kind: 'forget', facts: [], raw: text };
    }
    if (RECALL_TRIGGERS.some((t) => folded.includes(foldForMatch(t)))) {
        return { kind: 'recall', facts: [], raw: text };
    }

    const asked = SAVE_TRIGGERS.some((t) => folded.includes(foldForMatch(t)));
    if (!asked) {
        // Not asked to save, but the customer may still have stated a fact
        // outright. Those are worth keeping — a name given once should not
        // have to be given again.
        const facts = extractFacts(text);
        return facts.length > 0 ? { kind: 'save', facts, raw: text } : null;
    }

    // "احفظ ده" on its own points at the previous message; with content in
    // the same message, that content is what to save.
    const facts = extractFacts(text);
    if (facts.length > 0) return { kind: 'save', facts, raw: text };

    const fromPrevious = extractFacts(previousText);
    if (fromPrevious.length > 0) return { kind: 'save', facts: fromPrevious, raw: text };

    // Asked to remember something we could not parse into a field. Store it
    // verbatim rather than refusing — a note the customer wrote themselves
    // is more useful than nothing, and an agent can read it.
    const note = String(previousText || '').trim();
    return {
        kind: 'save',
        facts: note ? [{ key: 'note', value: note.slice(0, 500) }] : [],
        raw: text
    };
}

/** كلمات لو ظهرت بعد «انا» تبقى دي جملة عادية مش اسم. */
const NOT_A_NAME = [
    'عندي', 'محتاج', 'عايز', 'مش', 'بحاول', 'زهقت', 'تعبت', 'اسف', 'متضايق',
    'بسال', 'حابب', 'كنت', 'هحاول', 'شايف', 'قلت', 'جاي', 'لسه', 'بقالي'
];

function isPlausibleName(value) {
    const words = value.split(/\s+/).filter(Boolean);
    if (words.length === 0 || words.length > 4) return false;
    return !NOT_A_NAME.includes(words[0]);
}

/** ردود الذاكرة بالعربي. */
export const MEMORY_REPLIES = Object.freeze({
    saved: (facts) => `تمام، حفظتها 📝\n${facts.map((f) => `• ${f.value}`).join('\n')}\n\nهفضل فاكرها في أي محادثة جاية.`,
    nothingToSave: 'قولّي الحاجة اللي عايزني أفتكرها بالظبط وأنا أحفظها.',
    recalled: (facts) => (facts.length === 0
        ? 'لسه مش فاكر أي حاجة عنك. لو حابب، قولّي معلومة وأنا أحفظها.'
        : `اللي فاكره عنك:\n${facts.map((f) => `• ${f.value}`).join('\n')}`),
    forgotten: 'تمام، مسحت كل اللي كنت فاكره عنك.'
});
