/**
 * Max · مسار المفردات — SYNONYMS for existing base tokens. NOT scenarios.
 *
 * The general-support probe (bench/corpora/general-probe.mjs) showed the
 * largest gap in Max was not missing CASES but missing WORDS: «اخش»,
 * «الاكونت», «اكنسل», «الواتس», «التيكت», «تقيل», «مش بيجيلي», Arabizi and
 * English — for scenarios the core already has. A synonym (dsl.Y) gives such
 * a word the meaning of an EXISTING base token, only where the base left the
 * word unresolved; it can never change a word Free understands (normalizer:
 * applyGlossaryLayers applies layers to open tokens only).
 *
 * Sources: the development probe's misses and systematic colloquial /
 * Arabizi / English / spelling variants of the target token's own patterns.
 * NOT the held-out sets: vocabulary-heldout.json was committed (f32afcc)
 * before this file existed and is measured, never tuned against.
 *
 * Every pattern must pass the audit: produce its target through the real
 * normalizer (dead_pattern), collide with no base or lower-layer pattern
 * (pattern_collision), and target a base token a scenario uses
 * (synonym_unknown_target / unused_token).
 *
 * @no-legitimate-corpus
 */
import { Y } from '../dsl.mjs';

export default {
    tokens: [
        // ── account & sign-in ─────────────────────────────────────────────
        // «اخش» → entity_login: REJECTED (see symptom_not_received below — same
        // cause): «مش عارف اخش على حسابي» joins the core's stand-off for «مش عارف
        // ادخل على حسابي» and turns a clarifying question into a ticket.
        Y('entity_login', ['لوجين', 'اللوجين', 'log in', 'sign in']),
        Y('entity_account', ['الاكونت', 'اكونت', 'الاكاونت', 'اكاونت']),
        Y('entity_password', ['الباس', 'باسوردي', 'el password']),
        Y('symptom_login_failed', ['مش قادر اخش', 'مش قادره ادخل', 'مش قادرة ادخل', 'cannot log in', 'cant login']),
        // symptom_not_received: REJECTED. {entity_otp + symptom_not_received} is
        // ambiguous with analytics_csat_not_collected in the CORE (Free: «كود
        // التحقق مش بيوصل»), so every synonym for it moved OTP messages Free
        // points at login_otp_not_received into that stand-off. Not fixable from
        // a pack; reported in the engineering report §16. The same holds for the
        // other REJECTED entries in this file: each synonym carries its target's
        // core behaviour to new words, core stand-offs included, and Max may not
        // be more ambiguous or more effectful than Pro on any known message.

        // ── subscription & money ──────────────────────────────────────────
        Y('intent_cancel', ['اكنسل', 'كنسل', 'اكانسل', 'a-cancel']),
        Y('entity_subscription', ['السبسكريبشن', 'سبسكريبشن', 'el subscription', 'el eshterak', 'eshterak']),
        // entity_refund: REJECTED — the core's «عايز استرداد» is an ambiguous
        // ticket (billing_refund_policy stand-off); «عايز ارجع فلوسي» inherited it.
        Y('intent_upgrade', ['اطلع باقة اعلى', 'اطلع باقه اعلي']),
        Y('entity_invoice', ['fatora', 'el fatora', 'الفتورة', 'الفتوره']),

        // ── channels & tickets ────────────────────────────────────────────
        Y('entity_whatsapp', ['الواتس', 'واتس', 'الوتس', 'el whatsapp', 'wts']),
        // entity_ticket («التيكت»): REJECTED — the core's «التذكرة محدش رد عليها»
        // is an ambiguous ticket (ticket_disappeared stand-off); «التيكت محدش رد»
        // inherited it. The gain («ازاي اعمل تيكت») does not buy that.
        Y('qualifier_mobile', ['الابليكيشن', 'ابليكيشن', 'الابلكيشن', 'الأبليكيشن', 'الابلكيشن بتاعكم']),

        // ── symptoms ──────────────────────────────────────────────────────
        Y('symptom_slow', ['تقيله', 'تقيلة', 'تقيل اوي', 'laggy', 'lagging']),
        Y('symptom_not_working', ['msh sha8al', 'mesh shaghal', 'mesh sha8al', 'doesnt work', 'wont work']),
        Y('symptom_blank_page', ['wont load', 'doesnt load', 'مش بتحمل', 'مش بيحمل']),
        Y('symptom_crash', ['keeps crashing', 'crashing', 'بيقفل اول ما افتحه', 'بيقفل اول ما بفتحه']),
        Y('symptom_not_saving', ['مش بيتسيف', 'مبيتسيفش', 'مش بتتسيف', 'مفيش حاجة بتتسيف', 'مفيش حاجه بتتسيف']),
        Y('entity_spreadsheet', ['الاكسل', 'اكسل']),
        Y('entity_qr_code', ['كيو ار', 'كيو ار كود', 'الكيو ار كود', 'qr كود']),

        // ── the conversation itself (core convo_* scenarios) ──────────────
        Y('trigger_nothing_else', ['خلاص مش عايز', 'سيبك منها', 'سيبك من الموضوع', 'انسى الموضوع', 'مش مهم خلاص', 'never mind', 'nevermind']),
        Y('social_asks_to_wait', ['متعملش حاجة', 'ماتعملش حاجة', 'hold on', 'wait a sec']),
        Y('social_wrong_message', ['كتبت غلط', 'قصدي حاجة تانية', 'هشرح تاني', 'wrong message']),
        Y('trigger_it_works_now', ['اتحلت لوحدها', 'اشتغلت لوحدها', 'اتظبطت', 'works now', 'its working now']),
        Y('social_bot_answered_wrong', ['الاجابة دي غلط', 'الرد ده غلط', 'ده مش سؤالي', 'انت فهمت غلط', 'الرد ده مش ليه علاقة', 'wrong answer']),
        Y('behaviour_wants_human', ['اكلم حد من الدعم', 'اكلم حد', 'real person', 'talk to someone']),
        Y('trigger_confused', ['مش فاهم حاجة خالص', 'تايه خالص']),
        Y('trigger_back_later', ['هجرب وارجعلك', 'هشوف وارجعلك', 'ارجعلك'])
    ],
    scenarios: []
};
