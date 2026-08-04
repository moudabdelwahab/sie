/**
 * sie-chat-bridge.js  —  INTERNAL TO SIE
 * ------------------------------------------------------------
 * ⚠️ Not a public surface. Mad3oom must import sie-runtime.js instead.
 * This file's entry point is runSieTurn(); the runtime wraps it as
 * getSieReply(). Anything reaching directly in here is coupling itself
 * to the orchestration order, which is free to change.
 *
 * The turn orchestrator: wires Language -> Diagnostics -> Ranking ->
 * Decision -> Knowledge -> Dialogue -> Action, in the exact order and
 * with the exact call contracts documented in each /sie module's README.
 * Nothing in /sie is imported for its internals — only its public
 * exports — so each module stays free to change shape behind them.
 *
 * SIE's own turn-by-turn memory is namespaced under botState.sie so it
 * never collides with chatbot-engine.js's own use of the same
 * chat_sessions.bot_state column when a customer's traffic moves between
 * engines (e.g. SIE access expires mid-conversation).
 *
 * Any failure anywhere in this pipeline returns null rather than
 * throwing, so the caller's existing fallback to the traditional engine
 * (and its own error handling) is exactly what applies. This module
 * itself never writes an error message to chat_messages.
 */
import { normalize } from '../sie/language/normalizer.js';
import { detectSmallTalk, SMALL_TALK_REPLIES } from '../sie/language/small-talk.js';
import { detectEmotion, acknowledgementFor, shouldEscalateForEmotion, detectResolutionSignal } from '../sie/language/emotion-detector.js';
import { activationThresholdForLevel } from '../sie/ranking/ranking-engine.js';
import { recallCustomerName, findOpenTicket, recallPreviousSession, rememberFacts, recallFacts, forgetFacts } from './sie-customer-memory.js';
import { detectMemoryIntent, MEMORY_REPLIES } from '../sie/language/memory-intent.js';
import { queueForHumanReview, REVIEW_QUEUED_TEXT, REVIEW_QUEUE_FAILED_TEXT } from './sie-review-queue.js';
import { processTurn } from '../sie/diagnostics/diagnostic-engine.js';
import { rankDiagnosticState } from '../sie/ranking/ranking-engine.js';
import { decide } from '../sie/decision/decision-engine.js';
import { ACTIONS, createEmptyDecisionState } from '../sie/decision/decision-types.js';
import { composeAnswerDecision } from '../sie/knowledge/answer-composer.js';
import { staticKnowledgeProvider } from '../sie/knowledge/static-knowledge.local.js';
import { renderDecision } from '../sie/dialogue/dialogue-renderer.js';
import { executeDecision, logTraceEvent } from '../sie/action/action-layer.js';
import { createRealSupabasePort } from '../sie/action/supabase-port.supabase.js';
import { buildTraceEvent } from '../sie/observability/trace-logger.js';
import { tryConsumeSieMessage, getSieSettings } from './sie-entitlement.js';
import { createScenarioCatalogSupabaseProvider } from '../sie/scenarios/scenario-catalog.supabase.js';

/**
 * الحالات اللي الإعدادات سامحة للمحرك يقراها.
 *
 * Each emotion has its own switch, so an operator who finds one category
 * misfiring can silence just that one instead of losing the whole layer.
 *
 * @param {Object} settings
 * @returns {string[]}
 */
function enabledEmotions(settings) {
    return EMOTION_SETTING_KEYS
        .filter(({ key }) => settings[key] !== false)
        .map(({ emotion }) => emotion);
}

/**
 * «يستخدم المقالات» لما يتقفل. مزوّد فاضي بدل ما نلف على الشرط في نص
 * answer-composer — الموديول يفضل مايعرفش إن فيه إعداد أصلاً.
 */
const EMPTY_KNOWLEDGE_PROVIDER = { getEntryByKey: async () => null };

/**
 * «يقترح أكتر من حل»: الاحتمالات اللي بعد الأول، من المرشحين الحقيقيين بس.
 *
 * Anything below the activation threshold is noise the engine already
 * discounted; listing it as a "next most likely cause" would be inventing
 * confidence the ranking never had.
 *
 * @param {Object} ranking
 * @param {number} max
 * @param {number} activationThreshold
 * @returns {Array<{scenarioId: string, label: Object|null, confidence: number}>|null}
 */
function collectAlternatives(ranking, max, activationThreshold) {
    const limit = typeof max === 'number' && max > 0 ? max : 2;
    const rest = (ranking.ranked || [])
        .slice(1)
        .filter((entry) => entry.hypothesis.confidence >= activationThreshold && entry.scenario)
        .slice(0, limit);
    if (rest.length === 0) return null;
    return rest.map((entry) => ({
        scenarioId: entry.hypothesis.scenarioId,
        label: entry.scenario.label || null,
        confidence: entry.hypothesis.confidence
    }));
}

/**
 * جملة الترحيب الشخصية: اسم العميل، ولو رجع بعد فترة، سؤال عن مشكلته
 * اللي فاتت.
 *
 * Both halves are settings-gated and both fail soft — a name lookup that
 * errors simply produces a normal greeting, never a broken turn.
 *
 * @returns {Promise<string>} '' when there is nothing personal to say
 */
async function buildGreetingPersonalisation({ supabase, userId, prevSie, settings, responseLanguage }) {
    const lang = responseLanguage === 'en' ? 'en' : 'ar';
    const parts = [];

    if (settings.memory_remember_name) {
        const name = await recallCustomerName(supabase, userId);
        if (name) parts.push(lang === 'en' ? `Hi ${name},` : `أهلاً يا ${name}،`);
    }

    // Only after the context has actually expired. Asking "did last time's
    // problem get sorted?" mid-conversation would be asking about the
    // problem they are currently describing.
    const lastIssue = prevSie?.contextExpired ? prevSie.lastScenarioLabel : null;
    if (settings.memory_remember_last_issue && lastIssue) {
        const label = lastIssue[lang] || lastIssue.ar || null;
        if (label) {
            parts.push(lang === 'en'
                ? `last time we looked at "${label}" — did that get sorted?`
                : `آخر مرة كنا بنشوف «${label}» — اتظبطت معاك؟`);
        }
    }

    return parts.length ? `${parts.join(' ')}\n\n` : '';
}

