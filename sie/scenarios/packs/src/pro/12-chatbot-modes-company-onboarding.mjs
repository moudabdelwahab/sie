/**
 * Pro · أوضاع الشات بوت، بيانات الشركة بعد الاشتراك، حالات الاشتراك، ونافذة التنبيه.
 *
 * Facts (Mad3oom, read 2026-09-24):
 *  - assets/js/chatbot-mode-service.js / chatbot-mode-selector.js: four modes —
 *    تقليدي (ready replies and quick menus, no AI call), نموذج ذكاء اصطناعي
 *    (you pick a provider and model), تلقائي (the platform picks the best
 *    available model per message), and SIE. The advanced three are for
 *    subscribers only ("للمشتركين فقط"). When SIE stops being available
 *    (quota used, access expired, disabled) the widget switches the customer
 *    to the traditional mode automatically and keeps that choice. If a
 *    provider has no discovered models the admin-configured default is used.
 *  - assets/js/company/company-onboarding.js: a plan that requires a company
 *    asks for company name, commercial-register number and its expiry date
 *    ("saved with the company data for future verification"), company e-mail
 *    and phone; "لم يتم الربط" when the subscription could not be linked.
 *  - assets/js/company/subscription-model.js: statuses نشط / ينتهي قريبًا /
 *    لم يبدأ بعد / منتهٍ / قيد المراجعة / مرفوض; a scheduled subscription's
 *    services don't count until its start date; EXPIRY_WARNING_DAYS = 14.
 *  - assets/js/subscription-expiry-modal.js: "اشتراكك سينتهي قريباً" with
 *    تجديد الآن / تذكرني لاحقاً — "later" hides it for 24 hours, stored in
 *    this browser only.
 *  - assets/js/access-policy.js: "هذه الصفحة مخصّصة لحسابات العملاء" /
 *    "لفريق المنصة" — a page that belongs to another account type.
 *
 * @no-legitimate-corpus
 */
import { S, T } from '../dsl.mjs';

