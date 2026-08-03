/**
 * templates/ar.js
 * ------------------------------------------------------------
 * Arabic phrasing for every possible Decision action. Pure templates:
 * each function takes a Decision and returns { text, options }. No
 * branching on confidence, no re-deriving anything — every piece of
 * information used here already exists on the Decision object.
 *
 * `options` follows the same shape chat-logic.js already renders via
 * renderQuickOptions(): [{ label, value }].
 */

import { formatKnowledgeData } from './knowledge-formatters.js';

function scenarioName(decision) {
    return decision.scenarioLabel?.ar || 'المشكلة دي';
}

/**
 * «يقترح أكتر من حل»: بيعرض الاحتمالات القريبة اللي المحرك شافها كمان،
 * مرتّبة من الأرجح للأقل.
 *
 * The alternatives arrive on the Decision as `alternatives` — the caller
 * decides how many and whether to include any at all, so this template
 * stays what it claims to be: phrasing, not policy. Nothing renders when
 * the field is absent, which is the default.
 */
function renderAlternatives(decision) {
    const alternatives = decision.alternatives;
    if (!Array.isArray(alternatives) || alternatives.length === 0) return '';
    const lines = alternatives.map((alt, i) => `${i + 1}. ${alt.label?.ar || alt.scenarioId}`);
    return `\n\nولو ده مش هو، أقرب احتمالات تانية عندي:\n${lines.join('\n')}`;
}

