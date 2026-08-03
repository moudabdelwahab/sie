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
 * Substring matching on the RAW text, same as small-talk.js, for the
 * same reason: these are conversational phrases whose meaning survives
 * clitics and typos poorly, and normalizing first would strip the very
 * markers ("!!!", repeated letters) that carry the tone. Egyptian
 * Arabic first, MSA where it is what people actually type.
 */

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
const CATEGORIES = [
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
            'زهقت', 'زهقان', 'قرفت', 'مليت', 'يأست', 'استسلمت',
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
export function detectEmotion(rawText, { enabled } = {}) {
    const text = String(rawText || '').trim();
    if (!text) return null;

    const allowed = enabled ? (enabled instanceof Set ? enabled : new Set(enabled)) : null;
    const boost = toneBoost(text);

    for (const category of CATEGORIES) {
        if (allowed && !allowed.has(category.emotion)) continue;
        const matched = category.phrases.find((phrase) => text.includes(phrase));
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
 * جملة الاعتراف بحالة العميل. بتتحط قدّام رد المحرك العادي، مش بدله —
 * عشان العميل يحس إن حد سمعه من غير ما يضيع الحل.
 *
 * Deliberately NOT a full reply and NOT a question. A question here
 * would cost the customer a turn to answer something that adds no
 * diagnostic information, and the pipeline is about to ask its own.
 */
export const EMOTION_ACKNOWLEDGEMENT = Object.freeze({
    anger: {
        ar: 'أنا آسف بجد على اللي حصل، وده مش المستوى اللي المفروض تلاقيه. خليني أشوفلك حل حالًا.',
        en: "I'm genuinely sorry about this — it isn't the standard you should be getting. Let me sort it out right now."
    },
    frustration: {
        ar: 'معلش والله، وأنا حاسس إن الموضوع طوّل معاك. خليني أحاول أساعدك بجد المرة دي.',
        en: "I'm sorry this has dragged on. Let me actually get it sorted for you this time."
    },
    urgency: {
        ar: 'تمام، فاهم إن الموضوع مستعجل — هختصر على طول.',
        en: "Understood, this is urgent — I'll get straight to it."
    },
    sarcasm: {
        ar: 'واضح إن التجربة كانت مضايقة، وده حقك تمامًا. خليني أعوّضك بحل سريع.',
        en: "I can tell this has been a bad experience, and that's fair. Let me make it right quickly."
    },
    thanks: {
        ar: 'العفو، ده واجبي.',
        en: "You're very welcome."
    },
    satisfaction: {
        ar: 'تمام، مبسوط إنها ظبطت معاك.',
        en: 'Great — glad that sorted it.'
    }
});

/**
 * @param {Emotion} emotion
 * @param {'ar'|'en'} [language]
 * @returns {string|null}
 */
export function acknowledgementFor(emotion, language = 'ar') {
    const entry = EMOTION_ACKNOWLEDGEMENT[emotion];
    if (!entry) return null;
    return entry[language === 'en' ? 'en' : 'ar'];
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