export default {
    tokens: [
        T('atom_mode', 'وضع', 'mode', ['وضع', 'اوضاع', 'الوضع', 'الاوضاع', 'mode', 'modes']),
        T('entity_traditional_mode', 'الوضع التقليدي', 'traditional mode', ['التقليدي', 'الوضع التقليدي', 'تقليدي']),
        T('entity_subscribers_only', 'للمشتركين فقط', 'subscribers only', ['للمشتركين فقط', 'للمشتركين بس', 'للمشتركين']),
        T('entity_ai_model', 'موديل الذكاء الاصطناعي', 'AI model', ['الموديل', 'موديل', 'الموديلات', 'موديلات', 'المزود', 'مزود', 'المزودات']),
        T('entity_commercial_register', 'السجل التجاري', 'commercial register', ['سجل تجاري', 'رقم السجل', 'سجلي التجاري']),
        T('entity_not_started', 'لم يبدأ بعد', 'not started yet', ['لم يبدأ بعد', 'لسه مابداش', 'لسه ما بدأش', 'مابدأش', 'مبدأش']),
        T('entity_expiry_popup', 'نافذة تنبيه الانتهاء', 'expiry pop-up', ['سينتهي قريبا', 'هينتهي قريب', 'تذكرني لاحقا', 'تذكرني بعدين', 'الرساله دي بتطلع', 'الرسالة دي بتطلع']),
        T('entity_given_rating', 'التقييم اللي اديته', 'the rating I gave', ['اديته', 'اديتها', 'اللي اديته', 'اللي اديتها', 'حطيته']),
        T('entity_what_is', 'ده إيه', 'what is it', ['ده ايه', 'دي ايه', 'ده عباره عن ايه']),
        T('entity_upload_refused', 'مش راضي يترفع', 'upload refused', ['مش راضي يترفع', 'مش بيترفع', 'مش راضي يرفع', 'مش عايز يترفع', 'الرفع بيفشل']),
        T('symptom_not_happening', 'مش بيحصل', 'not happening', ['مش بيحصل', 'ماحصلش', 'مش بتحصل', 'مابيحصلش']),
        T('entity_arabic_word', 'بالعربي', 'in Arabic', ['بالعربي', 'عربي', 'العربي']),
        T('entity_service_word', 'خدمة', 'service', ['خدمة', 'خدمه', 'الخدمة', 'الخدمه']),
        T('atom_link', 'أربط', 'link', ['اربط', 'اربطه', 'ربط', 'الربط']),
        T('entity_closed_state', 'مقفولة', 'closed (state)', ['مقفوله', 'مقفولة', 'المقفوله', 'المقفولة', 'مغلقه', 'مغلقة']),
        T('entity_colleague', 'زميلي', 'my colleague', ['زميلي', 'زميلتي', 'زميل', 'زملائي', 'زمايلي']),
        T('entity_request_cancelled', 'الطلب اتلغى لوحده', 'request cancelled by itself', ['اتلغي لوحده', 'اتلغت لوحدها', 'الطلب اتلغي', 'طلبي اتلغي', 'اتلغي من نفسه']),
        T('entity_company_data', 'بيانات الشركة', 'company data', ['بيانات الشركه', 'بيانات الشركة', 'بيانات شركتي', 'بيانات شركتنا', 'ملف الشركه']),
        T('entity_rating_place', 'مكان التقييم', 'where to rate', ['مكان التقييم', 'زرار التقييم', 'التقييم فين', 'فين التقييم', 'خانة التقييم']),
        T('entity_use_code', 'أستخدم رمز', 'use a code', ['استخدم رمز', 'استخدام رمز', 'ادخل رمز', 'اكتب رمز', 'استخدم كود']),
        T('entity_page_not_for_me', 'الصفحة مش لحسابي', 'page not for my account', ['مخصصه لحسابات العملاء', 'مخصصة لحسابات العملاء', 'مخصصه لفريق', 'مخصصة لفريق', 'الصفحه دي مش ليا', 'الصفحة دي مش ليا'])
    ],
    scenarios: [
        S('chatbot_modes_compare', 'chat/bot_mode/options_compare', 'inquiry',
            'الفرق بين أوضاع الشات بوت', 'The difference between chatbot modes',
            'atom_mode:330 entity_chatbot:335 intent_compare:335',
            `من «وضع الشات بوت» تختار البوت يرد عليك إزاي:\n• تقليدي: ردود جاهزة وقوائم اختيار سريعة، من غير ذكاء اصطناعي.\n• نموذج ذكاء اصطناعي: تختار المزوّد والموديل بنفسك.\n• تلقائي: المنصة بتختار أنسب موديل متاح مع كل رسالة.\n• محرك الدعم الذكي (SIE): بيفهم المحادثة ويشخّص المشكلة ويقرر يرد ولا يفتح تذكرة.\n\nالتلات الأخيرين للمشتركين بس. لو مش متأكد، «تلقائي» أسهل اختيار.`,
            `From "Chatbot mode" you choose how the bot answers you:\n• Traditional: ready replies and quick menus, no AI.\n• AI model: you pick the provider and model yourself.\n• Automatic: the platform picks the best available model for each message.\n• Smart support engine (SIE): understands the conversation, diagnoses the issue and decides whether to answer or open a ticket.\n\nThe last three are for subscribers only. If unsure, "Automatic" is the easiest choice.`,
            { alt: ['atom_mode:330 entity_chatbot:335 intent_how_to:167 entity_ai_model:167'] }),
        S('chatbot_advanced_modes_locked', 'chat/bot_mode/subscribers_only', 'inquiry',
            'أوضاع الشات بوت مقفولة عندي', 'Chatbot modes are locked for me',
            'entity_subscribers_only:516 entity_chatbot:344 atom_mode:139',
            `الأوضاع المتقدمة (نموذج ذكاء اصطناعي، تلقائي، SIE) متاحة للمشتركين بس — على الباقة المجانية بيفضل الوضع التقليدي.\n\nتقدر تشترك من صفحة الاشتراكات، والأوضاع بتفتح بعد تفعيل الاشتراك. لو مشترك فعلًا وشايفها مقفولة، سجّل خروج ودخول تاني، ولو فضلت قولّي.`,
            `The advanced modes (AI model, Automatic, SIE) are for subscribers only — on the free plan the traditional mode stays.\n\nYou can subscribe from the subscriptions page; the modes unlock once the subscription is active. If you're already subscribed and still see them locked, sign out and in again, and tell me if it persists.`,
            { alt: ['atom_mode:139 entity_chatbot:430 symptom_account_locked:430'] }),
        S('chatbot_switched_to_traditional', 'chat/bot_mode/auto_fallback_traditional', 'technical',
            'البوت رجع للوضع التقليدي لوحده', 'The bot switched back to traditional mode by itself',
            'entity_traditional_mode:645 atom_by_itself:139 entity_chatbot:215',
            `ده بيحصل لما محرك الدعم الذكي (SIE) مابقاش متاح لحسابك: خلصت حصة رسائله، أو انتهت صلاحيته، أو اتلغى تفعيله. المنصة بتحوّلك للوضع التقليدي تلقائيًا عشان البوت مايقفش عن الرد، وبتحفظ الاختيار ده.\n\nتقدر تختار وضع تاني من «وضع الشات بوت»، ولتجديد SIE تواصل مع الدعم.`,
            `This happens when the smart support engine (SIE) is no longer available to your account: its message quota ran out, its access expired, or it was deactivated. The platform switches you to traditional mode automatically so the bot keeps replying, and saves that choice.\n\nYou can pick another mode from "Chatbot mode"; to renew SIE, contact support.`,
            { alt: ['entity_traditional_mode:720 atom_change:139 atom_by_itself:139'] }),
        S('chatbot_model_list_empty', 'chat/bot_mode/no_models', 'technical',
            'مفيش موديلات أختار منها', 'No models to choose from',
            'entity_ai_model:3 symptom_not_visible:2 entity_chatbot:1',
            `في وضع «نموذج ذكاء اصطناعي»:\n• لو المزوّد مفعّل بس مفيش موديلات ظاهرة له، مش مشكلة — بيتستخدم الموديل الافتراضي اللي الإدارة ضابطاه تلقائيًا.\n• لو مكتوب «لا يوجد مزوّدات متاحة حاليًا»، اختار «تلقائي» أو «تقليدي» لحد ما يتضافوا.\n\nولو ظهرت رسالة «تعذّر تحميل الموديلات»، حدّث الصفحة وجرّب تاني.`,
            `In "AI model" mode:\n• If the provider is enabled but no models are listed, that's fine — the default model configured by the admins is used automatically.\n• If it says "no providers available right now", choose "Automatic" or "Traditional" until some are added.\n\nIf "couldn't load models" appears, refresh the page and try again.`,
            { alt: ['entity_ai_model:533 symptom_disappeared:290 entity_chatbot:178'] }),
        S('company_onboarding_details_required', 'account/company_onboarding/details_required', 'other',
            'بعد الاشتراك بيطلب بيانات الشركة والسجل التجاري', 'After subscribing it asks for company details and the commercial register',
            'entity_commercial_register:860 atom_company:139',
            `الباقات اللي بتتطلب شركة بتطلب بيانات الشركة بعد الاشتراك: اسم الشركة، رقم السجل التجاري وتاريخ انتهائه، وإيميل وتليفون الشركة. السجل بيتحفظ ضمن بيانات الشركة للتحقق بعدين.\n\nاملاها واضغط «حفظ ومتابعة». لو ظهرلك «لم يتم الربط»، الاشتراك ماارتبطش بالشركة — قولّي اسم الشركة وأنا أفتح تذكرة للفريق يربطه.`,
            `Plans that require a company ask for company details after subscribing: company name, commercial-register number and its expiry date, and the company e-mail and phone. The register is saved with the company data for later verification.\n\nFill it in and press "Save and continue". If "not linked" appears, the subscription wasn't attached to the company — tell me the company name and I'll open a ticket for the team to link it.`,
            { alt: ['entity_commercial_register:677 entity_subscription:323', 'entity_vat_invoice:505 intent_subscribe:327 entity_commercial_register:168'] }),
        S('subscription_status_not_started', 'subscription/record/not_started', 'billing',
            'اشتراكي مكتوب عليه «لم يبدأ بعد»', 'My subscription says "not started yet"',
            'entity_not_started:677 entity_subscription:323',
            `ده اشتراك تاريخ بدايته لسه جاي — مش منتهي ومش محتاج تجديد. خدماته بتبدأ تتحسب من تاريخ البداية المكتوب عليه.\n\nده بيحصل غالبًا لما تجدد قبل ما الاشتراك الحالي يخلص: الجديد بيستنى دوره. لو التاريخ نفسه غلط، قولّي وأفتح تذكرة.`,
            `That's a subscription whose start date is still ahead — not expired and not in need of renewal. Its services start counting from the start date shown.\n\nIt usually happens when you renew before the current subscription ends: the new one waits its turn. If the date itself is wrong, tell me and I'll open a ticket.`),
        S('subscription_expiry_popup_repeats', 'subscription/expiry_popup/repeats', 'billing',
            'رسالة «اشتراكك سينتهي قريبًا» بتطلعلي كل شوية', '"Your subscription ends soon" pops up again and again',
            'entity_expiry_popup:4 entity_subscription:1',
            `النافذة دي بتظهر لما يفضل على اشتراكك ١٤ يوم أو أقل.\n• «تذكرني لاحقًا» بيخفيها ٢٤ ساعة — على نفس المتصفح بس، فمتصفح أو جهاز تاني هيعرضها تاني.\n• بتختفي خالص بعد ما التجديد يتأكد.\n\nلو جددت فعلًا وبرضه بتظهر، يبقى الطلب لسه قيد المراجعة — وبتختفي أول ما يتأكد.`,
            `This window appears when 14 days or fewer are left on your subscription.\n• "Remind me later" hides it for 24 hours — in this browser only, so another browser or device will show it again.\n• It goes away for good once the renewal is confirmed.\n\nIf you've already renewed and it still shows, the request is still under review — it disappears once confirmed.`,
            { alt: ['entity_expiry_popup:686 entity_every_time:314'] }),
        S('access_page_for_other_account_type', 'account/access/page_wrong_account_type', 'other',
            'مكتوب «هذه الصفحة مخصّصة لحسابات العملاء»', 'It says "this page is for customer accounts"',
            'entity_page_not_for_me:4',
            `دخولك سليم — بس الرابط اللي فتحته بيخص نوع حساب تاني: صفحات بوابة العميل لحسابات العملاء، وصفحات لوحة الإدارة لفريق المنصة.\n\nارجع للوحة بتاعتك (للشركات: «لوحة الشركة») وكمّل منها. لو الصفحة دي مفروض تكون متاحة ليك، قولّي اسمها وأنا أتأكد.`,
            `Your sign-in is fine — but the link you opened belongs to another account type: customer-portal pages are for customer accounts, and admin pages are for the platform team.\n\nGo back to your own dashboard (for companies: the "company dashboard") and continue from there. If that page should be available to you, tell me its name and I'll check.`)
    ]
};
