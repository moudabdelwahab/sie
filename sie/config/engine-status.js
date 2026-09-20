/**
 * engine-status.js
 * ------------------------------------------------------------
 * حالة المحرك بلغة المسؤول، مش بلغة الكود.
 *
 * ------------------------------------------------------------
 * ليه الملف ده موجود
 *
 * لوحة التحكم محتاجة تجاوب على سؤالين عن كل قدرة في المحرك:
 * **شغّالة ولا لأ؟** و**ده معناه إيه بالنسبة للعميل؟**
 *
 * الإجابتين دول منطق، مش شكل. لو اتكتبوا جوه الـHTML هيبقى فيه مصدرين
 * للحقيقة: الإعدادات في `settings-schema.js`، والكلام اللي بيوصف الإعدادات
 * في اللوحة — والاتنين هيفترقوا أول ما حد يغيّر إعداد ومايفتكرش يغيّر
 * الوصف. فالوصف بيتولّد هنا من الإعدادات نفسها.
 *
 * ------------------------------------------------------------
 * قاعدة واحدة: مفيش حالة متخيلة
 *
 * فيه فرق بين «المفتاح مفتوح» و«القدرة بتشتغل فعلاً». المفتاح بيتقرا من
 * الإعدادات؛ إن القدرة بتشتغل محتاج **إشارة** من الواقع (صفوف في الأثر،
 * دلاء حد المعدل، مقارنات ظل).
 *
 * فكل قدرة هنا ليها حالتين منفصلتين:
 *   `switch`  المفتاح — دايمًا معروف
 *   `proof`   دليل إنها اشتغلت فعلاً — ممكن يكون «لسه مافيش قياس»
 *
 * «لسه مافيش قياس» إجابة صحيحة وبتتعرض كده. علامة خضراء من غير دليل أسوأ
 * من علامة رمادية بصراحة.
 */

/** الحالات اللي بتترسم. */
export const SWITCH_STATE = Object.freeze({
    ON: 'on',            // شغّالة ومؤثّرة
    WATCHING: 'watching', // بتراقب وبتسجّل بس
    OFF: 'off'           // مقفولة
});

export const PROOF_STATE = Object.freeze({
    CONFIRMED: 'confirmed',  // فيه دليل إنها اشتغلت
    NONE: 'none',            // لسه مافيش قياس
    NOT_APPLICABLE: 'n/a'    // مقفولة، فمفيش حاجة تتأكد
});

/**
 * القدرات اللي المسؤول بيتحكم فيها، بالترتيب اللي المفروض يقراها بيه.
 *
 * الترتيب مقصود: الأهم والأوضح الأول. «تجربة النسخة الجديدة» آخر حاجة لأنها
 * أداة قياس مش قدرة بتخدم العميل.
 */