/**
 * «يدوّر في المقالات قبل ما يفتح تذكرة».
 *
 * The engine reaches CREATE_TICKET when the leading scenario has no stored
 * solution. But a scenario having no solution and the knowledge base having
 * no answer are different things — the article is keyed on the scenario's
 * `knowledgeSource`, which exists independently of whether the scenario
 * itself declares a resolution.
 *
 * Returns an ANSWER decision when an article covers it, or null to let the
 * ticket proceed. Deliberately does NOT reach for the runner-up's article:
 * answering from a scenario the engine did not actually settle on is how a
 * customer gets a confident reply to a question they never asked.
 *
 * @param {Object} decision
 * @param {Object} ranking
 * @returns {Promise<Object|null>}
 */
async function rescueWithArticle(decision, ranking) {
    const scenario = ranking.topHypothesis?.scenario;
    const key = scenario?.resolution?.knowledgeSource;
    if (!key) return null;

    try {
        const entry = await staticKnowledgeProvider.getEntryByKey(key);
        if (!entry) return null;
        return {
            ...decision,
            action: ACTIONS.ANSWER,
            ticketDraft: null,
            resolution: { ...scenario.resolution, hasAutoResolution: true },
            knowledgeData: { source: key, data: { text: entry.text } },
            explanation: `${decision.explanation} Knowledge base has an entry for "${key}", so answering from it instead of creating a ticket.`
        };
    } catch (err) {
        // A knowledge outage must not block the hand-off it was meant to
        // avoid — fall through and let the ticket be created.
        console.warn('[sie] article lookup before ticket failed:', err?.message || err);
        return null;
    }
}

/**
 * رد إقفال المحادثة لما العميل يقول إن المشكلة اتحلّت.
 *
 * Resets botState.sie entirely rather than marking a flag. The accumulated
 * evidence belongs to a problem that is now over; carrying it forward is
 * exactly what made the engine answer the same scenario again on the next
 * message, whatever that message said.
 */
const CONVERSATION_CLOSED_TEXT = {
    ar: 'تمام، مبسوط إنها اتظبطت معاك 🙌\nلو احتجت أي حاجة تانية أنا موجود في أي وقت.',
    en: "Great — glad that sorted it. I'm here whenever you need anything else."
};

async function closeConversation({ responseLanguage, sessionId, botState, port }) {
    const lang = responseLanguage === 'en' ? 'en' : 'ar';
    const rendered = { text: CONVERSATION_CLOSED_TEXT[lang], options: [] };

    // A clean slate: the next problem this customer raises starts from
    // nothing, which is what "the last one is finished" means.
    const nextBotState = { ...(botState || {}), sie: { turnCount: 0, language: lang } };

    const actionResult = await executeDecision({
        decision: { action: ACTIONS.WAIT_FOR_USER, turn: 0 },
        rendered,
        sessionId,
        nextBotState,
        port
    });
    if (!actionResult?.success) return null;

    return { reply: rendered.text, options: [], alreadyPersisted: true, ticketNumber: null, botState: nextBotState };
}

/**
 * الذاكرة: حفظ / استرجاع / مسح.
 *
 * Runs before diagnosis and returns a finished turn, because these are
 * instructions ABOUT the conversation rather than problems to diagnose.
 * Feeding «احفظ ده في ذاكرتك» into the pipeline is what produced an
 * unrelated WhatsApp answer.
 *
 * Returns null when there is nothing to do, so the caller falls through to
 * the normal pipeline rather than swallowing the turn.
 */
async function handleMemoryIntent({ intent, supabase, userId, sessionId, botState, prevSie, port, responseLanguage }) {
    const lang = responseLanguage === 'en' ? 'en' : 'ar';
    let replyText;

    if (intent.kind === 'forget') {
        await forgetFacts(supabase, userId);
        replyText = MEMORY_REPLIES.forgotten;
    } else if (intent.kind === 'recall') {
        const facts = await recallFacts(supabase, userId);
        replyText = MEMORY_REPLIES.recalled(facts);
    } else if (intent.facts.length === 0) {
        replyText = MEMORY_REPLIES.nothingToSave;
    } else {
        const { saved } = await rememberFacts(supabase, userId, intent.facts);
        // A failed write must not be reported as a success — the customer
        // would rely on a fact the engine does not actually hold.
        replyText = saved > 0 ? MEMORY_REPLIES.saved(intent.facts) : MEMORY_REPLIES.nothingToSave;
    }

    // Diagnostic state is carried through untouched: saving a fact is not
    // progress on a problem, and must not reset one in flight either.
    const nextBotState = {
        ...(botState || {}),
        sie: { ...(prevSie || { turnCount: 0 }), language: lang, lastCustomerText: intent.raw.slice(0, 500) }
    };

    const actionResult = await executeDecision({
        decision: { action: ACTIONS.WAIT_FOR_USER, turn: prevSie?.turnCount || 0 },
        rendered: { text: replyText, options: [] },
        sessionId,
        nextBotState,
        port
    });
    if (!actionResult?.success) return null;

    return { reply: replyText, options: [], alreadyPersisted: true, ticketNumber: null, botState: nextBotState };
}

const EMOTION_SETTING_KEYS = [
    { key: 'emotion_anger', emotion: 'anger' },
    { key: 'emotion_frustration', emotion: 'frustration' },
    { key: 'emotion_urgency', emotion: 'urgency' },
    { key: 'emotion_sarcasm', emotion: 'sarcasm' },
    { key: 'emotion_thanks', emotion: 'thanks' },
    { key: 'emotion_satisfaction', emotion: 'satisfaction' }
];

