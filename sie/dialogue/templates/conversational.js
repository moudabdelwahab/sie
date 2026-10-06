/**
 * templates/conversational.js — Dialogue's texts for the conversational routes.
 * ------------------------------------------------------------
 * The replies on the routes that do not (yet) go through renderDecision():
 * small talk, the emotion acknowledgement, memory, and the ticket
 * confirmation prompt. Until WP3 the first three lived in Layer 1
 * (small-talk.js, emotion-detector.js, memory-intent.js), so the module that
 * DETECTS a greeting also owned what the engine SAYS back. Layer 1 now only
 * detects; this file is where the words are.
 *
 * The texts are unchanged by the move.
 */
import { neutralizeUserText } from '../../language/text-safety.js';

/**
 * Bilingual canned replies for each detected small-talk type. They never
 * go through renderDecision()/a Decision object — sie-chat-bridge.js uses
 * them directly on the small-talk route (until WP4 gives that route a
 * Decision). Moved here from sie/language/small-talk.js in WP3: Layer 1
 * detects, Dialogue speaks.
 *
 * human_request and frustration have no entries here: sie-chat-bridge.js
 * routes both into a real ESCALATE_TO_HUMAN Decision (not a plain
 * WAIT_FOR_USER reply), with their own text kept next to that flow in
 * sie-chat-bridge.js instead of duplicated here.
 */
export const SMALL_TALK_REPLIES = {
    identity: {
        ar: 'أنا المساعد الآلي بتاع مدعوم، وهساعدك تحل أي مشكلة تقنية أو استفسار عن حسابك. وضّحلي المشكلة اللي حضرتك واجهتها ونكمل [[icon:smile]]',
        en: "I'm Mad3oom's automated support assistant, and I can help with technical issues or questions about your account. What's going on? [[icon:smile]]"
    },
    platform_info: {
        ar: 'مدعوم منصة بتساعد الشركات تدير خدمة العملاء والواتساب بتاعها في مكان واحد، وأنا المساعد الآلي بتاعها بجاوب على استفساراتك التقنية. عندك مشكلة معينة تحب أساعدك فيها؟ [[icon:smile]]',
        en: "Mad3oom is a platform that helps businesses manage their customer support and WhatsApp in one place, and I'm its automated assistant for technical questions. Is there a specific issue I can help you with? [[icon:smile]]"
    },
    greeting: {
        ar: 'أهلاً بيك! أنا هنا عشان أساعدك في أي مشكلة تقنية أو استفسار عن مدعوم — قولّي التفاصيل وهساعدك [[icon:smile]]',
        en: "Hi there! I'm here to help with any technical issue or question about Mad3oom — tell me what's going on and I'll help [[icon:smile]]"
    },
    farewell: {
        ar: 'العفو! لو احتجت أي حاجة تانية أنا موجود في أي وقت [[icon:smile]]',
        en: "You're welcome! I'm here anytime you need anything else [[icon:smile]]"
    },
    apology: {
        ar: 'معلش، مفيش داعي تعتذر! أنا هنا عشان أساعدك — كمل معايا [[icon:smile]]',
        en: "No worries at all, no need to apologize! I'm here to help — go ahead [[icon:smile]]"
    },
    wellbeing: {
        ar: 'تمام الحمد لله، شكرًا لسؤالك! تحب أساعدك في مشكلة معينة؟ [[icon:smile]]',
        en: "I'm doing well, thanks for asking! Is there something I can help you with? [[icon:smile]]"
    },
    compliment: {
        ar: 'شكرًا ليك! سعيد إني قدرت أساعدك. محتاج حاجة تانية؟ [[icon:smile]]',
        en: "Thank you! Glad I could help. Anything else you need? [[icon:smile]]"
    }
};

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

/**
 * ردود الذاكرة بالعربي.
 *
 * EVERY fact value goes through `neutralizeUserText` before it reaches a
 * reply, and it happens HERE rather than at the call site so that no future
 * caller can forget. These two templates are the only places in the engine
 * where customer-authored text is rendered into a message the engine sends as
 * itself, and replies leave through Telegram with `parse_mode: 'Markdown'`
 * and no escaping on the path. Without this, a stored note reading
 * `[اضغط هنا](https://…)` came back as a live hyperlink in the brand's voice.
 *
 * See sie/language/text-safety.js for the mechanism and
 * sie/trust/egress-guard.js for why this is a trust-boundary crossing.
 */
const quote = (facts) => facts.map((f) => `• ${neutralizeUserText(f?.value)}`).join('\n');

export const MEMORY_REPLIES = Object.freeze({
    saved: (facts) => `تمام، حفظتها 📝\n${quote(facts)}\n\nهفضل فاكرها في أي محادثة جاية.`,
    nothingToSave: 'قولّي الحاجة اللي عايزني أفتكرها بالظبط وأنا أحفظها.',
    recalled: (facts) => (facts.length === 0
        ? 'لسه مش فاكر أي حاجة عنك. لو حابب، قولّي معلومة وأنا أحفظها.'
        : `اللي فاكره عنك:\n${quote(facts)}`),
    forgotten: 'تمام، مسحت كل اللي كنت فاكره عنك.'
});

/**
 * The ticket-confirmation prompt and its buttons. Every button value must
 * classify to its intended polarity in Layer 1 (G-L1-4,
 * sie/language/tests/reply-polarity.test.mjs). Moved from the bridge.
 */
export const TICKET_CONFIRM_TEXT = Object.freeze({
    ar: 'تحب أفتحلك تذكرة دعم عشان فريقنا يتابع معاك؟ [[icon:ticket]]',
    en: 'Would you like me to open a support ticket so our team can follow up with you? [[icon:ticket]]'
});

export const TICKET_CONFIRM_OPTIONS = Object.freeze({
    ar: Object.freeze([
        Object.freeze({ label: '[[icon:check]] أيوه، افتحلي تذكرة', value: 'أيوه افتحلي تذكرة' }),
        Object.freeze({ label: '[[icon:cancel]] لأ، مش دلوقتي', value: 'لأ مش دلوقتي' })
    ]),
    en: Object.freeze([
        Object.freeze({ label: '[[icon:check]] Yes, open a ticket', value: 'yes open a ticket' }),
        Object.freeze({ label: '[[icon:cancel]] No, not now', value: 'no not now' })
    ])
});
