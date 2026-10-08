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
import { analyzeMessage, findPhrase, phraseWords, CLAUSE_WORDS, isProblemToken } from './lexicon-match.js';

/** «افتكر» / «احفظ» — طلب صريح بالحفظ. */
export const SAVE_TRIGGERS = [
    'احفظ ده', 'احفظ دي', 'احفظها', 'احفظ المعلومه', 'احفظ في ذاكرتك',
    'خليها في ذاكرتك', 'حطها في ذاكرتك', 'سجل ده', 'سجل عندك',
    'افتكر ده', 'افتكر كده', 'خليك فاكر',
    // Not a bare «متنساش»: «متنساش ترد عليا» ("don't forget to answer me")
    // is a request about the conversation, not something to remember. Nor a
    // bare «افتكرني»: «افتكرني بكلمة السر» is "remind me of my password".
    'متنساش ده', 'متنساش دي', 'متنساش كده', 'متنساش ان',
    'خزن ده', 'اوعي تنسي'
];

/** «انت فاكر إيه عني؟» */
export const RECALL_TRIGGERS = [
    'فاكر ايه عني', 'انت فاكر ايه', 'ايه اللي فاكره عني', 'ايه اللي تعرفه عني',
    'تعرف ايه عني', 'ايه اللي في ذاكرتك', 'اعرض ذاكرتك', 'فاكرني'
];

/** «انسي اللي فات» */
export const FORGET_TRIGGERS = [
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

    // «اسمي X» — the least ambiguous form, so it wins outright. Unless
    // «اسمي» is the OBJECT of a verb («عايز اغير اسمي اللي ظاهر»): that is a
    // request about the name, and storing "اللي ظاهر" as the name was a bug.
    const explicitName = input.match(/(?:^|\s)(?:([\u0600-\u06FF]+)\s+)?اسمي\s+([\u0600-\u06FF\s]{2,40}?)(?:\s*[,،]|$)/);
    if (explicitName && !OBJECT_VERBS.includes(foldWord(explicitName[1]))) {
        explicitName[1] = explicitName[2];
        const value = tidy(explicitName[1]);
        if (isPlausibleName(value)) found.push({ key: 'name', value });
    }

    // «انا …» — split at a role marker so the name and the role are stored
    // as two facts rather than one unusable string.
    //
    // «انا» introduces the customer ONLY at the start of the message, or right
    // after a greeting or «و» («السلام عليكم انا احمد»). Anywhere else it is
    // the subject of an ordinary sentence: «مش ده اللي انا عايزه», «لا انا
    // قصدي الفاتورة», «استنى انا كتبت غلط» were each saved as the customer's
    // NAME and the turn was never diagnosed — the correction was lost.
    const selfIntro = matchSelfIntro(input);
    if (selfIntro) {
        // «انا احمد وشركتي اسمها تك» — the name ends where the company starts.
        const rest = tidy(selfIntro[1].split(/\s+و\s*شركتي/)[0]);
        const { namePart, rolePart } = splitNameAndRole(rest);

        if (!found.some((f) => f.key === 'name') && isPlausibleName(namePart)) {
            found.push({ key: 'name', value: namePart });
        }
        if (rolePart.length >= 4) {
            found.push({ key: 'role', value: rolePart });
        }
    }

    // «شركتي X» only as a statement: at the start, after «انا/و», or as
    // «شركتي اسمها X». After any other word it is an object («لوجو شركتي على
    // البوابة», «بيانات شركتي مش ظاهرة») and the "value" was the rest of the
    // sentence.
    const company = input.match(/(?:^|(?:^|\s)(?:انا|أنا|و)\s+)شركتي\s+(?:اسمها\s+)?([\u0600-\u06FF\s]{2,40}?)(?:\s*[,،]|$)/)
        || input.match(/شركتي\s+اسمها\s+([\u0600-\u06FF\s]{2,40}?)(?:\s*[,،]|$)/);
    if (company) {
        const value = tidy(company[1]);
        if (value.length >= 2 && !NOT_A_COMPANY.includes(foldWord(value.split(' ')[0]))) found.push({ key: 'company', value });
    }

    return found;
}