/**
 * «يفتكر سياق المحادثة» و«مدة الاحتفاظ بالسياق».
 *
 * Returning null makes the very next line treat the turn as the first one
 * of a fresh session — the engine needs no separate "forget" path, because
 * "no previous state" is a case it already handles on every new chat.
 *
 * Expiry matters more than it looks: a customer who comes back tomorrow
 * with an unrelated problem would otherwise be diagnosed against
 * yesterday's evidence, and the accumulated tokens would quietly pull the
 * engine toward the wrong scenario.
 *
 * @param {Object|null} prevSie
 * @param {Object} settings
 * @returns {Object|null}
 */
function recallPreviousState(prevSie, settings) {
    if (!prevSie) return null;
    if (settings.memory_keep_context === false) return null;

    const minutes = typeof settings.memory_context_minutes === 'number' ? settings.memory_context_minutes : null;
    if (minutes && prevSie.lastTurnAt) {
        const ageMinutes = (Date.now() - new Date(prevSie.lastTurnAt).getTime()) / 60000;
        if (Number.isFinite(ageMinutes) && ageMinutes > minutes) {
            // «يفتكر آخر مشكلة» يفضل شغّال حتى بعد ما السياق يتنسى: دي
            // معلومة واحدة بنسأل عنها، مش دليل تشخيصي بنبني عليه.
            return settings.memory_remember_last_issue === false
                ? null
                : { lastScenarioLabel: prevSie.lastScenarioLabel || null, contextExpired: true };
        }
    }
    return prevSie;
}

const TICKET_CONFIRM_TEXT = {
    ar: 'تحب أفتحلك تذكرة دعم عشان فريقنا يتابع معاك؟ [[icon:ticket]]',
    en: 'Would you like me to open a support ticket so our team can follow up with you? [[icon:ticket]]'
};

const TICKET_CONFIRM_OPTIONS = {
    ar: [
        { label: '[[icon:check]] أيوه، افتحلي تذكرة', value: 'أيوه افتحلي تذكرة' },
        { label: '[[icon:cancel]] لأ، مش دلوقتي', value: 'لأ مش دلوقتي' }
    ],
    en: [
        { label: '[[icon:check]] Yes, open a ticket', value: 'yes open a ticket' },
        { label: '[[icon:cancel]] No, not now', value: 'no not now' }
    ]
};

const TICKET_DISABLED_TEXT = {
    ar: 'المشكلة دي محتاجة حد من فريق الدعم يشوفها، بس فتح التذاكر متوقف حاليًا من الإعدادات. '
        + 'تقدر تتواصل مع الفريق مباشرة وهما هيتابعوا معاك [[icon:note]]',
    en: 'This needs a member of the support team, but ticket creation is currently switched off in settings. '
        + 'Please contact the team directly and they will follow up with you [[icon:note]]'
};

/** Published rows from chat_engine_scenarios, used when settings say so. */
function createSupabaseScenarioProvider(supabase) {
    return createScenarioCatalogSupabaseProvider(supabase);
}

const TICKET_DECLINE_TEXT = {
    ar: 'تمام، معلش، مش هفتحلك تذكرة دلوقتي. لو احتجت أي حاجة تانية قولي [[icon:smile]]',
    en: "No problem, I won't open a ticket right now. Let me know if you need anything else [[icon:smile]]"
};

const NEGATIVE_REPLY_PATTERNS = [/مش/, /^لا\b/, /لأ/, /رفض/, /الغاء/, /إلغاء/, /كنسل/, /\bno\b/i, /^n$/i, /cancel/i];
const AFFIRMATIVE_REPLY_PATTERNS = [/أيوه/, /ايوه/, /أيوة/, /ايوة/, /نعم/, /تمام/, /^اه\b/, /آه/, /موافق/, /أوك/, /اوك/, /okay/i, /^ok$/i, /^y$/i, /\byes\b/i, /صح/];

/**
 * تصنيف بسيط (نعم/لا/مش واضح) لرد العميل على سؤال تأكيد فتح التذكرة.
 * بنتأكد من "لأ" الأول عشان عبارات زي "مش عايز تذكرة" ماتتحسبش بالغلط
 * "أيوه" لمجرد ما فيها كلمة تانية قريبة، ثم لو ولا حاجة اتطابقت نرجّع
 * "unclear" ونعيد نفس السؤال بدل ما نفترض حاجة غلط.
 */
function classifyTicketConfirmationReply(text) {
    const normalized = String(text || '').trim().toLowerCase();
    if (!normalized) return 'unclear';
    if (NEGATIVE_REPLY_PATTERNS.some((p) => p.test(normalized))) return 'no';
    if (AFFIRMATIVE_REPLY_PATTERNS.some((p) => p.test(normalized))) return 'yes';
    return 'unclear';
}

/**
 * أول مرة القرار يوصل CREATE_TICKET: بنخزن الـ Decision + الرسالة الأصلية
 * بتاعة التذكرة جوه botState.sie.pendingTicketConfirmation، ونعرض سؤال
 * التأكيد للعميل بدل ما نفتح التذكرة على طول.
 */
/**
 * قرار CREATE_TICKET كان بينفّذ فورًا جوه محرك القرار من غير ما يسأل
 * العميل. دلوقتي أي مرة الـ Decision Engine يوصل لـ CREATE_TICKET، بدل ما
 * نفتح التذكرة على طول، بنوقف ونسأل العميل الأول ("تحب أفتحلك تذكرة؟")
 * ولحد ما يوافق صراحة، التذكرة متتفتحش. الحالة المؤقتة دي (اللي بتفضل
 * لحد رد العميل) بتتخزن جوه botState.sie.pendingTicketConfirmation.
 *
 * بنعيد استخدام executeDecision() الموجود بدل ما نضيف مسار كتابة جديد:
 * أي Decision بـ action مش من TICKET_ACTIONS بيمر على persistBotTurn
 * العادي، فبنبعتله WAIT_FOR_USER (موجود أصلاً في ACTIONS) مع رسالة
 * السؤال، وده بيخزن الرسالة وحالة الجلسة بنفس الطريقة العادية من غير ما
 * يفتح تذكرة فعليًا.
 */
