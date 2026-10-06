/**
 * small-talk.js
 * ------------------------------------------------------------
 * Recognizes short, self-contained conversational moves that carry no
 * diagnostic content of their own, so sie-chat-bridge.js can answer
 * them directly instead of routing them through the full Language ->
 * Diagnostics -> Ranking -> Decision pipeline.
 *
 * Why this exists: none of these words appear in the technical
 * glossary or any scenario's evidence signature, so they never produce
 * a confident hypothesis. Before this module existed, every one of
 * them fell through to the Decision Engine's generic
 * ASK_CLARIFYING_QUESTION — the exact same static text every time,
 * completely ignoring what the customer actually said, for up to
 * MAX_CLARIFYING_QUESTIONS turns before escalating.
 *
 * Arabic-only by deliberate choice (MSA + Egyptian + Gulf/Khaleeji +
 * Levantine phrasing) — no English or Arabizi/Latin-script entries
 * here. sie/language/arabizi-map.local.js already owns Arabizi
 * transliteration as a normalization concern; duplicating that here
 * would just be a second, less-maintained copy of the same mapping.
 *
 * Covered categories, in priority/check order (first match wins):
 *  - human_request : an explicit ask to speak to a human agent.
 *  - frustration    : the customer is clearly frustrated with the bot
 *    itself (not describing a technical problem). Both of these route
 *    to a REAL escalation in sie-chat-bridge.js (an actual ticket/
 *    handoff gets created) rather than a plain canned reply — there is
 *    nothing left to "clarify" once someone says this.
 *  - identity       : "انت مين؟"
 *  - platform_info  : "مدعوم ايه؟" — general questions about the
 *    product itself, not an account-specific issue.
 *  - greeting       : "مرحبا"
 *  - farewell       : "شكرا" / "مع السلامة"
 *  - apology        : "معلش" / "اسف"
 *  - wellbeing      : "ازيك"
 *  - compliment     : "تمام كده حلو"
 *
 * Deliberately excluded on purpose: bare acknowledgments like "تمام" /
 * "أيوه" / "لأ" on their own are NOT covered here, even though they're
 * extremely common — the Decision Engine's own targetQuestion flow
 * relies on exactly these words as real evidence answers when it asks
 * the customer a yes/no discriminating question mid-diagnosis. Treating
 * them as small talk would silently swallow genuine diagnostic answers.
 *
 * Deliberately conservative, per category:
 *  - Each category has its OWN word-count cap (maxWords): a short
 *    message is very unlikely to also carry real diagnostic content,
 *    so short categories (greeting, farewell, wellbeing) stay tight,
 *    while human_request/platform_info allow a little more room since
 *    those phrasings tend to run a few words longer. A message over
 *    its category's cap is left completely untouched for the normal
 *    pipeline — this module never discards real diagnostic evidence.
 *  - Matching is whole words (sie/language/lexicon-match.js, WP3): the
 *    entries stay literal Arabic text, but a phrase only matches as whole
 *    words, never inside a longer one («هلا» is not in «الاستهلاك»), and a
 *    negated phrase does not count («مش عايز اتكلم مع موظف» is not a
 *    request for one). Stretched spellings («مرحبااا») are folded first.
 *  - `coversWholeMessage` says whether the pleasantry IS the message.
 *    It is false when the message carries diagnostic content (a glossary
 *    token that describes a problem), and false when any word is left
 *    over that neither a small-talk phrase nor a filler word explains:
 *    «اهلا الواتساب واقف» is a greeting AND an outage, and the outage must
 *    reach diagnosis. Only a whole-message pleasantry may be answered
 *    instead of diagnosed (G-L1-3).
 */

import { analyzeMessage, findPhrase, phraseWords } from './lexicon-match.js';

