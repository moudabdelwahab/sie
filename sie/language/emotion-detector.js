/**
 * emotion-detector.js
 * ------------------------------------------------------------
 * الذكاء العاطفي: يقرا نبرة العميل من رسالته.
 *
 * ست حالات: غضب، إحباط، استعجال، سخرية، شكر، رضا.
 *
 * ------------------------------------------------------------
 * WHY THIS IS NOT small-talk.js
 *
 * small-talk.js answers "is this message *instead of* a problem?" — a
 * greeting, a thank-you, "who are you". It requires a short message
 * (maxWords) and it SHORT-CIRCUITS the pipeline: the reply replaces
 * diagnosis entirely.
 *
 * This module answers a different question: "what is the customer
 * *feeling* while telling me their problem?" Emotion rides along with
 * real content and must not replace it. «الموقع واقف من امبارح وانا
 * مستعجل جدًا والعملاء بيزعقولي» is fifteen words, is urgent, and is a
 * genuine technical report — small talk cannot see it (too long) and
 * must not swallow it (there is a real problem to diagnose).
 *
 * So: no word limit, no short circuit. The detector returns a signal;
 * sie-chat-bridge decides what to do with it — prefix the reply,
 * escalate, or skip a question.
 *
 * ------------------------------------------------------------
 * ORDERING
 *
 * Categories are checked in the order listed, and the FIRST match wins.
 * The order encodes precedence deliberately:
 *
 *   sarcasm before thanks/satisfaction — «شكرًا على الخدمة الممتازة دي»
 *   contains «شكرًا» and «ممتازة», so a naive positive check reads a
 *   furious customer as a happy one and replies «تسلم!». Sarcasm is the
 *   single most expensive emotion to miss, so it is checked first.
 *
 *   anger before frustration — both are negative, but anger routes to a
 *   human immediately while frustration only softens the reply. When a
 *   message is both, the stronger reading is the safer one.
 *
 *   thanks before satisfaction — «شكرًا اشتغلت» is both; thanking is the
 *   more specific act and gets the more specific reply.
 *
 * ------------------------------------------------------------
 * MATCHING
 *
 * Whole words on the folded text (sie/language/lexicon-match.js, WP3), never
 * substrings: «نصب» (fraud) is not in «انصب» (install), which the audit
 * found routing "how do I install WhatsApp Business" to a human as anger.
 * A phrase inside a negation scope does not count («مش مستعجل», «ما
 * اشتغلش»), and a positive phrase (thanks, satisfaction) in a question or a
 * condition is not asserted («لما اشتغل على الموبايل بيقفل»). Tone markers
 * ("!!!", stretched letters) are still read off the text itself, because
 * they ARE the tone. Egyptian Arabic first, MSA where it is what people
 * actually type.
 */

import { analyzeMessage, findPhrase, phraseWords } from './lexicon-match.js';

/**
 * @typedef {'anger'|'frustration'|'urgency'|'sarcasm'|'thanks'|'satisfaction'} Emotion
 *
 * @typedef {Object} EmotionSignal
 * @property {Emotion} emotion
 * @property {number} intensity - 0..1, how strong the reading is
 * @property {string} matched - the phrase that triggered it (for traces)
 * @property {boolean} negative - true for anger/frustration/urgency/sarcasm
 */

/**
 * كل حالة ومعاها العبارات اللي بتدل عليها.
 *
 * `weight` هو شدة الحالة الأساسية. بتزيد لو العميل كرر علامات تعجب أو
 * كتب بحروف مكررة (زي "خلااااص")، لأن دي إشارات نبرة حقيقية في الكتابة
 * العربية اليومية.
 */