async function beginTicketConfirmation({ decisionWithKnowledge, rendered, sessionId, nextBotState, port, responseLanguage, prefix = '' }) {
    const lang = responseLanguage === 'en' ? 'en' : 'ar';
    const confirmRendered = { text: prefix + TICKET_CONFIRM_TEXT[lang], options: TICKET_CONFIRM_OPTIONS[lang] };

    const stateWithPending = {
        ...nextBotState,
        sie: {
            ...nextBotState.sie,
            pendingTicketConfirmation: {
                decision: decisionWithKnowledge,
                rendered,
                language: lang
            }
        }
    };

    const actionResult = await executeDecision({
        decision: { action: ACTIONS.WAIT_FOR_USER, turn: decisionWithKnowledge.turn },
        rendered: confirmRendered,
        sessionId,
        nextBotState: stateWithPending,
        port
    });

    if (!actionResult?.success) {
        console.error('SIE action-layer write failed (ticket confirmation prompt):', actionResult);
        return null;
    }

    return { actionResult, reply: confirmRendered.text, options: confirmRendered.options, persistedBotState: stateWithPending };
}

/**
 * التعامل مع رد العميل لما يكون فيه سؤال تأكيد فتح تذكرة معلّق من دور
 * سابق. الرد ده بيجاوب على "تحب أفتحلك تذكرة؟" — مش دليل تشخيصي جديد —
 * فبنقصّر الطريق ومنعديش على باقي البايبلاين (Language/Diagnostics/
 * Ranking/Decision/Knowledge/Dialogue) خالص في الدور ده.
 */
async function resolvePendingTicketConfirmation({ text, supabase, sessionId, botState, prevSie, port }) {
    const pending = prevSie.pendingTicketConfirmation;
    const lang = pending.language === 'en' ? 'en' : 'ar';
    const intent = classifyTicketConfirmationReply(text);

    if (intent === 'unclear') {
        // نعيد نفس سؤال التأكيد من غير ما نغيّر أي حالة - لسه مستنيين رد واضح.
        const rendered = { text: TICKET_CONFIRM_TEXT[lang], options: TICKET_CONFIRM_OPTIONS[lang] };
        const nextBotState = { ...botState, sie: { ...prevSie } };
        const actionResult = await executeDecision({
            decision: { action: ACTIONS.WAIT_FOR_USER, turn: pending.decision.turn },
            rendered,
            sessionId,
            nextBotState,
            port
        });
        if (!actionResult?.success) {
            console.error('SIE action-layer write failed (ticket confirmation re-ask):', actionResult);
            return null;
        }
        return { reply: rendered.text, options: rendered.options, alreadyPersisted: true, ticketNumber: null, botState: nextBotState };
    }

    const clearedSie = { ...prevSie };
    delete clearedSie.pendingTicketConfirmation;

    if (intent === 'no') {
        // رفض التذكرة مش رفض المساعدة.
        //
        // The engine had already judged this conversation worth a human's
        // time — that judgement does not stop being true because the
        // customer declined the paperwork. Before, a decline left no trace
        // at all and the case simply evaporated. Now it goes to the Review
        // Center, and the customer is told when to expect contact.
        const { queued } = await queueForHumanReview(supabase, {
            sessionId,
            turn: pending.decision.turn,
            scenarioId: pending.decision.scenarioId ?? null,
            note: pending.decision.explanation ?? ''
        });

        // Only promise the follow-up if a row actually exists to honour it.
        const rendered = {
            text: queued ? REVIEW_QUEUED_TEXT[lang] : REVIEW_QUEUE_FAILED_TEXT[lang],
            options: []
        };
        const nextBotState = { ...botState, sie: clearedSie };
        const actionResult = await executeDecision({
            decision: { action: ACTIONS.WAIT_FOR_USER, turn: pending.decision.turn },
            rendered,
            sessionId,
            nextBotState,
            port
        });
        if (!actionResult?.success) {
            console.error('SIE action-layer write failed (ticket confirmation decline):', actionResult);
            return null;
        }
        return { reply: rendered.text, options: rendered.options, alreadyPersisted: true, ticketNumber: null, botState: nextBotState };
    }

    // intent === 'yes' -> ننفذ القرار الأصلي اللي كان معلّق (بتاع فتح التذكرة فعليًا).
    const nextBotState = { ...botState, sie: clearedSie };
    const actionResult = await executeDecision({
        decision: pending.decision,
        rendered: pending.rendered,
        sessionId,
        nextBotState,
        port
    });
    if (!actionResult?.success) {
        console.error('SIE action-layer write failed (ticket confirmation accept):', actionResult);
        return null;
    }
    return {
        reply: pending.rendered.text,
        options: pending.rendered.options || [],
        alreadyPersisted: true,
        ticketNumber: actionResult.ticketNumber ?? null,
        botState: nextBotState
    };
}

const ESCALATION_REPLY_TEXT = {
    human_request: {
        ar: 'تمام، هوصلك بفريق الدعم البشري دلوقتي وهيتواصلوا معاك في أقرب وقت [[icon:note]]',
        en: "Sure thing, I'll connect you with our human support team right away — they'll be in touch shortly [[icon:note]]"
    },
    frustration: {
        ar: 'أعتذر لو حسّيت إن الرد مش مفيد. هوصلك بفريق الدعم البشري دلوقتي عشان يقدروا يساعدوك بشكل مباشر [[icon:note]]',
        en: "I'm sorry this hasn't been helpful. I'll connect you with our human support team right away so they can help you directly [[icon:note]]"
    }
};

const ESCALATION_EXPLANATION = {
    human_request: 'Customer explicitly asked to speak with a human agent; escalating immediately without further diagnosis.',
    frustration: 'Customer expressed frustration directly at the bot (not a technical complaint); escalating immediately instead of continuing the diagnostic loop.'
};