export const SMALL_TALK_CATEGORIES = [
    {
        type: 'human_request',
        maxWords: 8,
        phrases: [
            'عايز اتكلم مع حد', 'عايزة اتكلم مع حد', 'عايزين نتكلم مع حد',
            'عايز اتكلم مع موظف', 'عايزة اتكلم مع موظف', 'عايز اتكلم مع شخص',
            'عايز اتكلم مع مسؤول', 'عايز اتكلم مع مدير', 'عايز حد يرد عليا',
            'عايزة حد يرد عليا', 'عايز حد يكلمني', 'عايز حد يساعدني بنفسه',
            'عايز موظف', 'عايزة موظف', 'عايز مسؤول', 'عايز مدير',
            'كلمني حد', 'كلموني حد', 'كلمني موظف', 'وصلني بموظف', 'وصلني بحد',
            'وصلني بمسؤول', 'حولني لموظف', 'حولني لحد', 'حولوني لموظف',
            'عايز دعم بشري', 'عايز فريق الدعم', 'عايز اكلم فريق الدعم',
            'فريق الدعم البشري', 'دعم بشري لو سمحت', 'مش عايز اكلم بوت',
            'مش عايزة اكلم بوت', 'مش عايز روبوت', 'بس انسان يرد',
            'حد حقيقي يرد', 'عايز اتكلم مع انسان', 'عايز اكلم واحد حقيقي',
            'ينفع اتكلم مع حد', 'ممكن اتكلم مع حد', 'ممكن اتكلم مع موظف',
            'حد يقدر يساعدني بنفسه', 'عايز خدمة عملاء', 'خدمة العملاء فين',
            'وينكم يا خدمة عملاء'
        ]
    },
    {
        type: 'frustration',
        maxWords: 6,
        phrases: [
            'انت غبي', 'غبي انت', 'انتي غبية', 'انت هبل', 'انتي هبلة',
            'انت مش فاهم', 'انتي مش فاهمة', 'مش فاهم حاجة', 'بتضيع وقتي',
            'ضيعت وقتي', 'زهقت منك', 'زهقت خالص', 'تعبت منك', 'تعبت معاك',
            'مفيش فايدة منك', 'ملكش لازمة', 'انت بايظ', 'انت مش بتفهم',
            'مش قادر تفهم', 'بلا فايدة', 'انت فاشل', 'خدمة زبالة',
            'بوت غبي', 'بوت فاشل', 'بلاش البوت ده'
        ]
    },
    {
        type: 'identity',
        maxWords: 6,
        phrases: [
            'انت مين', 'إنت مين', 'انتي مين', 'انتوا مين', 'مين انت', 'مين إنت',
            'من انت', 'من حضرتك', 'مين حضرتك', 'انت مين اصلا', 'انت مين بالظبط',
            'انت ايه', 'انت شنو', 'مين اللي بيرد', 'مين اللي بيكلمني',
            'مين اللي بكلمه', 'بكلم مين', 'بتكلم مين', 'مين اللي معايا',
            'مين معايا دلوقتي', 'انت بوت', 'انتي بوت', 'انتوا بوت', 'انت روبوت',
            'انتي روبوت', 'انت انسان', 'انتي انسانة', 'انت حقيقي', 'انتي حقيقية',
            'انت شخص حقيقي', 'هل انت بوت', 'هل انتي بوت', 'هل انت انسان',
            'هل انت حقيقي', 'بشتغل مع مين', 'بحكي مع مين', 'مين انت اصلا',
            'انت مساعد ولا مين', 'ده بوت ولا موظف'
        ]
    },
    {
        type: 'platform_info',
        maxWords: 8,
        phrases: [
            'مدعوم ايه', 'مدعوم ده ايه', 'مدعوم دي ايه', 'ايه هي مدعوم',
            'ايه هو مدعوم', 'ايه هو مدعوم بالظبط',
            'انتوا بتعملوا ايه', 'انتوا بتقدموا ايه', 'انتوا شركة ايه',
            'الخدمة دي بتعمل ايه', 'المنصة دي بتعمل ايه', 'الموقع ده بيعمل ايه',
            'بتشتغلوا ازاي', 'بتقدموا ايه بالظبط', 'تقدر تساعدني في ايه',
            'ممكن تساعدني في ايه', 'انت بتساعد في ايه', 'الشركة دي شغالة في ايه',
            'ايه هي الخدمة', 'عندكم ايه', 'بتوفروا ايه', 'ايه اللي بتقدموه',
            'ايه هي خدماتكم', 'ايه هي مميزات مدعوم', 'مدعوم بتساعد في ايه',
            'ليه استخدم مدعوم', 'ايه فايدة مدعوم', 'ازاي مدعوم بيشتغل',
            'احكيلي عن مدعوم', 'عرفني على مدعوم', 'وضحلي مدعوم ايه',
            // Production trace (two sessions, 2026-09): "كلمني عن منصة مدعوم"
            // matched nothing here and fell through to FALLBACK in one session
            // and an unrelated clarifying question in the other.
            'كلمني عن مدعوم', 'كلمني عن منصة مدعوم', 'كلمني عن المنصة', 'قولي عن مدعوم',
            'ايه هي خطط الاشتراك', 'عندكم باقات ايه'
        ]
    },
    {
        type: 'greeting',
        maxWords: 4,
        phrases: [
            'مرحبا', 'مرحبتين', 'مرحبا بيك', 'مرحبا بك', 'أهلا', 'اهلا',
            'أهلين', 'اهلين', 'أهلا وسهلا', 'اهلا وسهلا', 'هلا', 'هلا بيك',
            'هلا فيك', 'هلا والله', 'حياك', 'حياك الله', 'حياكم', 'حياكم الله',
            'يا هلا', 'يا هلا وغلا', 'يا مرحبا', 'يا اهلا', 'السلام عليكم',
            'السلام عليكم ورحمة الله', 'وعليكم السلام',
            'صباح الخير', 'صباح النور', 'صباحو', 'صباح الفل',
            'صباح الورد', 'صباح الخيرات', 'مساء الخير', 'مساء النور',
            'مسا الخير', 'مسا النور', 'مساء الفل', 'تصبح على خير',
            'تصبحوا على خير', 'هاي', 'هلو', 'هالو', 'يا هلا فيك',
            'يا مرحبا بيك', 'صباح جميل', 'يوم سعيد', 'صباح النشاط',
            'كيفكم اليوم', 'نورت', 'نورتونا', 'تشرفنا', 'مرحبا اخي',
            'مرحبا اختي', 'حياك ياغالي', 'هلا بالغالي', 'يا مرحبتين',
            'يا هلا ومية هلا'
        ]
    },
    {
        type: 'farewell',
        maxWords: 4,
        phrases: [
            'شكرا', 'شكراً', 'شكرا جزيلا', 'شكرا كتير', 'شكرا ليك',
            'شكرا لحضرتك', 'الف شكر', 'الف شكر ليك', 'متشكر', 'متشكرة',
            'متشكرين', 'تسلم', 'تسلم ايدك', 'تسلم ايديك', 'يسلمو',
            'يسلمو ايدك', 'يعطيك العافية', 'الله يعطيك العافية', 'الله يخليك',
            'ربنا يخليك', 'الله يعافيك', 'يعطيك الصحة', 'مشكور', 'مشكورة',
            'مشكورين', 'مأجور', 'جزاك الله خير', 'جزاكم الله خير',
            'بارك الله فيك', 'بارك الله فيكم', 'تمام كده شكرا', 'ماشي شكرا',
            'اوكي شكرا', 'حلو شكرا', 'تسلم يا غالي', 'تسلملي', 'ربنا يكرمك',
            'الله يكرمك', 'كتر خيرك', 'كثر خيرك', 'من عيوني', 'تحت امرك',
            'لا شكر على واجب', 'العفو', 'مع السلامة', 'مع السلامه',
            'في امان الله', 'بأمان الله', 'الله معاك', 'الله معاكم',
            'باي', 'باي باي', 'وداعا', 'الى اللقاء', 'نتقابل بعدين',
            'اشوفك بعدين', 'نراكم قريبا', 'دمتم بخير', 'يعافيك ربي',
            'تسلم يمينك', 'ماشالله عليك', 'ربنا يوفقك', 'بالتوفيق',
            'تحياتي', 'مع تحياتي'
        ]
    },
    {
        type: 'apology',
        maxWords: 4,
        phrases: [
            'اسف', 'آسف', 'اسفة', 'آسفة', 'اسفين', 'معلش', 'معلش يعني',
            'معذرة', 'عذرا', 'عذراً', 'سامحني', 'سامحيني', 'سامحونا',
            'اعتذر', 'بعتذر', 'بنعتذر', 'معليش', 'ماشي معلش', 'حصل خير',
            'لا مؤاخذة'
        ]
    },
    {
        type: 'wellbeing',
        maxWords: 4,
        phrases: [
            'ازيك', 'ازيك انت', 'ازيكم', 'ازيك عامل ايه', 'عامل ايه',
            'عاملة ايه', 'عاملين ايه', 'اخبارك ايه', 'اخبارك', 'شو اخبارك',
            'شو الاخبار', 'ايه الاخبار', 'كيفك', 'كيفك انت', 'كيفكم',
            'كيف حالك', 'كيف حالكم', 'كيف الحال', 'شلونك', 'شلونك انت',
            'شلونكم', 'شخبارك', 'شخبارك انت', 'وينك', 'وين انت', 'وينكم',
            'انت طيب', 'انتي طيبة', 'صحتك ايه', 'احوالك ايه', 'ايه احوالك',
            'حالك ايه', 'امورك ماشية'
        ]
    },
    {
        type: 'compliment',
        maxWords: 4,
        phrases: [
            'جامد', 'برافو', 'تمام كده حلو', 'شغلك حلو', 'حلو اوي',
            'ممتاز', 'رائع', 'تمام قوي', 'حلو كده', 'شاطر', 'ما شاء الله عليك',
            'احسنت', 'عاش', 'فنان'
        ]
    }
];

