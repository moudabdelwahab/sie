/**
 * edition-guards.js
 * ------------------------------------------------------------
 * حماية إعدادات الإصدارات من الأخطاء الخطيرة — pure rules the console runs
 * BEFORE it saves one edition value.
 *
 * The validator (settings-schema validateSetting) already refuses anything
 * outside the hard limits. These rules cover the values that are legal and
 * still a mistake in context: a Pro edition configured smaller than Free,
 * a message cap that cuts ordinary messages, a monthly cap that runs out in
 * a day. Each rule either BLOCKS (the value makes no sense) or asks for a
 * CONFIRMATION that names the consequence in plain Arabic, because a
 * warning printed next to a number is read after the save, not before.
 *
 * Pure and dependency-free apart from the editions profile, so the same
 * rules are unit-tested here and run unchanged in the browser.
 */
import { EDITION_IDS, resolveEditionProfile, editionSettingKey } from './editions.js';

export const EDITION_NAMES = Object.freeze({ free: 'المجاني', pro: 'برو', max: 'ماكس' });

/** Which edition/knob a settings key belongs to, or null. */
export function parseEditionKey(key) {
    for (const id of EDITION_IDS) {
        for (const knob of ['maxScenarios', 'maxMessageChars', 'retrievalMaxCandidates', 'maxEvidenceTokensPerTurn',
            'rateLimitPerMinute', 'rateLimitBurst', 'monthlyMessages']) {
            if (editionSettingKey(id, knob) === key) return { edition: id, knob };
        }
    }
    return null;
}

/**
 * @param {string} key
 * @param {*} value      the value about to be saved (already validated)
 * @param {Object} settings  the current merged settings
 * @returns {{ error?: string, confirm?: {title: string, body: string, confirmLabel: string, tone: string} }}
 */
export function editionSettingGuard(key, value, settings = {}) {
    if (key === 'default_edition') {
        const from = EDITION_NAMES[settings.default_edition] || EDITION_NAMES.free;
        const to = EDITION_NAMES[value];
        if (!to || value === settings.default_edition) return {};
        return {
            confirm: {
                title: `تخلي الإصدار الافتراضي «${to}»؟`,
                body: `كل عميل مالوش إصدار متحدد بالاسم هيتنقل من «${from}» لـ«${to}» من أول رسالة جاية. `
                    + (value === 'free'
                        ? 'الحالات الإضافية اللي في الإصدارات الأعلى هتقف عندهم.'
                        : 'هيبدأ يرد على حالات أكتر — اتأكد إن ده المقصود لكل العملاء دول.'),
                confirmLabel: 'أيوه، غيّره',
                tone: value === 'free' ? 'danger' : 'primary'
            }
        };
    }

    const parsed = parseEditionKey(key);
    if (!parsed) return {};
    const { edition, knob } = parsed;
    const name = EDITION_NAMES[edition];
    const current = resolveEditionProfile(edition, settings);
    const n = Number(value);

    if (knob === 'maxScenarios') {
        // Monotone editions: the resolver would silently lift a higher
        // edition to the one below it, so the console refuses the value
        // instead of accepting a number that will not be obeyed.
        const idx = EDITION_IDS.indexOf(edition);
        if (idx > 0) {
            const below = EDITION_IDS[idx - 1];
            const floor = resolveEditionProfile(below, settings).maxScenarios;
            if (n < floor) {
                return { error: `«${name}» مايقدرش يبقى أقل من «${EDITION_NAMES[below]}» (${floor} حالة). قلّل «${EDITION_NAMES[below]}» الأول لو ده المقصود.` };
            }
        }
        // No "above the next edition" rule: each ceiling (650/1000/1500) is at
        // most the next edition's floor, and the resolver lifts the next one
        // to this one, so a lower edition can never exceed a higher one.
        if (n < current.maxScenarios) {
            return {
                confirm: {
                    title: `تقلّل حالات «${name}» لـ${n}؟`,
                    body: `عملاء «${name}» هيبطّلوا يتعرفوا على ${current.maxScenarios - n} حالة من أول رسالة جاية، `
                        + 'والرسايل دي هتروح لسؤال توضيح أو لتذكرة بدل الحل.',
                    confirmLabel: 'أيوه، قلّلها', tone: 'danger'
                }
            };
        }
        return {};
    }

    if (knob === 'maxMessageChars' && n < 1000) {
        return {
            confirm: {
                title: `تخلي أقصى طول للرسالة ${n} حرف؟`,
                body: 'العملاء ساعات بيلصقوا رسالة خطأ طويلة أو يشرحوا المشكلة في فقرة. أي حاجة بعد الحد ده مش هتتقرا خالص.',
                confirmLabel: 'أيوه، طبّقه', tone: 'danger'
            }
        };
    }

    if (knob === 'retrievalMaxCandidates' && n < 30) {
        return {
            confirm: {
                title: `تقلّل الحالات المرشحة لـ${n}؟`,
                body: 'رقم صغير ممكن يخلّي المحرك مايشوفش الحالة الصح في الرسايل اللي فيها كلام كتير عام. الافتراضي أأمن.',
                confirmLabel: 'أيوه، طبّقه', tone: 'danger'
            }
        };
    }

    if (knob === 'rateLimitPerMinute' && n > 0 && n < 30) {
        return {
            confirm: {
                title: `تخلي حد «${name}» ${n} طلب في الدقيقة؟`,
                body: 'فتح شاشة واحدة بيعمل أكتر من طلب. رقم صغير كده ممكن يرفض استخدام عادي.',
                confirmLabel: 'أيوه، طبّقه', tone: 'danger'
            }
        };
    }

    if (knob === 'monthlyMessages' && n > 0) {
        const tight = n < 100;
        const lowering = current.monthlyMessages === 0 || n < current.monthlyMessages;
        if (tight || lowering) {
            return {
                confirm: {
                    title: `تحط حد ${n} رسالة في الشهر لعملاء «${name}»؟`,
                    body: 'أي عميل يوصل للحد ده هيترفض لحد أول الشهر الجاي، حتى لو رصيده نفسه لسه فيه. '
                        + (tight ? 'الرقم ده صغير — عميل نشط ممكن يخلّصه في يوم.' : ''),
                    confirmLabel: 'أيوه، طبّقه', tone: 'danger'
                }
            };
        }
    }

    return {};
}

/**
 * Standing warnings on the current configuration, shown at the top of the
 * editions panel. Values the resolver adjusts are named here, so the panel
 * never shows a number that is not the one being obeyed.
 *
 * (How many scenarios each edition really holds is on its card, not here —
 * a ceiling above the count is normal, not a warning.)
 *
 * @param {Object} settings
 * @returns {string[]}
 */
export function editionWarnings(settings = {}) {
    const out = [];
    for (const id of EDITION_IDS) {
        const stored = Number(settings[editionSettingKey(id, 'maxScenarios')]);
        const profile = resolveEditionProfile(id, settings);
        if (Number.isFinite(stored) && stored !== profile.maxScenarios) {
            out.push(`«${EDITION_NAMES[id]}» متسجّل ${stored} حالة، والمطبّق ${profile.maxScenarios} عشان مايبقاش أقل من الإصدار اللي تحته.`);
        }
        if (profile.rateLimitPerMinute === null && Number(settings[editionSettingKey(id, 'rateLimitBurst')]) !== 20
            && settings[editionSettingKey(id, 'rateLimitBurst')] !== undefined) {
            out.push(`«الدفعة المفاجئة» في «${EDITION_NAMES[id]}» مش مستخدمة لأن حد الطلبات للإصدار صفر (بيمشي على الحد العام).`);
        }
    }
    return out;
}