export const ar = {
    WAIT_FOR_USER: () => ({
        text: 'تمام، قولي طلبك أو المشكلة اللي حابب تتكلم عنها وهساعدك فورًا [[icon:smile]]',
        options: []
    }),

    ANSWER: (decision) => {
        const isInformational = Boolean(decision.resolution?.knowledgeSource);
        const formatted = decision.knowledgeData
            ? formatKnowledgeData(decision.knowledgeData.source, decision.knowledgeData.data, 'ar')
            : null;
        const bodyText = formatted || decision.resolution.text.ar;

        if (isInformational) {
            return { text: `${bodyText}\n\nأي حاجة تانية حابب تعرفها؟`, options: [] };
        }

        // «يقول السبب المرجّح»: بيطمّن العميل إن المحرك فاهمه قبل ما يديه
        // الحل. بيتحط قبل الحل مش بعده — العميل بيقرا أول سطرين بس.
        const rootCause = decision.explainRootCause && decision.scenarioLabel?.ar
            ? `اللي فهمته إن المشكلة في «${scenarioName(decision)}».\n\n`
            : '';

        // «التخمين الذكي»: لازم يبان إنه ترجيح، مش تشخيص. عميل يتصرف على
        // أساس تخمين غلط أسوأ من عميل استنى موظف.
        const hedge = decision.hedged
            ? 'مش متأكد ١٠٠٪، بس أرجح حاجة إن ده سبب المشكلة:\n\n'
            : '';

        return {
            text: `${rootCause}${hedge}${bodyText}${renderAlternatives(decision)}\n\nده حل المشكلة؟`,
            options: [
                { label: '[[icon:check]] تم، شكرًا', value: 'تم الحل' },
                { label: '[[icon:note]] لسه عندي نفس المشكلة', value: 'المشكلة لسه موجودة' }
            ]
        };
    },

    ASK_CLARIFYING_QUESTION: (decision) => {
        if (decision.targetQuestion) {
            const options = (decision.targetQuestion.options || []).map((opt) => ({
                label: opt.label.ar,
                value: opt.value
            }));
            return { text: decision.targetQuestion.prompt.ar, options };
        }
        // بيتكرر لحد MAX_CLARIFYING_QUESTIONS مرة في نفس الجلسة (decision-policy.js)
        // لو العميل مش راجع بدليل تشخيصي جديد — فالنص بيتنوّع حسب رقم المحاولة
        // (decision.attemptNumber، صفر-index) بدل ما يتكرر نفسه حرفيًا كل مرة،
        // ومع اقتراب آخر محاولة بنقول للعميل صراحة إننا هنوصله بفريق الدعم لو
        // احتجنا. لو attemptNumber مش موجودة (null/undefined) بترجع أول نص —
        // نفس السلوك القديم بالظبط.
        const GENERIC_CLARIFY_VARIANTS = [
            'ممكن توضحلي أكتر عن المشكلة اللي حضرتك واجهتها؟ [[icon:search]]',
            'معلش، حابب أفهم أكتر — تقدر تقولي بالظبط إيه المشكلة اللي واجهتها، بالتفصيل؟ [[icon:search]]',
            'لسه مش قادر أفهم المشكلة من التفاصيل اللي وصلتني — جرّب توضحها بشكل مختلف، ولو صعبت هوصلك بفريق الدعم البشري على طول [[icon:search]]'
        ];
        const attempt = decision.attemptNumber ?? 0;
        return { text: GENERIC_CLARIFY_VARIANTS[Math.min(attempt, GENERIC_CLARIFY_VARIANTS.length - 1)], options: [] };
    },

    ASK_FOR_SCREENSHOT: () => ({
        text: 'حابب ترفق صورة سكرين شوت للمشكلة؟ ده هيساعدنا نفهمها بشكل أسرع [[icon:attach]]',
        options: [
            { label: '[[icon:attach]] إرفاق صورة', value: '__attach_image__' },
            { label: '[[icon:skip]] تخطي', value: 'تخطي' }
        ]
    }),

    ASK_FOR_ATTACHMENT: () => ({
        text: 'ممكن ترفق أي ملف أو إيصال يوضح المشكلة؟ (اختياري) [[icon:attach]]',
        options: [
            { label: '[[icon:attach]] إرفاق ملف', value: '__attach_image__' },
            { label: '[[icon:skip]] تخطي', value: 'تخطي' }
        ]
    }),

    ASK_FOR_LOGS: () => ({
        text: 'لو معاك أي سجلات أخطاء (logs) أو رسالة الخطأ بالكامل، ابعتهالنا وهنقدر نساعدك أسرع [[icon:attach]]',
        options: [
            { label: '[[icon:attach]] إرفاق ملف', value: '__attach_image__' },
            { label: '[[icon:skip]] تخطي', value: 'تخطي' }
        ]
    }),

    REQUEST_ACCOUNT_DETAILS: () => ({
        text: 'عشان أقدر أتأكد من بيانات حسابك، ممكن تبعتلي البريد الإلكتروني أو رقم الموبايل المسجل بيه؟ [[icon:note]]',
        options: []
    }),

    VERIFY_INFORMATION: (decision) => ({
        text: `طيب، بس أتأكد: المشكلة اللي حضرتك بتواجهها هي "${scenarioName(decision)}"، صح كده؟`,
        options: [
            { label: '[[icon:check]] أيوه صح', value: 'أيوه صح' },
            { label: '[[icon:cancel]] لأ مش كده', value: 'لأ مش كده' }
        ]
    }),

    CREATE_TICKET: (decision) => decision?.alreadyTicketed
        ? { text: 'التذكرة اللي فتحناها لسه شغالة وفريق الدعم هيتواصل معاك [[icon:ticket]] تقدر تضيفلي أي تفاصيل تانية لو حابب', options: [] }
        : { text: 'تمام، فتحنالك تذكرة دعم وفريقنا هيتواصل معاك في أقرب وقت [[icon:ticket]]', options: [] },

    ESCALATE_TO_HUMAN: (decision) => decision?.alreadyTicketed
        ? { text: 'لسه بننتظر رد فريق الدعم البشري، هيتواصلوا معاك في أقرب وقت [[icon:note]] لو حابب تضيف أي تفاصيل تانية أنا موجود', options: [] }
        : { text: 'هوصلك بفريق الدعم البشري عشان يقدر يساعدك بشكل مباشر [[icon:note]]', options: [] },

    COMPLETE: () => ({
        text: 'تمام، سعيد إن المشكلة اتحلت! لو احتجت أي حاجة تانية أنا موجود [[icon:star]]',
        options: []
    }),

    FALLBACK: () => ({
        text: 'مش متأكد إني فهمتك صح [[icon:note]] اختار من الاختيارات دي وهساعدك:',
        options: [
            { label: '[[icon:inquiry]] عندي استفسار', value: 'عندي استفسار' },
            { label: '[[icon:problem]] عندي مشكلة', value: 'عندي مشكلة' }
        ]
    })
};