function tidy(value) {
    return String(value || '').trim().replace(/\s+/g, ' ');
}

/**
 * «سامي حسن صاحب منصة مدعوم» → name + role, split at a role marker
 * found as a WHOLE word (G-L1-1). The marker used to be found with
 * `indexOf`, so «المدير» matched «مدير» two letters in, the name became «ال»
 * and the role «مدير ومش قادر اضيف موظف». «المدير» is now the role itself,
 * and the role ends at the next clause («و…», «بس», «لكن»).
 */
function splitNameAndRole(rest) {
    const words = rest.split(/\s+/).filter(Boolean);
    const at = words.findIndex((_, i) => roleMarkerAt(words, i));
    if (at < 0) return { namePart: rest, rolePart: '' };
    let end = at + 1;
    while (end < words.length && end - at < 6 && !startsClause(words[end])) end += 1;
    return { namePart: words.slice(0, at).join(' '), rolePart: words.slice(at, end).join(' ') };
}

function roleMarkerAt(words, i) {
    const w = foldWord(words[i]);
    if (w === 'من' && /^شرك[هة]$/.test(foldWord(words[i + 1]))) return true;
    return ROLE_WORDS.has(w) || (w.startsWith('ال') && ROLE_WORDS.has(w.slice(2)));
}

const ROLE_WORDS = new Set(ROLE_MARKERS.filter((m) => !/\s/.test(m)).map(foldWord));

function startsClause(word) {
    return CLAUSE_WORDS.has(word) || (word.length > 1 && (word.startsWith('و') || word.startsWith('ف')));
}

/**
 * @typedef {Object} MemoryIntent
 * @property {'save'|'recall'|'forget'} kind
 * @property {Array<{key: string, value: string}>} facts - for 'save'
 * @property {string} raw
 * @property {boolean} explicit   the customer ASKED (a save/recall/forget
 *   phrase), and the message is about their memory, not a problem
 * @property {boolean} standalone the message is nothing but the request or
 *   the self-introduction — no clause, no problem left over
 */

/** Each trigger list split into words once. */
const TRIGGER_WORDS = new Map();
const splitTriggers = (triggers) => {
    if (!TRIGGER_WORDS.has(triggers)) TRIGGER_WORDS.set(triggers, triggers.map(phraseWords));
    return TRIGGER_WORDS.get(triggers);
};

/** A trigger phrase in the message, as whole words, not negated. */
const hasTrigger = (analysis, triggers) => splitTriggers(triggers).some((t) => findPhrase(analysis, t).some((hit) => !hit.negated));

/**
 * @param {string} rawText
 * @param {string} [previousText] - the message before this one, so a bare
 *   "احفظ ده" can refer to what was just said
 * @param {Object} [options]
 * @param {Array} [options.tokens] - normalize()'s tokens. A token that says
 *   something is WRONG or asks for something to be DONE (symptom_, intent_,
 *   http_), for a word the request or introduction does not itself explain,
 *   makes the message a problem report: «سجل عندك ان الدفع اتخصم مرتين» is
 *   the problem, not a memory instruction, so it is reported as non-explicit
 *   and non-standalone and reaches diagnosis (G-L1-7). A merely NAMED thing
 *   is content to remember — «احفظ ان رقم الواتساب بتاعي …» — and an edition's
 *   vocabulary naming a word in an introduction («اسمي» is entity_my_name in
 *   Pro) must not turn the introduction into a problem.
 * @param {boolean} [options.diagnosticContent] - used when no tokens are given
 * @returns {MemoryIntent|null}
 */