/**
 * العميل طلب صراحة إنه يتكلم مع حد بشري، أو بان عليه انزعاج واضح من
 * البوت نفسه (sie/language/small-talk.js's human_request/frustration).
 *
 * ------------------------------------------------------------
 * التحويل لبشري ≠ فتح تذكرة
 *
 * This used to open a ticket outright, on the reasoning that there is
 * nothing left to diagnose. True — but "I want to talk to a person" is not
 * "open a ticket in my name". Plenty of customers want a quick word and do
 * not want a case file, and a ticket they did not ask for is one more thing
 * they have to close.
 *
 * So the hand-off ASKS, exactly like every other route to CREATE_TICKET
 * does. The two answers are both honoured:
 *   - نعم  → the pending ESCALATE_TO_HUMAN decision runs and a ticket opens.
 *   - لأ   → chat_engine_conversation_reviews, and the customer is told the
 *            team will reach out within 24 hours (sie-review-queue.js).
 *
 * Either way a human sees the conversation, which is what the customer
 * actually asked for. Only the paperwork is optional.
 *
 * decisionState.ticketAlreadyCreated is set here rather than by decide(),
 * so that a session already mid-diagnosis does not circle back and open a
 * second, duplicate ticket on a later turn.
 */
async function escalateImmediately({ reason, responseLanguage, turn, sessionId, botState, prevSie, port }) {
    const lang = responseLanguage === 'en' ? 'en' : 'ar';
    const rendered = { text: ESCALATION_REPLY_TEXT[reason][lang], options: [] };

    const prevDecisionState = prevSie?.decisionState || createEmptyDecisionState();
    const nextDecisionState = {
        ...prevDecisionState,
        lastAction: ACTIONS.ESCALATE_TO_HUMAN,
        lastScenarioId: null,
        ticketAlreadyCreated: true,
        history: [
            ...prevDecisionState.history,
            { turn, action: ACTIONS.ESCALATE_TO_HUMAN, scenarioId: null, confidence: null, explanation: ESCALATION_EXPLANATION[reason] }
        ]
    };

    const decision = {
        action: ACTIONS.ESCALATE_TO_HUMAN,
        turn,
        explanation: ESCALATION_EXPLANATION[reason],
        ticketDraft: { scenarioId: null, category: 'other', diagnosticTrail: [] }
    };

    const nextBotState = {
        ...(botState || {}),
        sie: {
            diagnosticState: prevSie?.diagnosticState || null,
            decisionState: nextDecisionState,
            language: lang,
            turnCount: turn
        }
    };

    // The escalation sentence is the PREFIX to the confirmation question, so
    // the customer reads one coherent message — "I'll get you to the team…
    // want me to open a ticket?" — rather than a promise now and an
    // unexplained question a beat later.
    const result = await beginTicketConfirmation({
        decisionWithKnowledge: decision,
        rendered,
        sessionId,
        nextBotState,
        port,
        responseLanguage: lang,
        prefix: `${rendered.text}\n\n`
    });

    if (!result) {
        console.error(`SIE action-layer write failed (${reason} escalation):`, result);
        return null;
    }

    return {
        reply: result.reply,
        options: result.options,
        alreadyPersisted: true,
        ticketNumber: null,
        botState: result.persistedBotState
    };
}

/**
 * رد على "مرحبا"/"انت مين؟" وأشباهها (sie/language/small-talk.js) من غير ما
 * نعدّي على Diagnostics/Ranking/Decision خالص — مش دليل تشخيصي، فمش لازم
 * "يستهلك" أي حصة من MAX_CLARIFYING_QUESTIONS ولا يتحسب turn حقيقي في
 * تعداد المحرك. botState.sie بيفضل زي ما هو تمامًا (لو كانت فيه جلسة
 * تشخيص شغّالة فعلاً، بتكمل عادي في الدور اللي بعد كده).
 */
async function respondToSmallTalk({ smallTalk, responseLanguage, sessionId, botState, prevSie, port, prefix = '' }) {
    const lang = responseLanguage === 'en' ? 'en' : 'ar';
    const rendered = { text: prefix + SMALL_TALK_REPLIES[smallTalk.type][lang], options: [] };
    const nextBotState = { ...(botState || {}), sie: prevSie ? { ...prevSie } : { turnCount: 0 } };

    const actionResult = await executeDecision({
        decision: { action: ACTIONS.WAIT_FOR_USER, turn: prevSie?.turnCount || 0 },
        rendered,
        sessionId,
        nextBotState,
        port
    });

    if (!actionResult?.success) {
        console.error('SIE action-layer write failed (small talk):', actionResult);
        return null;
    }

    return { reply: rendered.text, options: rendered.options, alreadyPersisted: true, ticketNumber: null, botState: nextBotState };
}

/**
 * Runs one full SIE turn. Called only by sie-runtime.js.
 *
 * @param {Object} params
 * @param {string} params.text
 * @param {import('@supabase/supabase-js').SupabaseClient} params.supabase
 * @param {string} params.sessionId
 * @param {string} params.userId
 * @param {Object} params.botState - the session's full bot_state blob (may contain
 *   the traditional engine's own keys too — this function only reads/writes botState.sie)
 * @returns {Promise<{reply: string, options: Array, alreadyPersisted: true, ticketNumber: string|null, botState: Object} | null>}
 *   null means "not handled by SIE" — caller should fall back to the traditional engine.
 */