const CAPABILITIES = [
    {
        id: 'engine',
        title: 'محرك الدعم',
        what: 'بيقرا رسالة العميل ويفهم المشكلة ويرد عليها بنفسه.',
        keys: ['engine_enabled'],
        sensitive: true,
        offMeans: 'كل العملاء هيرد عليهم البوت العادي، والمحرك مش هيشتغل خالص.',
        onMeans: 'المحرك بيشخّص رسايل العملاء ويرد عليها.'
    },
    {
        id: 'trust',
        title: 'حماية المحادثة',
        what: 'بتفحص كل رسالة قبل ما تأثر على تشخيص المحرك: محاولات تغيير قواعد المحرك، أو انتحال صوت النظام، أو ادعاء صلاحيات، أو إغراق الأدلة.',
        keys: ['trust_boundary_enabled', 'trust_boundary_enforce'],
        sensitive: false,
        offMeans: 'الرسايل بتدخل التشخيص من غير أي فحص.',
        watchMeans: 'بتفحص وبتسجّل بس، ومابتمنعش حاجة — ده الوضع المناسب أول ما تشتغل عشان تشوف نسبة الإنذارات الغلط على ترافيك حقيقي.',
        onMeans: 'بتفحص وبتنفّذ: الرسالة المشبوهة مابتحركش تشخيص ومابتفتحش تذكرة.'
    },
    {
        id: 'retrieval',
        title: 'البحث السريع في السيناريوهات',
        what: 'بدل ما المحرك يقارن كل رسالة بكل السيناريوهات، بيجيب المرشحين المحتملين بس.',
        keys: [],
        sensitive: false,
        alwaysOn: true,
        onMeans: 'شغّال دايمًا. النتيجة نفسها بالظبط، بس أسرع بكتير كل ما الكتالوج يكبر.'
    },
    {
        id: 'sparse_state',
        title: 'تخزين مختصر للمحادثة',
        what: 'بيخزّن اللي العميل قاله فعلاً بدل سجل كامل لكل سيناريو في الكتالوج.',
        keys: ['sparse_diagnostic_state'],
        sensitive: false,
        offMeans: 'كل محادثة بتخزّن سجل لكل سيناريو — حوالي ٢٠٠ كيلوبايت، واحد منهم بس فيه معلومة.',
        onMeans: 'كل محادثة بتخزّن اللي يلزم بس. قيست: ٢٠٣ كيلوبايت بقت ٠.٣.'
    },
    {
        id: 'rate_limit',
        title: 'حد الطلبات',
        what: 'بيمنع أي جهة من إغراق المحرك بطلبات كتير في وقت قصير.',
        keys: ['rate_limit_enabled', 'rate_limit_requests_per_minute', 'rate_limit_burst'],
        sensitive: true,
        offMeans: 'مفيش حد — أي جهة تقدر تبعت أي عدد طلبات.',
        onMeans: 'الطلبات الزيادة بتترفض بدل ما تستهلك المحرك.'
    },
    {
        id: 'shadow',
        title: 'تجربة النسخة الجديدة',
        what: 'بتشغّل النسخة الجديدة جنب الحالية على نفس الرسالة وتسجّل كانت هتعمل إيه — من غير ما يوصل للعميل منها حاجة.',
        keys: ['shadow_run_enabled'],
        sensitive: false,
        offMeans: 'مفيش مقارنة بترتسم من ترافيك حقيقي.',
        onMeans: 'كل رسالة بتتسجّل معاها مقارنة بين النسختين. العميل مش بيشوف منها حاجة.'
    }
];

/**
 * @param {Object} settings          الإعدادات الحالية
 * @param {Object} [signals]         إشارات من الواقع
 * @param {number} [signals.tracesWithTrust]    أدوار اتسجّل فيها فحص ثقة
 * @param {number} [signals.tracesWithShadow]   أدوار اتسجّل فيها مقارنة ظل
 * @param {number} [signals.rateLimitRequests]  طلبات عدّاها حد المعدل
 * @param {number} [signals.sparseSessions]     جلسات متخزّنة بالشكل المختصر
 * @returns {Array} قدرة لكل عنصر، جاهزة للرسم
 */
export function describeCapabilities(settings = {}, signals = {}) {
    return CAPABILITIES.map((cap) => {
        const sw = switchStateFor(cap, settings);
        const proof = proofStateFor(cap, sw, signals);
        return {
            id: cap.id,
            title: cap.title,
            what: cap.what,
            keys: cap.keys,
            sensitive: Boolean(cap.sensitive),
            alwaysOn: Boolean(cap.alwaysOn),
            switchState: sw,
            switchLabel: switchLabel(sw),
            means: meansFor(cap, sw),
            proofState: proof.state,
            proofLabel: proof.label
        };
    });
}