export function detectMemoryIntent(rawText, previousText = '', { tokens = null, diagnosticContent = false } = {}) {
    const text = String(rawText || '').trim();
    if (!text) return null;
    const a = analyzeMessage(text);
    const carriesProblem = (explained) => (Array.isArray(tokens)
        ? tokens.some((t) => isProblemToken(t) && phraseWords(t.raw || '').some((w) => !explained.has(w)))
        : diagnosticContent);
    const triggerWords = (triggers) => new Set(splitTriggers(triggers).filter((t) => findPhrase(a, t).length).flat().concat(REQUEST_WORDS));
    const asked = (kind, facts, triggers) => {
        const problem = carriesProblem(new Set([...triggerWords(triggers), ...facts.flatMap((f) => phraseWords(f.value))]));
        return { kind, facts: problem ? [] : facts, raw: text, explicit: !problem, standalone: !problem };
    };

    if (hasTrigger(a, FORGET_TRIGGERS)) return asked('forget', [], FORGET_TRIGGERS);
    if (hasTrigger(a, RECALL_TRIGGERS)) return asked('recall', [], RECALL_TRIGGERS);

    if (!hasTrigger(a, SAVE_TRIGGERS)) {
        // Not asked to save, but the customer may still have stated a fact
        // outright. Those are worth keeping — a name given once should not
        // have to be given again — but only a message that is NOTHING BUT the
        // introduction is about memory. «انا المدير ومش قادر اضيف موظف» is a
        // problem from a manager.
        const facts = extractFacts(text);
        if (facts.length === 0) return null;
        const explained = new Set([...INTRO_WORDS, ...facts.flatMap((f) => phraseWords(f.value))]);
        return { kind: 'save', facts, raw: text, explicit: false, standalone: !carriesProblem(explained) && onlyIntroduces(a, facts) };
    }
    if (carriesProblem(triggerWords(SAVE_TRIGGERS))) return asked('save', [], SAVE_TRIGGERS);

    // "احفظ ده" on its own points at the previous message; with content in
    // the same message, that content is what to save.
    const facts = extractFacts(text);
    if (facts.length > 0) return asked('save', facts, SAVE_TRIGGERS);

    const fromPrevious = extractFacts(previousText);
    if (fromPrevious.length > 0) return { kind: 'save', facts: fromPrevious, raw: text, explicit: true, standalone: true };

    // Asked to remember something we could not parse into a field. Store it
    // verbatim rather than refusing — a note the customer wrote themselves
    // is more useful than nothing, and an agent can read it.
    const note = String(previousText || '').trim();
    return { kind: 'save', facts: note ? [{ key: 'note', value: note.slice(0, 500) }] : [], raw: text, explicit: true, standalone: true };
}

/** Words a memory request carries besides its trigger: «احفظ ده في ذاكرتك». Folded. */
const REQUEST_WORDS = ['ده', 'دي', 'في', 'عندك', 'ان', 'اني', 'كده', 'لو', 'سمحت'];

/** Words an introduction is built from, besides the facts themselves. Folded. */
const INTRO_WORDS = new Set(['انا', 'اسمي', 'شركتي', 'وشركتي', 'اسمها', 'و', 'يا', 'من', 'شركه']);

/** Every word of the message is a greeting, an introduction word, or part of a fact. */
function onlyIntroduces(analysis, facts) {
    const factWords = new Set(facts.flatMap((f) => phraseWords(f.value)));
    const greetings = new Set([...GREETING_WORDS].flatMap((w) => phraseWords(w)));
    return analysis.words.every((w) => INTRO_WORDS.has(w) || greetings.has(w) || factWords.has(w));
}

/**
 * «انا» + name, where «انا» opens the message or follows only greeting words.
 *
 * Deliberately NOT one regex with a repeated optional greeting prefix: that
 * shape backtracks exponentially («و و و …» × 28 took 1.6 s, and a
 * 50,000-character message hung the process). This is linear: find the first
 * «انا», check the few words before it, then match the name after it.
 */
const GREETING_WORDS = new Set(['السلام', 'سلام', 'عليكم', 'اهلا', 'أهلا', 'مرحبا', 'هاي', 'هلا', 'صباح', 'مساء',
    'الخير', 'النور', 'ازيك', 'إزيك', 'ازيكم', 'و', 'يا']);
