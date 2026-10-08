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

// ===================================================================
// Moved from sie-chat-bridge.js and sie-review-queue.js in WP4: every reply
// a conversational route sends is worded here (Layer 6). Texts unchanged
// unless marked NEW.
// ===================================================================

/** The follow-up promise for a declined ticket — must match what the team can honour. */
export const HUMAN_FOLLOWUP_HOURS = 24;

/**
 * ما بنقوله للعميل لما نسجّل المحادثة بدل ما نفتح تذكرة. No ticket number:
 * there is none.
 */
export const REVIEW_QUEUED_TEXT = Object.freeze({
    ar: `تمام، مش هفتح تذكرة. بس سجّلت المحادثة دي لفريق الدعم عشان يشوفوها، `
        + `وهيتواصلوا معاك خلال ${HUMAN_FOLLOWUP_HOURS} ساعة.`,
    en: `Understood — no ticket. I have flagged this conversation for the support team, `
        + `and they will get in touch within ${HUMAN_FOLLOWUP_HOURS} hours.`
});

/** The honest fallback when the review record could NOT be written: no promise. */
export const REVIEW_QUEUE_FAILED_TEXT = Object.freeze({
    ar: 'تمام، مش هفتح تذكرة. لو المشكلة فضلت، تواصل مع فريق الدعم من المنصة وهما هيساعدوك.',
    en: 'Understood — no ticket. If the problem persists, contact the support team from the platform.'
});

/** The escalation sentence, in front of the ticket question. */
export const ESCALATION_REPLY_TEXT = Object.freeze({
    human_request: {
        ar: 'تمام، هوصلك بفريق الدعم البشري دلوقتي وهيتواصلوا معاك في أقرب وقت [[icon:note]]',
        en: "Sure thing, I'll connect you with our human support team right away — they'll be in touch shortly [[icon:note]]"
    },
    frustration: {
        ar: 'أعتذر لو حسّيت إن الرد مش مفيد. هوصلك بفريق الدعم البشري دلوقتي عشان يقدروا يساعدوك بشكل مباشر [[icon:note]]',
        en: "I'm sorry this hasn't been helpful. I'll connect you with our human support team right away so they can help you directly [[icon:note]]"
    },
    // NEW (WP4): a threat is its own escalation reason (owner decision D3).
    threat: {
        ar: 'فاهم إن الموضوع ضايقك جدًا، وده حقك. هوصلك بفريق الدعم البشري دلوقتي عشان يتابعوا معاك بشكل مباشر [[icon:note]]',
        en: "I understand this has really upset you, and that's fair. I'll connect you with our human support team right away so they can follow up with you directly [[icon:note]]"
    }
});

/** «تم الحل» and nothing else is open. */
export const CONVERSATION_CLOSED_TEXT = Object.freeze({
    ar: 'تمام، مبسوط إنها اتظبطت معاك 🙌\nلو احتجت أي حاجة تانية أنا موجود في أي وقت.',
    en: "Great — glad that sorted it. I'm here whenever you need anything else."
});

/** NEW (WP4): one problem is solved and the conversation continues with another. */
export const RESOLVED_CONTINUE_TEXT = Object.freeze({
    ar: 'حلو إن دي اتحلت.',
    en: 'Good to hear that one is sorted.'
});

/** Tickets are switched off: said plainly. */
export const TICKET_DISABLED_TEXT = Object.freeze({
    ar: 'المشكلة دي محتاجة حد من فريق الدعم يشوفها، بس فتح التذاكر متوقف حاليًا من الإعدادات. '
        + 'تقدر تتواصل مع الفريق مباشرة وهما هيتابعوا معاك [[icon:note]]',
    en: 'This needs a member of the support team, but ticket creation is currently switched off in settings. '
        + 'Please contact the team directly and they will follow up with you [[icon:note]]'
});

/** The account already has an open ticket on this subject. */
export const TICKET_EXISTING_TEXT = Object.freeze({
    ar: (n) => `فيه تذكرة مفتوحة عندك في نفس الموضوع (رقم ${n}) والفريق شغّال عليها، فمش هفتح واحدة تانية عشان الموضوع مايتقسمش. أي تفاصيل تزوّدها هنا هتوصلهم على نفس التذكرة.`,
    en: (n) => `You already have an open ticket about this (#${n}) and the team is on it — I'll add nothing new rather than split it across two tickets. Anything you add here reaches them on that ticket.`
});

/**
 * NEW (WP4, G-L5-8): the trust boundary withheld the ticket on this turn.
 * Says so plainly, without claiming a ticket and without blaming the customer.
 */
export const TICKET_WITHHELD_TEXT = Object.freeze({
    ar: 'مقدرتش أفتح تذكرة من الرسالة دي. لو تحب أفتحلك تذكرة، اكتبلي المشكلة في جملة قصيرة وأنا أكمّل معاك [[icon:note]]',
    en: "I couldn't open a ticket from that message. If you'd like one, describe the problem in a short sentence and I'll take it from there [[icon:note]]"
});

/** «يفتكر اسم العميل» و«يفتكر آخر مشكلة» — in the greeting only. */
export function greetingPersonalisation({ name = null, lastIssue = null }, language = 'ar') {
    const lang = language === 'en' ? 'en' : 'ar';
    const parts = [];
    if (name) parts.push(lang === 'en' ? `Hi ${neutralizeUserText(name)},` : `أهلاً يا ${neutralizeUserText(name)}،`);
    const label = lastIssue ? (lastIssue[lang] || lastIssue.ar || null) : null;
    if (label) {
        parts.push(lang === 'en'
            ? `last time we looked at "${label}" — did that get sorted?`
            : `آخر مرة كنا بنشوف «${label}» — اتظبطت معاك؟`);
    }
    return parts.length ? `${parts.join(' ')}\n\n` : '';
}