function switchStateFor(cap, settings) {
    if (cap.alwaysOn) return SWITCH_STATE.ON;
    if (cap.id === 'trust') {
        if (settings.trust_boundary_enabled !== true) return SWITCH_STATE.OFF;
        return settings.trust_boundary_enforce === true ? SWITCH_STATE.ON : SWITCH_STATE.WATCHING;
    }
    const primary = cap.keys[0];
    if (!primary) return SWITCH_STATE.ON;
    // `engine_enabled` and `rate_limit_enabled` default ON, so an absent value
    // means on; the newer flags default OFF and need an explicit true.
    const value = settings[primary];
    const defaultsOn = primary === 'engine_enabled' || primary === 'rate_limit_enabled';
    const on = defaultsOn ? value !== false : value === true;
    return on ? SWITCH_STATE.ON : SWITCH_STATE.OFF;
}

function switchLabel(state) {
    if (state === SWITCH_STATE.ON) return 'شغّالة';
    if (state === SWITCH_STATE.WATCHING) return 'بتراقب بس';
    return 'مقفولة';
}

function meansFor(cap, state) {
    if (state === SWITCH_STATE.WATCHING && cap.watchMeans) return cap.watchMeans;
    if (state === SWITCH_STATE.OFF) return cap.offMeans || '';
    return cap.onMeans || '';
}

/**
 * الدليل إن القدرة اشتغلت فعلاً. مقفولة يعني مفيش حاجة تتأكد؛ مفتوحة من غير
 * إشارة يعني «لسه مافيش قياس» — مش علامة خضراء.
 */
function proofStateFor(cap, switchState, signals) {
    if (switchState === SWITCH_STATE.OFF) {
        return { state: PROOF_STATE.NOT_APPLICABLE, label: '' };
    }
    const counts = {
        engine: signals.tracesTotal,
        trust: signals.tracesWithTrust,
        retrieval: signals.tracesTotal,
        sparse_state: signals.sparseSessions,
        rate_limit: signals.rateLimitRequests,
        shadow: signals.tracesWithShadow
    };
    const seen = counts[cap.id];
    if (typeof seen !== 'number') return { state: PROOF_STATE.NONE, label: 'لسه مافيش قياس' };
    if (seen <= 0) return { state: PROOF_STATE.NONE, label: 'مافيش نشاط متسجّل لسه' };
    return { state: PROOF_STATE.CONFIRMED, label: `اشتغلت في ${seen.toLocaleString('ar-EG')} حالة` };
}

/**
 * حالة حد الطلبات، مقروءة من دلاء الحد نفسها.
 *
 * الدلاء دي بيكتبها `sie_rate_limit_hit()` في قاعدة البيانات وقت كل طلب.
 * فوجود صفوف بتتحدّث هو **الدليل الوحيد** إن الحد شغّال فعلاً — الإعداد
 * لوحده بيقول إنه المفروض يشتغل، مش إنه بيشتغل.
 *
 * @param {Object} settings
 * @param {Array} buckets صفوف sie_rate_limit_buckets
 */