const NAME_AFTER_ANA = /^([\u0600-\u06FF\s]{2,80}?)(?:\s*[,،.]|$)/;

function matchSelfIntro(input) {
    const m = /(?:^|\s)(?:انا|أنا)\s+/.exec(input);
    if (!m) return null;
    const before = input.slice(0, m.index).replace(/[,،.!؟?]/g, ' ').split(/\s+/).filter(Boolean);
    if (before.length > 6 || !before.every((w) => GREETING_WORDS.has(w))) return null;
    return NAME_AFTER_ANA.exec(input.slice(m.index + m[0].length));
}

/** كلمات لو ظهرت بعد «انا» تبقى دي جملة عادية مش اسم. */
const NOT_A_NAME = [
    'عندي', 'محتاج', 'عايز', 'مش', 'بحاول', 'زهقت', 'تعبت', 'اسف', 'متضايق',
    'بسال', 'حابب', 'كنت', 'هحاول', 'شايف', 'قلت', 'جاي', 'لسه', 'بقالي',
    // States and verbs customers put after «انا» that are never names.
    'قصدي', 'قصدت', 'تايه', 'تعبان', 'زعلان', 'مستني', 'محتار', 'فاهم', 'ناسي', 'فاكر',
    'مستعجل', 'كتبت', 'غلطت', 'جربت', 'دفعت', 'سالت', 'عملت', 'حاولت', 'لقيت', 'شفت',
    'بتكلم', 'بكلم', 'بقول', 'بسأل', 'هنا', 'موجود', 'معاك', 'خلصت', 'مقصدتش', 'مش',
    // Feelings (WP4): once anger and praise without context stopped escalating,
    // «انا متعصب جدا» / «انا مبسوط جدا بصراحة» reached the memory reading and
    // were stored as the customer's name. «سعيد» is left out: it is a name.
    'مبسوط', 'متعصب', 'معصب', 'زهقان', 'غضبان', 'متنرفز', 'مضايق', 'مخنوق', 'قرفان', 'مستاء',
    'فرحان', 'مقهور', 'مصدوم', 'خايف', 'قلقان', 'مرتاح', 'ممتن', 'شاكر', 'متشكر',
    // After «اسمي»: a description of the name, not a name.
    'اللي', 'الظاهر', 'ظاهر', 'مكتوب', 'غلط', 'اتغير', 'متسجل', 'في', 'على', 'علي'
];

/** أفعال لو جت قبل «اسمي» يبقى الاسم مفعول به مش تعريف بالنفس. */
const OBJECT_VERBS = [
    'اغير', 'غير', 'اغيير', 'تغيير', 'اعدل', 'عدل', 'تعديل', 'احط', 'حط', 'اكتب',
    'امسح', 'اشيل', 'ابدل', 'اصحح', 'صحح', 'يظهر', 'اظهر', 'ازاي'
];

/** أول كلمة بعد «شركتي» لو كانت واحدة من دول، الجملة مش اسم شركة. */
const NOT_A_COMPANY = ['على', 'علي', 'في', 'من', 'مش', 'عندها', 'فيها', 'بتاعتي', 'مسجله', 'مسجلة', 'اتقفلت', 'محتاجه', 'محتاجة'];

function foldWord(word) {
    return String(word || '').replace(/[أإآ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه');
}

function isPlausibleName(value) {
    const words = value.split(/\s+/).filter(Boolean);
    if (words.length === 0 || words.length > 4) return false;
    const first = foldWord(words[0]);
    // A negated verb («ماقلتش», «مسألتش», «مفهمتش») is never a name.
    if (/^م.{2,}ش$/.test(first)) return false;
    // Stems, not only exact words: «عايزه», «محتاجه», «قصدي» are the same word.
    return !NOT_A_NAME.some((w) => first === foldWord(w) || (w.length >= 4 && first.startsWith(foldWord(w))));
}