export async function runSieTurn({ text, supabase, sessionId, userId, botState }) {
    if (!text || !supabase || !sessionId || !userId) return null;

    // 1. Entitlement gate — the one place a SIE turn is authorized and metered.
    // 0. Settings. Read before anything is spent or written, so turning the
    //    engine off is immediate and costs the customer nothing — the caller
    //    simply falls back to the traditional engine as if SIE were absent.
    const settings = await getSieSettings(supabase);
    if (!settings.engine_enabled) {
        console.info('SIE turn skipped: المحرك متوقف من الإعدادات');
        return null;
    }

    const entitlement = await tryConsumeSieMessage(supabase, userId);
    if (!entitlement.allowed) {
        console.info('SIE turn skipped:', entitlement.reason);
        return null;
    }

    const port = createRealSupabasePort(supabase);
    const turnStartedAt = Date.now();

    try {
        let prevSie = recallPreviousState(botState?.sie || null, settings);

        // 0. رد على سؤال تأكيد فتح تذكرة معلّق من دور سابق؟ ده مش دليل تشخيصي
        // جديد، فبنتعامل معاه لوحده من غير ما نعدّي على باقي البايبلاين.
        if (prevSie?.pendingTicketConfirmation) {
            return await resolvePendingTicketConfirmation({ text, supabase, sessionId, botState, prevSie, port });
        }

        // «يستفيد من المحادثات القديمة». بيتسأل مرة واحدة بس، أول رسالة في
        // محادثة جديدة — بعد كده السياق الحالي هو الأصح.
        if (settings.memory_use_past_conversations && !prevSie?.diagnosticState) {
            const recalled = await recallPreviousSession(
                supabase, userId, sessionId, settings.memory_context_minutes || 1440
            );
            if (recalled) {
                prevSie = { ...(prevSie || {}), diagnosticState: recalled.diagnosticState, lastScenarioLabel: recalled.lastScenarioLabel };
            }
        }

        const turn = (prevSie?.turnCount || 0) + 1;
        // Prepended to whatever the pipeline decides this turn, when the
        // customer's tone calls for acknowledging before answering.
        let emotionPrefix = '';

        // 2. Language (Module 1)
        const { normalizedTokens, responseLanguage } = await normalize(text, {
            previousLanguage: prevSie?.language || 'ar'
        });

        // 2.5. كلام عادي (تحية / شكر / اعتذار / سؤال هوية أو عن المنصة / طلب
        // موظف بشري / انزعاج من البوت)؟ (sie/language/small-talk.js) مش دليل
        // تشخيصي — بنردّ عليه مباشرة من غير ما نستهلك حصة أسئلة التوضيح ولا
        // نغيّر حالة التشخيص الحالية. لو الجلسة كانت شغّالة في تشخيص فعلي،
        // هتكمل عادي في الدور اللي بعد كده لأن botState.sie ماتغيرش هنا (ما
        // عدا human_request/frustration، اللي بيسجّلوا تصعيد حقيقي – شايف
        // escalateImmediately فوق).
        // Detection always runs. «يرد على التحيات» is about pleasantries, so
        // it must not silently disable "عايز أكلم موظف" — an explicit request
        // for a person is honoured whatever the settings say.
        const smallTalk = detectSmallTalk(text);
        const wantsHuman = smallTalk?.type === 'human_request';

        // 2.6. الذكاء العاطفي (sie/language/emotion-detector.js). مش زي
        // small talk: بيشتغل على أي رسالة مهما كان طولها، وبيرافق المشكلة
        // الحقيقية بدل ما ياخد مكانها.
        const emotion = settings.emotion_detection
            ? detectEmotion(text, { enabled: enabledEmotions(settings) })
            : null;

        // الغضب والسخرية بيروحوا لموظف. الإحباط القديم (اللي كان من
        // small talk) بقى جزء من نفس القراءة دي.
        const emotionEscalates = shouldEscalateForEmotion(emotion) && settings.ticket_on_anger;
        const legacyFrustration = smallTalk?.type === 'frustration' && settings.ticket_on_anger;

        if (wantsHuman || emotionEscalates || legacyFrustration) {
            const reason = wantsHuman ? 'human_request' : 'frustration';
            const result = await escalateImmediately({ reason, responseLanguage, turn, sessionId, botState, prevSie, port });
            if (result) return result;
            return null;
        }

        // «تم الحل» / «شكرًا» بعد ما المحرك رد فعلاً: المحادثة خلصت.
        //
        // بنقفلها ونصفّر حالة التشخيص، فأي مشكلة جديدة بعد كده بتبدأ من
        // نضيف. من غير ده الأدلة القديمة بتفضل متراكمة والمحرك بيرجع يرد
        // بنفس الحل على أي رسالة بعدها — وده بالظبط اللي كان بيحصل.
        // 2.4. «احفظ ده في ذاكرتك» / «انت فاكر إيه عني» — تعليمات عن
        //      المحادثة نفسها، مش مشكلة نشخّصها. لو عدّت على التشخيص،
        //      المحرك بيرد بحل مالوش علاقة — وده اللي كان بيحصل.
        const memoryIntent = detectMemoryIntent(text, prevSie?.lastCustomerText || '');
        if (memoryIntent) {
            const handled = await handleMemoryIntent({
                intent: memoryIntent, supabase, userId, sessionId, botState, prevSie, port, responseLanguage
            });
            if (handled) return handled;
        }

        const resolutionSignal = detectResolutionSignal(text);
        const alreadyAnswered = (prevSie?.decisionState?.answeredScenarioIds || []).length > 0;
        if (resolutionSignal === 'resolved' && alreadyAnswered) {
            const closed = await closeConversation({ responseLanguage, sessionId, botState, port });
            if (closed) return closed;
            return null;
        }

        // مش هيتصعّد، فبنعترف بحالته ونكمل تشخيص في نفس الدور. تجاهُل
        // نبرة واضحة أسوأ من إننا نرد عليها ونكمل.
        if (emotion && settings.emotion_reply && settings.knowledge_empathy_replies) {
            emotionPrefix = `${acknowledgementFor(emotion.emotion, responseLanguage)}\n\n`;
        } else if (smallTalk?.type === 'frustration' && settings.knowledge_empathy_replies) {
            emotionPrefix = `${acknowledgementFor('frustration', responseLanguage)}\n\n`;
        }

        // الرسايل اللي كلها كلام عادي (تحية، شكر، سؤال هوية) بتترد
        // مباشرة من غير تشخيص. لو النبرة كانت شكر أو رضا، ده نفس المعنى:
        // مفيش مشكلة نشخّصها.
        const isPleasantry = smallTalk && smallTalk.type !== 'frustration' && smallTalk.type !== 'human_request';
        if (isPleasantry && settings.reply_to_greetings) {
            // «يفتكر اسم العميل» و«يفتكر آخر مشكلة» — الاتنين بيظهروا في
            // الترحيب بس، مش في كل رد، عشان مايبقاش تكرار مزعج.
            const personal = smallTalk.type === 'greeting'
                ? await buildGreetingPersonalisation({ supabase, userId, prevSie, settings, responseLanguage })
                : '';
            const result = await respondToSmallTalk({ smallTalk, responseLanguage, sessionId, botState, prevSie, port, prefix: personal });
            if (result) return result;
            // لو الكتابة فشلت، منكملش على البايبلاين التشخيصي بنفس normalizedTokens
            // القديمة دي — نرجع null عادي زي أي فشل تاني، والـ caller هيقع للمحرك التقليدي.
            return null;
        }

        // 3. Diagnostics (Module 3)
        // Which catalog answers the customer. Published Supabase rows let an
        // edit made in the settings panel take effect without a deploy; the
        // shipped catalog stays the default because it is the reviewed one.
        const scenarioProvider = settings.use_published_scenarios
            ? createSupabaseScenarioProvider(supabase)
            : undefined;

        const diagnosticState = await processTurn({
            normalizedTokens,
            turn,
            previousState: prevSie?.diagnosticState,
            liveEvidenceContext: { userId },
            ...(scenarioProvider ? { scenarioProvider } : {})
        });

        // How much genuinely new evidence landed this turn, derived from the
        // accumulator's own append-only log rather than re-deriving extraction.
        const newEvidenceAddedThisTurn = (diagnosticState.accumulator?.entries || [])
            .filter((e) => e.turn === turn).length;

        // 4. Ranking (Module 4)
        // «مستوى التشخيص» بيتحوّل هنا لرقم واحد: قد إيه الاحتمال لازم
        // يكون قوي عشان يتحسب مرشح أصلاً. نفس الرقم بيروح لمحرك القرار
        // تحت، عشان الاتنين يتكلموا عن نفس المرشحين.
        const activationThreshold = activationThresholdForLevel(settings.diagnosis_level);
        const ranking = await rankDiagnosticState(
            diagnosticState,
            scenarioProvider || undefined,
            { activationThreshold }
        );

        // 5. Decision (Module 5)
        const { decision, decisionState } = decide({
            ranking,
            turn,
            previousDecisionState: prevSie?.decisionState,
            newEvidenceAddedThisTurn,
            policy: {
                activationThreshold,
                // «يرد بالحل بنفسه» لو اتقفل، المحرك يفضل يشخّص ويجمع
                // المعلومات زي ما هو، بس يسلّم الحل لموظف.
                allowAutoResolution: settings.answer_directly,
                allowScenarioAnswers: settings.knowledge_use_scenarios,
                allowEvidenceRequests: settings.auto_request_more_info,
                ticketOnAmbiguity: settings.ticket_on_low_confidence,
                includeTicketSummary: settings.ticket_include_summary,
                resolutionConfidenceThreshold: settings.answer_confidence,
                maxClarifyingQuestions: settings.max_clarifying_questions,
                maxTurnsBeforeEscalation: settings.ticket_after_turns,
                allowSmartGuess: settings.allow_smart_guess,
                requireCompleteEvidence: settings.inference_mode === 'knowledge_only'
            },
            // المحرك مايقدرش يستنتج دي من الأدلة: «تم الحل» و«لسه مش شغال»
            // الاتنين بيدّوا توكنز وبيسيبوا الثقة زي ما هي.
            customerSignal: resolutionSignal
        });

        // 6. Knowledge (Module 7) — additive, passes through unchanged unless
        //    the decision is an ANSWER with a knowledgeSource.
        const decisionWithKnowledge = await composeAnswerDecision({
            decision,
            // قفل «بيانات حساب العميل» معناه إننا مانبعتش السياق أصلاً،
            // فالمصدر اللحظي مايتسألش — مش بنسأل ونرمي الإجابة.
            liveKnowledgeContext: settings.knowledge_use_live_data === false ? undefined : { userId },
            turn,
            ...(settings.knowledge_use_articles === false ? { staticKnowledgeProvider: EMPTY_KNOWLEDGE_PROVIDER } : {}),
            ...(settings.knowledge_priority === 'live_first' ? { preferLiveKnowledge: true } : {})
        });

        // 6.5. «يدوّر في المقالات قبل ما يفتح تذكرة». المحرك بيوصل لـ
        //      CREATE_TICKET لما مايكونش عنده حل للحالة — لكن ساعات
        //      المقالة بترد على السؤال حتى لو الحالة نفسها مالهاش حل
        //      مخزّن. أرخص من تشغيل موظف، وأسرع للعميل.
        const articleRescue =
            decisionWithKnowledge.action === ACTIONS.CREATE_TICKET &&
            settings.articles_before_ticket &&
            settings.knowledge_use_articles !== false
                ? await rescueWithArticle(decisionWithKnowledge, ranking)
                : null;

        const finalDecision = articleRescue || decisionWithKnowledge;

        // 7. Dialogue (Module 6) — presentation choices are attached here, not
        //    decided in Module 5: whether to name the likely cause and whether
        //    to list runners-up are phrasing questions, and the Decision Engine
        //    stays about what to DO.
        const decisionForRender = {
            ...finalDecision,
            explainRootCause: settings.explain_root_cause !== false,
            alternatives: settings.suggest_multiple_solutions
                ? collectAlternatives(ranking, settings.max_suggested_solutions, activationThreshold)
                : null
        };
        // جملة الاعتراف بالنبرة بتتحط على أي رد بيوصل للعميل الدور ده، مش
        // على رد التشخيص بس — عميل غضبان يستاهل الاعتذار حتى لو الرد
        // النهائي طلع «تحب أفتحلك تذكرة؟».
        const withEmotion = (t) => (emotionPrefix ? emotionPrefix + t : t);

        const renderedDecision = renderDecision(decisionForRender, responseLanguage);
        const rendered = { ...renderedDecision, text: withEmotion(renderedDecision.text) };

        // 8. Action (Module 8) — the sole writer. Persists the bot's message +
        //    session state (+ ticket, if this turn created one) in one transaction.
        const nextBotState = {
            ...(botState || {}),
            sie: {
                diagnosticState,
                decisionState,
                language: responseLanguage,
                turnCount: turn,
                // بيخلّي «مدة الاحتفاظ بالسياق» تعرف السياق ده قديم قد إيه.
                lastTurnAt: new Date().toISOString(),
                // «يفتكر آخر مشكلة» — بيفضل موجود حتى بعد ما السياق ينتهي.
                lastScenarioLabel: decisionWithKnowledge.scenarioLabel || prevSie?.lastScenarioLabel || null,
                // بيخلّي «احفظ ده» في الرسالة الجاية يعرف «ده» دي إيه.
                lastCustomerText: text.slice(0, 500)
            }
        };

        // CREATE_TICKET يتوقف هنا وينتظر تأكيد صريح من العميل بدل ما يفتح
        // التذكرة على طول - شايف beginTicketConfirmation() فوق.
        let actionResult;
        let replyText = rendered.text;
        let replyOptions = rendered.options || [];
        // الحالة اللي اتكتبت فعلاً في قاعدة البيانات. بتختلف عن nextBotState
        // بس في حالة تأكيد التذكرة، لأن وقتها بنكتب نسخة زيادة عليها
        // pendingTicketConfirmation.
        let persistedBotState = nextBotState;

        // «يدوّر في تذاكر العميل القديمة قبل ما يرد»: لو فيه تذكرة مفتوحة
        // في نفس الموضوع، نقول للعميل عليها بدل ما نفتح واحدة مكررة
        // ونقسّم تاريخ المشكلة على تذكرتين.
        const duplicateTicket =
            finalDecision.action === ACTIONS.CREATE_TICKET && settings.search_past_tickets
                ? await findOpenTicket(supabase, userId, finalDecision.ticketDraft?.category || null)
                : null;

        if (duplicateTicket) {
            const lang = responseLanguage === 'en' ? 'en' : 'ar';
            replyText = withEmotion(lang === 'en'
                ? `You already have an open ticket about this (#${duplicateTicket.ticketNumber}) and the team is on it — I'll add nothing new rather than split it across two tickets. Anything you add here reaches them on that ticket.`
                : `فيه تذكرة مفتوحة عندك في نفس الموضوع (رقم ${duplicateTicket.ticketNumber}) والفريق شغّال عليها، فمش هفتح واحدة تانية عشان الموضوع مايتقسمش. أي تفاصيل تزوّدها هنا هتوصلهم على نفس التذكرة.`);
            replyOptions = [];
            actionResult = await executeDecision({
                decision: { action: ACTIONS.WAIT_FOR_USER, turn: finalDecision.turn },
                rendered: { text: replyText, options: [] },
                sessionId, nextBotState, port
            });
            if (!actionResult?.success) return null;
        } else if (finalDecision.action === ACTIONS.CREATE_TICKET && !settings.auto_ticket_enabled) {
            // Tickets are switched off: say so plainly rather than opening one
            // silently or pretending the request went nowhere.
            const lang = responseLanguage === 'en' ? 'en' : 'ar';
            replyText = withEmotion(TICKET_DISABLED_TEXT[lang]);
            replyOptions = [];
            actionResult = await executeDecision({
                decision: { action: ACTIONS.WAIT_FOR_USER, turn: finalDecision.turn },
                rendered: { text: replyText, options: [] },
                sessionId, nextBotState, port
            });
            if (!actionResult?.success) return null;
        } else if (finalDecision.action === ACTIONS.CREATE_TICKET && settings.ask_before_ticket) {
            const confirmOutcome = await beginTicketConfirmation({
                decisionWithKnowledge: finalDecision,
                rendered,
                sessionId,
                nextBotState,
                port,
                responseLanguage,
                prefix: emotionPrefix
            });
            if (!confirmOutcome) return null; // caller falls back to the traditional engine
            actionResult = confirmOutcome.actionResult;
            replyText = confirmOutcome.reply;
            replyOptions = confirmOutcome.options;
            persistedBotState = confirmOutcome.persistedBotState;
        } else {
            actionResult = await executeDecision({
                decision: finalDecision,
                rendered,
                sessionId,
                nextBotState,
                port
            });
            if (!actionResult?.success) {
                console.error('SIE action-layer write failed:', actionResult);
                return null; // caller falls back to the traditional engine
            }
        }

        // 9. Observability (Module 9a) — best-effort, never blocks the reply.
        // بتسجّل القرار الحقيقي اللي اتاخد (حتى لو CREATE_TICKET لسه مستني
        // تأكيد العميل)، عشان الـ trace يفضل يعكس تشخيص المحرك الفعلي.
        try {
            const traceEvent = buildTraceEvent({
                sessionId,
                turn,
                rawText: text,
                normalizedTokens,
                diagnosticState,
                ranking,
                decision: finalDecision,
                responseText: rendered.text,
                timestamp: decisionWithKnowledge.timestamp
            });
            await logTraceEvent({
                sessionId, turn, traceEvent, port,
                responseLanguage,
                processingTimeMs: Date.now() - turnStartedAt,
                actionResult,
                renderedOptions: replyOptions
            });
        } catch (traceErr) {
            console.warn('SIE trace logging failed (non-fatal):', traceErr?.message || traceErr);
        }

        return {
            reply: replyText,
            options: replyOptions,
            alreadyPersisted: true,
            ticketNumber: actionResult.ticketNumber ?? null,
            // الحالة اللي اتكتبت فعلاً — لو الدور ده وقف عند تأكيد التذكرة،
            // دي بتبقى النسخة اللي جواها pendingTicketConfirmation، مش
            // nextBotState الأصلية.
            botState: persistedBotState
        };
    } catch (err) {
        console.error('SIE pipeline error:', err?.message || err);
        return null; // caller falls back to the traditional engine
    }
}
