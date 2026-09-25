/**
 * Pro · أوضاع الشات بوت، بيانات الشركة بعد الاشتراك، حالات الاشتراك، ونافذة التنبيه.
 *
 * Facts (Mad3oom, read 2026-09-25 — the chat composer / SIE plans change):
 *  - SIE is the only reply engine. The traditional mode (ready replies and
 *    quick menus) was removed, and the AI-model / automatic modes were taken
 *    out of the UI (there was no engine behind them). chatbot-engine.js and
 *    chatbot-mode-service.js are gone; profiles.chatbot_mode only accepts
 *    'sie' for new values (migration 054).
 *  - Every account has SIE Free (migration 0011 here: backfill + provisioning
 *    on sign-up). Plans are المجاني / برو / ماكس; each has a monthly message
 *    limit that resets at the start of the month.
 *  - The «SIE» button next to the message box shows the plan, used /
 *    remaining / total, the percentage and when it resets
 *    (sie_my_entitlement). The customer can move down (Max→Pro, Max→Free,
 *    Pro→Free) from the same menu (sie_customer_downgrade); moving up is done
 *    by the platform team.
 *  - When SIE can't answer (limit reached, access expired or disabled) no
 *    other bot answers: the chat shows the reason and the message stays for
 *    the support team.
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
            `الشات دلوقتي بيرد بوضع واحد: محرك الدعم الذكي (SIE) — بيفهم المحادثة ويشخّص المشكلة ويقرر يرد ولا يفتح تذكرة. الأوضاع القديمة (التقليدي، نموذج ذكاء اصطناعي، تلقائي) اتشالت.\n\nالفرق بقى في الخطة: المجاني، برو، ماكس — كل خطة ليها حد رسائل شهري، والأعلى بتغطي مواضيع أكتر. زرار «SIE» جنب مربع الكتابة بيوريك خطتك واستخدامك وإمتى بيتجدد، ومنه تقدر تنزل لخطة أقل. الترقية بتتم من فريق المنصة.`,
            `The chat now answers in one mode: the smart support engine (SIE) — it understands the conversation, diagnoses the issue and decides whether to answer or open a ticket. The old modes (traditional, AI model, automatic) were removed.\n\nThe difference is now the plan: Free, Pro, Max — each has a monthly message limit, and the higher ones cover more topics. The "SIE" button next to the message box shows your plan, your usage and when it resets, and lets you move to a lower plan. Upgrades are done by the platform team.`,
            { alt: ['atom_mode:330 entity_chatbot:335 intent_how_to:167 entity_ai_model:167'] }),
        S('chatbot_advanced_modes_locked', 'chat/bot_mode/subscribers_only', 'inquiry',
            'أوضاع الشات بوت مقفولة عندي', 'Chatbot modes are locked for me',
            'entity_subscribers_only:516 entity_chatbot:344 atom_mode:139',
            `مفيش أوضاع مقفولة دلوقتي: كل الحسابات عليها محرك الدعم الذكي (SIE) بالخطة المجانية على الأقل، والأوضاع القديمة اتشالت. لو لسه شايف «للمشتركين فقط»، حدّث الصفحة — دي نسخة قديمة في المتصفح.\n\nلو زرار «SIE» جنب مربع الكتابة عليه علامة حمرا، يبقى وصلت حد رسائلك أو الوصول موقوف — السبب مكتوب في القائمة، ورسائلك بتوصل لفريق الدعم. الترقية لبرو أو ماكس بتتم من فريق المنصة.`,
            `Nothing is locked any more: every account has the smart support engine (SIE) on at least the Free plan, and the old modes were removed. If you still see "subscribers only", refresh the page — that's an old copy in the browser.\n\nIf the "SIE" button next to the message box shows a red mark, you've reached your message limit or access is paused — the reason is written in the menu, and your messages still reach the support team. Upgrading to Pro or Max is done by the platform team.`,
            { alt: ['atom_mode:139 entity_chatbot:430 symptom_account_locked:430'] }),
        S('chatbot_switched_to_traditional', 'chat/bot_mode/auto_fallback_traditional', 'technical',
            'البوت رجع للوضع التقليدي لوحده', 'The bot switched back to traditional mode by itself',
            'entity_traditional_mode:645 atom_by_itself:139 entity_chatbot:215',
            `الوضع التقليدي اتشال، والشات مابقاش بيحوّلك لبوت تاني. لو محرك الدعم الذكي (SIE) مش متاح لحسابك — وصلت حد الرسائل الشهري، أو انتهت الصلاحية، أو اتوقف — هتلاقي في المحادثة رسالة بالسبب، ورسالتك بتوصل لفريق الدعم يرد عليك.\n\nالحد الشهري بيتجدد أول الشهر، وموعد التجدد ظاهر في زرار «SIE» جنب مربع الكتابة. لو السبب مش واضح، قولّي وأفتح تذكرة.`,
            `The traditional mode was removed, and the chat no longer hands you to another bot. If the smart support engine (SIE) isn't available to your account — the monthly message limit is reached, access expired, or it was paused — the chat shows a message with the reason, and your message reaches the support team, who reply to you.\n\nThe monthly limit resets at the start of the month, and the reset time is shown on the "SIE" button next to the message box. If the reason isn't clear, tell me and I'll open a ticket.`,
            { alt: ['entity_traditional_mode:720 atom_change:139 atom_by_itself:139'] }),
        S('chatbot_model_list_empty', 'chat/bot_mode/no_models', 'technical',
            'مفيش موديلات أختار منها', 'No models to choose from',
            'entity_ai_model:3 symptom_not_visible:2 entity_chatbot:1',
            `اختيار المزوّد والموديل اتشال من إعدادات الشات: الشات بيرد بمحرك الدعم الذكي (SIE) مباشرة، ومش محتاج تختار موديل.\n\nلو لسه شايف قائمة موديلات أو «وضع الشات بوت» القديم، حدّث الصفحة — دي نسخة قديمة في المتصفح. ولو فضلت ظاهرة، قولّي.`,
            `Choosing a provider and model was removed from the chat settings: the chat answers with the smart support engine (SIE) directly, and there's no model to pick.\n\nIf you still see a model list or the old "Chatbot mode" picker, refresh the page — that's an old copy in the browser. If it stays, tell me.`,
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