export const EMOTION_CATEGORIES = [
    {
        emotion: 'sarcasm',
        negative: true,
        weight: 0.8,
        phrases: [
            'شكرا على الخدمة الممتازة', 'شكرًا على الخدمة الممتازة',
            'شكرا على الخدمة الرائعة', 'برافو عليكم بجد',
            'خدمة ممتازة بجد', 'خدمة ممتازة فعلا', 'خدمة ممتازة والله',
            'ايه الروعة دي', 'إيه الروعة دي', 'ايه الدقة دي',
            'ما شاء الله على السرعة', 'ماشاء الله على السرعة',
            'تسلم ايدكم بجد', 'حلو اوي كده', 'جميل جدا كده',
            'يا سلام على الدعم', 'يا سلام على السرعة',
            'دعم محترم اوي', 'دعم محترم جدا', 'شغل محترف بجد',
            'انا مبسوط جدا بصراحة', 'تحفة بجد', 'عاش يا بطل',
            'الله ينور عليكم', 'ربنا يكرمكم على الرد السريع',
            'بجد مجهود جبار', 'خدمة عملاء من الاخر',
            'اسبوع وانتوا بتردوا', 'شهر وانتوا بتردوا',
            'يعني انا مستني من امبارح وده الرد', 'ده رد يعني'
        ]
    },
    {
        emotion: 'anger',
        negative: true,
        weight: 0.9,
        phrases: [
            'انا غضبان', 'انا زعلان جدا', 'انا متعصب', 'اتعصبت',
            'مقرف', 'قرف', 'زبالة', 'حرامية', 'نصب', 'نصابين',
            'هبلغ عنكم', 'هرفع عليكم قضية', 'هشتكيكم', 'هشتكي عليكم',
            'هوديكم المحكمة', 'حماية المستهلك', 'هفضحكم',
            'هلغي الاشتراك', 'عايز الغي الاشتراك حالا', 'هسيب المنصة',
            'عايز فلوسي', 'رجعولي فلوسي', 'عايز استرجع فلوسي',
            'ده استهبال', 'بتستهبلوا', 'بتضحكوا علينا', 'بتنصبوا علينا',
            'كفاية كدب', 'كلام فارغ', 'خلاص كفاية', 'انا مش هستحمل',
            'يا محترمين', 'ايه الاهمال ده', 'إيه الإهمال ده',
            'ده مش معقول خالص', 'مستحيل يحصل كده', 'حاجة تجنن',
            'انت بتهزر معايا', 'بتهزروا معايا'
        ]
    },
    {
        emotion: 'frustration',
        negative: true,
        weight: 0.6,
        phrases: [
            'كل مرة نفس المشكلة', 'كل شوية نفس المشكلة', 'تاني نفس المشكلة',
            'نفس المشكلة من اسبوع', 'من اسبوع وانا بحاول', 'من كام يوم وانا بحاول',
            'مفيش فايدة', 'ملهاش حل', 'مش لاقي حل', 'تعبت خلاص',
            'زهقت', 'زهقان', 'زهقانة', 'قرفت', 'مليت', 'يأست', 'استسلمت',
            'محدش بيرد عليا', 'محدش رد عليا', 'مبعتلكم كذا مرة',
            'بعتلكم كذا مرة', 'كلمتكم كذا مرة', 'جربت كل حاجة',
            'عملت كل اللي قلتوه', 'عملت كل الخطوات وبرضه',
            'وبرضه مش شغال', 'وبرضه نفس الحاجة', 'ومفيش جديد',
            'بقالي فترة طويلة', 'الموضوع طول اوي', 'خدت وقت كتير',
            'انا تعبان من الموضوع ده', 'مش عارف اعمل ايه تاني'
        ]
    },
    {
        emotion: 'urgency',
        negative: true,
        weight: 0.7,
        phrases: [
            'ضروري', 'ضروري جدا', 'مستعجل', 'مستعجلة', 'على وجه السرعة',
            'حالا', 'حالًا', 'دلوقتي حالا', 'في اسرع وقت', 'بسرعة لو سمحت',
            'الشغل واقف', 'شغلي واقف', 'الشغل متعطل', 'المحل واقف',
            'العملاء مستنيين', 'العملاء بيزعقوا', 'العملاء زهقوا',
            'خسران فلوس', 'بخسر فلوس', 'بخسر عملاء', 'بخسر شغل',
            'عندي حملة النهاردة', 'عندي عرض النهاردة', 'النهاردة اخر يوم',
            'باقي ساعة', 'باقي ساعتين', 'قبل بكرة', 'قبل الظهر',
            'ارجوكم بسرعة', 'ارجوك بسرعة', 'محتاج حل النهاردة',
            'محتاج حل دلوقتي', 'مش مستني كتير'
        ]
    },
    {
        emotion: 'thanks',
        negative: false,
        weight: 0.7,
        phrases: [
            'شكرا ليك', 'شكرًا ليك', 'شكرا لك', 'شكرا جدا', 'شكرًا جدًا',
            'متشكر', 'متشكرة', 'متشكر جدا', 'مشكور', 'مشكورة',
            'تسلم', 'تسلمي', 'تسلم ايدك', 'ربنا يخليك', 'ربنا يكرمك',
            'الله يبارك فيك', 'جزاك الله خير', 'ماقصرت', 'ما قصرت',
            'انا ممتن', 'شكرا على المساعدة', 'شكرا على المجهود',
            'شكرا على التوضيح', 'شكرا على الرد', 'شكرا على الشرح'
        ]
    },
    {
        emotion: 'satisfaction',
        negative: false,
        weight: 0.7,
        phrases: [
            'اشتغلت', 'اشتغل', 'ضبطت', 'ضبط كده', 'تظبطت', 'تمام كده',
            'تمام خلاص', 'حلوة كده', 'الحمد لله اشتغلت', 'الحمد لله ضبطت',
            'المشكلة اتحلت', 'اتحلت', 'خلاص اتحلت', 'ماشي كده',
            'فهمت كده', 'فهمت خلاص', 'وضحت', 'وضحت كده', 'دلوقتي فهمت',
            'كده تمام', 'كده مظبوط', 'شغال دلوقتي', 'بقى شغال',
            'جميل كده', 'ممتاز كده', 'ده اللي كنت محتاجه'
        ]
    }
];