/** Words that carry no content of their own inside a pleasantry. Folded. */
export const FILLER_WORDS = Object.freeze(new Set([
    'يا', 'و', 'انا', 'انت', 'انتي', 'انتوا', 'حضرتك', 'بجد', 'اوي', 'قوي', 'جدا', 'خالص', 'كده', 'ده', 'دي',
    'والله', 'لو', 'سمحت', 'سمحتي', 'بس', 'ياريت', 'الله', 'عليك', 'عليكم', 'ليك', 'ليكي', 'لك', 'يعني', 'طيب',
    'اه', 'ايوه', 'تمام', 'ماشي', 'اوك', 'اوكي', 'كمان', 'برضه', 'هنا', 'please', 'pls', 'hi', 'hello', 'ok', 'thanks', 'thank', 'you'
]));

const PHRASE_WORDS = SMALL_TALK_CATEGORIES.map((category) => ({
    type: category.type,
    maxWords: category.maxWords,
    phrases: category.phrases.map((phrase) => ({ phrase, words: phraseWords(phrase) }))
}));

/** Every word is inside some small-talk phrase, is a filler word, or is addressed («يا باشا»). */
function coversEveryWord(analysis) {
    const covered = new Array(analysis.words.length).fill(false);
    for (const category of PHRASE_WORDS) {
        for (const { words } of category.phrases) {
            for (const hit of findPhrase(analysis, words)) {
                if (hit.negated) continue;
                for (let i = hit.start; i < hit.end; i++) covered[i] = true;
            }
        }
    }
    return analysis.words.every((w, i) => covered[i] || FILLER_WORDS.has(w) || analysis.words[i - 1] === 'يا');
}

/**
 * @param {string} rawText - the text Layer 1 read (normalize()'s rawText)
 * @param {Object} [options]
 * @param {boolean} [options.diagnosticContent] - whether the message carries a problem token
 * @param {Object} [options.analysis] - analyzeMessage(rawText), when the caller already has it
 * @returns {{ type: 'human_request'|'frustration'|'identity'|'platform_info'|'greeting'|'farewell'|'apology'|'wellbeing'|'compliment', matched: string, coversWholeMessage: boolean } | null}
 */
export function detectSmallTalk(rawText, { diagnosticContent = false, analysis = null } = {}) {
    const a = analysis || analyzeMessage(rawText);
    const wordCount = a.words.length;
    if (wordCount === 0) return null;

    for (const category of PHRASE_WORDS) {
        if (wordCount > category.maxWords) continue;
        const match = category.phrases.find(({ words }) => findPhrase(a, words).some((hit) => !hit.negated));
        if (!match) continue;
        return {
            type: category.type,
            matched: match.phrase,
            coversWholeMessage: !diagnosticContent && coversEveryWord(a)
        };
    }
    return null;
}