export function describeRateLimit(settings = {}, buckets = null) {
    const enabled = settings.rate_limit_enabled !== false;
    const perMinute = settings.rate_limit_requests_per_minute;
    const burst = settings.rate_limit_burst;

    if (!enabled) {
        return {
            enabled: false, tone: 'danger',
            headline: 'مقفول',
            detail: 'مفيش حد على الطلبات دلوقتي — أي جهة تقدر تبعت أي عدد.',
            perMinute, burst, requests: null, rejected: null, lastSeen: null, verified: false
        };
    }

    if (!Array.isArray(buckets)) {
        return {
            enabled: true, tone: 'neutral',
            headline: 'مفتوح',
            detail: 'مقدرناش نقرا سجل الطلبات، فمش قادرين نتأكد إنه بيشتغل فعلاً.',
            perMinute, burst, requests: null, rejected: null, lastSeen: null, verified: false
        };
    }

    const requests = buckets.reduce((sum, b) => sum + Number(b.total_requests || 0), 0);
    const rejected = buckets.reduce((sum, b) => sum + Number(b.total_rejected || 0), 0);
    const lastSeen = buckets
        .map((b) => b.last_request_at)
        .filter(Boolean)
        .sort()
        .pop() || null;

    if (requests === 0) {
        return {
            enabled: true, tone: 'neutral',
            headline: 'مفتوح، ولسه مااتجربش',
            detail: 'الحد مفتوح بس مفيش طلبات عدّت عليه لسه، فمفيش دليل إنه بيشتغل.',
            perMinute, burst, requests, rejected, lastSeen, verified: false
        };
    }

    return {
        enabled: true, tone: rejected > 0 ? 'warning' : 'success',
        headline: 'شغّال ومؤكَّد',
        detail: rejected > 0
            ? `عدّى عليه ${requests.toLocaleString('ar-EG')} طلب، ورفض منهم ${rejected.toLocaleString('ar-EG')}.`
            : `عدّى عليه ${requests.toLocaleString('ar-EG')} طلب، ومارفضش ولا واحد — يعني مفيش حد قرّب من الحد.`,
        perMinute, burst, requests, rejected, lastSeen, verified: true
    };
}

/**
 * الإعدادات اللي تغييرها بيأثر على كل العملاء فورًا، فبتحتاج تأكيد.
 *
 * القايمة هنا مش في اللوحة عشان تفضل مربوطة بالإعدادات نفسها، ويبقى فيه
 * اختبار يقدر يتأكد إن كل مفتاح خطير لسه متحمي.
 */
export const SENSITIVE_KEYS = Object.freeze([
    'engine_enabled',
    'rate_limit_enabled',
    'trust_boundary_enforce',
    'use_published_scenarios',
    'answer_directly'
]);

/** @returns {boolean} */
export function isSensitiveSetting(key) {
    return SENSITIVE_KEYS.includes(key);
}

/**
 * السؤال اللي بيتسأل قبل تغيير إعداد حسّاس. بيوصف **النتيجة**، مش الإعداد —
 * «هيتوقف الرد على كل العملاء» أنفع من «engine_enabled = false».
 */
export function confirmTextFor(key, nextValue, definition) {
    const title = definition?.title || key;
    const turningOff = nextValue === false;

    const consequences = {
        engine_enabled: turningOff
            ? 'المحرك هيقف عن الرد على كل العملاء فورًا، وهيرجعوا للبوت العادي.'
            : 'المحرك هيبدأ يرد على العملاء تاني.',
        rate_limit_enabled: turningOff
            ? 'أي جهة هتقدر تبعت أي عدد طلبات من غير حد — ده بيعرّض المحرك للإغراق.'
            : 'الطلبات الزيادة هتترفض تاني.',
        trust_boundary_enforce: turningOff
            ? 'الحماية هتفضل بتسجّل بس ومش هتمنع أي رسالة.'
            : 'الحماية هتبدأ تمنع فعلاً: رسالة مشبوهة مش هتحرّك تشخيص ولا تفتح تذكرة. راجع نسبة الإنذارات الغلط الأول.',
        use_published_scenarios: turningOff
            ? 'المحرك هيرجع للكتالوج المشحون ويتجاهل أي سيناريو نشرتوه.'
            : 'المحرك هيبدأ يستخدم السيناريوهات المنشورة مع المشحونة.',
        answer_directly: turningOff
            ? 'المحرك هيفضل يشخّص بس مش هيبعت حلول بنفسه — كل حاجة هتروح لموظف.'
            : 'المحرك هيبعت الحلول الجاهزة للعميل بنفسه.'
    };

    return {
        title: turningOff ? `تقفل «${title}»؟` : `تفتح «${title}»؟`,
        body: consequences[key] || 'الإعداد ده بيأثر على كل العملاء فورًا.',
        confirmLabel: turningOff ? 'أيوه، اقفلها' : 'أيوه، افتحها',
        tone: turningOff ? 'danger' : 'primary'
    };
}