/**
 * بيوحّد النص قبل المطابقة: بيشيل التشكيل والتطويل، ويوحّد الألف والياء
 * والتاء المربوطة وعلامات الترقيم.
 *
 * Without this the detector matched raw text, so «تم، شكرًا» missed a
 * phrase list containing «تم، شكرا» — the tanween alone was enough. Real
 * customers type with and without diacritics interchangeably, and the
 * Telegram keyboard sends the label verbatim, tanween included. Folding
 * both sides is the only way the lists stay small AND match.
 *
 * Deliberately lighter than the full normalizer in normalizer.js: these
 * are conversational phrases, and stripping clitics or resolving synonyms
 * here would make short phrases collide with each other.
 *
 * @param {string} text
 * @returns {string}
 */
export function foldForMatch(text) {
    return String(text ?? '')
        .replace(/[\u064B-\u0652\u0670]/g, '')   // tashkeel and tanween
        .replace(/\u0640/g, '')                    // tatweel
        .replace(/[أإآٱ]/g, 'ا')
        .replace(/ى/g, 'ي')
        .replace(/ة/g, 'ه')
        .replace(/[،,.!؟?]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

/** Each lexicon's phrases split into words once, not on every message. */
const SPLIT = new WeakMap();
function wordsOf(category) {
    let words = SPLIT.get(category);
    if (!words) { words = category.phrases.map(phraseWords); SPLIT.set(category, words); }
    return words;
}

/** علامات نبرة في الكتابة نفسها، بتزوّد شدة الحالة. */
function toneBoost(text) {
    let boost = 0;
    if (/[!؟]{2,}/.test(text)) boost += 0.1;          // !!! أو ؟؟؟
    if (/(.)\1{2,}/.test(text)) boost += 0.1;          // خلااااص
    if (text.length > 200) boost += 0.05;              // رسالة طويلة = انفعال
    return boost;
}

/**
 * @param {string} rawText - رسالة العميل زي ما هي
 * @param {Object} [options]
 * @param {Set<Emotion>|Emotion[]} [options.enabled] - الحالات المسموح باكتشافها.
 *   لو مااتبعتش، كل الحالات شغّالة.
 * @returns {EmotionSignal|null}
 */
export function detectEmotion(rawText, { enabled, analysis = null } = {}) {
    const text = String(rawText || '').trim();
    if (!text) return null;

    const allowed = enabled ? (enabled instanceof Set ? enabled : new Set(enabled)) : null;
    const boost = toneBoost(text);
    // Tone markers are read off the text (they are punctuation), but phrase
    // matching happens on whole folded words.
    const a = analysis || analyzeMessage(text);

    for (const category of EMOTION_CATEGORIES) {
        if (allowed && !allowed.has(category.emotion)) continue;
        // A negated phrase is not that emotion («مش مستعجل»). A positive one
        // must also be asserted: a thank-you in a question is not a thank-you.
        const counts = (hit) => !hit.negated && (category.negative || hit.asserted);
        const matched = category.phrases.find((phrase, i) => findPhrase(a, wordsOf(category)[i]).some(counts));
        if (!matched) continue;
        return {
            emotion: category.emotion,
            intensity: Math.min(1, Number((category.weight + boost).toFixed(2))),
            matched,
            negative: category.negative
        };
    }
    return null;
}

/**
 * «المشكلة خلصت» ولا «لسه موجودة»؟
 *
 * The engine cannot read this off the evidence: a thank-you and a complaint
 * both produce tokens, and confidence in the diagnosed scenario is
 * identical either way. It has to come from the words themselves.
 *
 * This matters more than it looks. Without it the engine kept re-answering
 * an already-answered scenario, because "تم الحل" looked exactly like new
 * evidence for the same problem.
 *
 * Deliberately narrow: only phrases that unambiguously mean one or the
 * other. Anything else returns null, and the engine falls back to its
 * normal reasoning rather than acting on a guess about how the customer
 * feels.
 */
export const RESOLVED_PHRASES = [
    // «تمت» alone is NOT here: «تمت عملية الدفع بس الاشتراك مش ظاهر» says the
    // payment went through, not that the problem is solved.
    'تم الحل', 'اتحلت', 'اتحل', 'المشكلة اتحلت', 'خلاص اتحلت', 'حلت',
    'تم، شكرا', 'تم شكرا', 'تمام شكرا', 'شكرا تم', 'تمام كده',
    'اشتغلت', 'اشتغل', 'ضبطت', 'ظبطت', 'تظبطت', 'بقى شغال', 'شغال دلوقتي',
    'الحمد لله اشتغلت', 'الحمد لله ضبطت', 'ماشي كده', 'كده تمام', 'كده مظبوط',
    // English, so the English «did that solve it?» buttons round-trip (G-L1-4).
    'resolved', 'solved', 'fixed', 'it works', 'it worked', 'works now', 'working now'
];

export const UNRESOLVED_PHRASES = [
    'المشكلة لسه موجودة', 'لسه عندي نفس المشكلة', 'لسه نفس المشكلة',
    'لسه المشكلة موجودة', 'لسه مش شغال', 'برضه مش شغال', 'مازالت المشكلة',
    'لسه مش ظابط', 'لسه مش ضابط', 'الحل مانفعش', 'مانفعش', 'ماظبطش',
    'جربت ومانفعش', 'عملت كده ومانفعش',
    'still having the issue', 'still having the same issue', 'still not working', 'not working',
    'still broken', 'didnt work', 'doesnt work', 'not fixed', 'not resolved'
];

const RESOLVED_WORDS = RESOLVED_PHRASES.map(phraseWords);
const UNRESOLVED_WORDS = UNRESOLVED_PHRASES.map(phraseWords);

/**
 * @param {string} rawText
 * @returns {'resolved'|'unresolved'|null}
 */
export function detectResolutionSignal(rawText, { analysis = null } = {}) {
    const text = String(rawText || '').trim();
    if (!text) return null;
    const a = analysis || analyzeMessage(text);

    // Unresolved is checked FIRST: the customer saying it is still broken
    // must always win over anything else in the same message.
    if (UNRESOLVED_WORDS.some((words) => findPhrase(a, words).length > 0)) return 'unresolved';

    // Every "it worked" that is asserted (not asked, not conditional). The
    // LAST one decides: «ما اشتغلش الأول بس دلوقتي اشتغل» ends solved, «اشتغل
    // يوم وبعدين ما اشتغلش» ends broken. A negated "it worked" is a
    // statement that it did not (G-L1-2).
    let last = null;
    for (const words of RESOLVED_WORDS) {
        for (const hit of findPhrase(a, words)) {
            if (!hit.asserted) continue;
            if (!last || hit.start > last.start) last = hit;
        }
    }
    if (!last) return null;
    return last.negated ? 'unresolved' : 'resolved';
}

/**
 * Threats — legal action, a complaint to an authority, public exposure,
 * cancelling or demanding a refund. A subset of the anger phrases, read as
 * its own signal because Decision treats it differently (owner decision D3,
 * WP4): a threat escalates on its own, plain anger only with context.
 */
export const THREAT_PHRASES = Object.freeze([
    'هبلغ عنكم', 'هرفع عليكم قضية', 'هشتكيكم', 'هشتكي عليكم',
    'هوديكم المحكمة', 'حماية المستهلك', 'هفضحكم',
    'هلغي الاشتراك', 'عايز الغي الاشتراك حالا', 'هسيب المنصة',
    'عايز فلوسي', 'رجعولي فلوسي', 'عايز استرجع فلوسي'
]);
const THREAT_WORDS = THREAT_PHRASES.map(phraseWords);

/**
 * A threat that is not negated («مش هشتكيكم») and not asked. A condition
 * does not disarm it: «لو ما اتحلتش هشتكيكم» is still a threat.
 * @returns {{matched: string}|null}
 */
export function detectThreat(rawText, { analysis = null } = {}) {
    const text = String(rawText || '').trim();
    if (!text) return null;
    const a = analysis || analyzeMessage(text);
    const i = THREAT_WORDS.findIndex((words) => findPhrase(a, words).some((hit) => !hit.negated && !hit.question));
    return i === -1 ? null : { matched: THREAT_PHRASES[i] };
}

/** الحالات اللي المفروض توصّل العميل لموظف بشري على طول. */
export const ESCALATING_EMOTIONS = Object.freeze(['anger', 'sarcasm']);

/**
 * @param {EmotionSignal|null} signal
 * @returns {boolean}
 */
export function shouldEscalateForEmotion(signal) {
    return Boolean(signal && ESCALATING_EMOTIONS.includes(signal.emotion));
}
