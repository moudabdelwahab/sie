/**
 * Pro · مفاتيح المطورين والـ MCP، العملاء المحتملون، طلبات الاشتراك، والتحقق بخطوتين.
 *
 * Facts (Mad3oom, read 2026-09-24):
 *  - company-dashboard API keys (assets/js/company/api-token-*.js, company-api.js):
 *    the secret is shown ONCE; the list keeps only its last four characters;
 *    three credential types — key + secret (Bearer <api_key>.<secret>), a
 *    single Bearer token, or both (two linked rows); at least one scope is
 *    required; some scopes are "reserved for the platform operator"; expiry
 *    30/90/180/365 days, a date, or none, at most 730 days; the customer can
 *    stop / re-activate a key (no regenerate in the company dashboard); the
 *    modal error "أُنشئ المفتاح لكن تعذّر عرض قيمه".
 *  - developers.html (MCP server, OAuth 2.1): tools/list shows only tools
 *    whose scope the key has; calling one without it is refused (403 /
 *    JSON-RPC -32003); close_ticket is staff-only for now, a customer's
 *    update_ticket can only archive; cancel_subscription cancels a PENDING
 *    request only; OAuth access tokens last one hour and refresh tokens 30
 *    days, rotated on every use.
 *  - leads.html: a preview — rows are sample data, an added lead is kept only
 *    in the page ("سيتم حفظه فعلياً بعد ربط الـ backend"), export not yet
 *    available.
 *  - whatsapp-subscription-service.js / customer-subscriptions.html: one
 *    pending request per plan; renewal extends from the current end date;
 *    upgrade = merge into the bigger plan with the SAME end date, charging
 *    the difference; auto-reply add-on bonus (14 days monthly / 3 months
 *    yearly); launch prices for 6 months or until the target customer count.
 *  - payment.html: Stripe card; the wallet option says "coming soon".
 *  - 2fa-verify.html / 2fa-service.js / telegram-otp.html: "trust this device
 *    for 30 days"; a recovery-code link; "too many attempts, try again
 *    shortly"; Telegram delivery can be unavailable.
 *
 * @no-legitimate-corpus
 */
import { S, T } from '../dsl.mjs';

export default {
    tokens: [
        T('entity_one_time_secret', 'سرّ المفتاح', 'key secret', ['السر', 'السرّ', 'السيكرت', 'secret']),
        T('symptom_values_not_shown', 'القيم ماظهرتش', 'values not shown', ['تعذر عرض', 'ماظهرليش السر', 'مظهرش السر', 'القيم مظهرتش']),
        T('entity_operator_scope', 'صلاحية مخصصة للمشغل', 'operator-only scope', ['مخصصة لمشغل', 'مخصصه لمشغل', 'لمشغل', 'مشغل']),
        T('entity_bearer_token', 'رمز Bearer', 'Bearer token', ['bearer', 'بيرر', 'بيرير']),
        T('entity_ai_client', 'تطبيق ذكاء اصطناعي', 'AI assistant app', ['claude', 'chatgpt', 'cursor', 'كلود', 'شات جي بي تي']),
        T('entity_mcp_tool', 'أداة MCP', 'MCP tool', ['الاداة', 'الاداه', 'الادوات', 'اداه', 'tools', 'tool']),
        T('intent_reauthorize', 'أوافق تاني', 'authorize again', ['اوافق تاني', 'موافقه تاني', 'اربطه تاني', 'اعيد الربط', 'reconnect', 'reauthorize']),
        T('entity_leads', 'العملاء المحتملون', 'leads', ['العملاء المحتملين', 'العملاء المحتملون', 'عملاء محتملين', 'leads', 'lead']),
        T('entity_sample_data', 'بيانات تجريبية', 'sample data', ['اسماء غريبه', 'اسماء غريبة', 'مش بتوعي', 'ماضفتهمش', 'بيانات وهمية', 'بيانات وهميه']),
        T('entity_merge_plan', 'دمج الباقة', 'plan merge', ['دمج', 'اندمج', 'ادمج', 'دمجت']),
        T('entity_bonus_days', 'أيام إضافية مجانية', 'free bonus days', ['الايام المجانيه', 'الايام المجانية', 'ايام اضافيه', 'ايام اضافية', 'الشهور الزياده', 'الشهور الزيادة']),
        T('entity_launch_price', 'سعر الإطلاق', 'launch price', ['الاطلاق', 'عرض الاطلاق', 'سعر الاطلاق']),
        T('entity_coming_soon', 'متاحة قريبًا', 'coming soon', ['قريبا', 'قريباً', 'متاحه قريبا', 'متاحة قريبا', 'coming soon']),
        T('entity_trust_device', 'الثقة في الجهاز', 'trust this device', ['ثق بهذا الجهاز', 'الثقه في الجهاز', 'افتكر الجهاز', 'الجهاز ده', 'trust this device', 'الاجهزه الموثوقه', 'الاجهزة الموثوقة', 'جهاز موثوق', 'الموثوقه']),
        T('atom_code', 'كود/رمز', 'code', ['رمز', 'الرمز', 'كود', 'الكود']),
        T('entity_early_timing', 'بدري', 'early', ['بدري', 'بدرى', 'قبل ما يخلص', 'قبل ما تخلص', 'قبل الانتهاء', 'الايام الفاضله', 'الايام الفاضلة']),
        T('symptom_too_many_attempts', 'محاولات كتير', 'too many attempts', ['عدد المحاولات', 'محاولات كتير', 'تجاوز عدد', 'too many attempts']),
        T('entity_expiry_setting', 'تاريخ انتهاء المفتاح', 'key expiry', ['تاريخ انتهاء', 'تاريخ انتهاءه', 'مده صلاحيه', 'مدة صلاحية', 'بلا انتهاء', 'من غير انتهاء']),
        T('entity_every_time', 'كل مرة', 'every time', ['كل مره', 'كل مرة', 'كل ما ادخل', 'كل ما افتح', 'every time']),
        T('entity_how_will_i_know', 'هعرف منين', 'how will I know', ['هعرف منين', 'اعرف منين', 'هيوصلني خبر', 'هتبلغوني']),
        T('entity_too_big', 'حجمه كبير', 'too big', ['كبير', 'كبيره', 'الحجم كبير', 'تقيل']),
        T('atom_register', 'أسجّل', 'register', ['اسجل', 'تسجيل']),
        T('entity_logo', 'لوجو', 'logo', ['لوجو', 'لوغو', 'شعار']),
        T('entity_cannot_make', 'مش قادر أعمل', 'cannot create', ['مش قادر اعمل', 'مش قادر انشئ']),
        T('entity_review_state', 'قيد المراجعة', 'under review', ['قيد المراجعه', 'قيد المراجعة'])
    ],
    scenarios: [
        S('api_secret_lost_after_creation', 'api/key/secret_lost', 'technical',
            'سرّ مفتاح الـ API ضاع بعد ما اتعرض', 'Lost the API key secret after it was shown',
            'entity_one_time_secret:430 trigger_lost_something:430 atom_where:139',
            `السرّ بيظهر مرة واحدة بس وقت إنشاء المفتاح، والقائمة بتحتفظ بآخر ٤ حروف منه للتعرّف عليه — فمحدش يقدر يرجّعه، ولا فريق الدعم.\n\nالحل من «لوحة الشركة» ← مفاتيح API:\n١. أنشئ مفتاح جديد بنفس الصلاحيات، وانسخ السرّ فورًا.\n٢. حطّه في النظام اللي بيستخدمه.\n٣. أوقف المفتاح القديم (زرار «إيقاف») — الإيقاف بيسري على الخادم على طول.`,
            `The secret is shown only once, when the key is created; the list keeps only its last 4 characters to identify it — so nobody can recover it, support included.\n\nFix, in the company dashboard → API keys:\n1. Create a new key with the same scopes and copy the secret immediately.\n2. Put it in the system that uses it.\n3. Stop the old key ("Stop") — stopping takes effect on the server at once.`,
            { alt: ['entity_one_time_secret:516 entity_key_word:139 trigger_lost_something:344', 'entity_one_time_secret:645 entity_key_word:139 intent_recover:215'] }),
        S('api_key_created_values_not_shown', 'api/key/created_values_not_shown', 'technical',
            'المفتاح اتعمل بس القيم ماظهرتش', 'Key was created but its values were not shown',
            'symptom_values_not_shown:860 entity_key_word:139',
            `رسالة «أُنشئ المفتاح لكن تعذّر عرض قيمه» معناها إن المفتاح اتسجّل فعلًا بس السرّ ماوصلش للشاشة — ومش هيظهر تاني.\n\nماتحاولش تستخدمه: أوقفه من قائمة المفاتيح، وأنشئ واحد بديل وانسخ قيمه أول ما تظهر. لو تكرر مع كل محاولة، قولّي وأفتح تذكرة.`,
            `"The key was created but its values couldn't be displayed" means the key exists but the secret never reached the screen — and it won't be shown again.\n\nDon't try to use it: stop it from the key list and create a replacement, copying its values as soon as they appear. If it happens every time, tell me and I'll open a ticket.`),
        S('api_scope_operator_only', 'api/key/scope_operator_only', 'technical',
            'صلاحية بتقول «مخصّصة لمشغّل المنصة»', 'A scope says it is reserved for the platform operator',
            'entity_operator_scope:4 entity_role:1',
            `فيه صلاحيات بتخص تشغيل المنصة نفسها (زي الصلاحية الكاملة وتغيير إعدادات المنصة) ومابتتمنحش من لوحة الشركة لأي حساب.\n\nاختار الصلاحيات اللي شغلك محتاجها فعلًا (التذاكر، الواتساب، الاشتراكات، الإشعارات…) — ولو في عملية محددة مش لاقي ليها صلاحية، قولّي هي إيه وأنا أوجهك.`,
            `Some scopes belong to running the platform itself (such as full access and changing platform settings) and are not granted from the company dashboard to any account.\n\nPick the scopes your work actually needs (tickets, WhatsApp, subscriptions, notifications…) — and if a specific operation has no scope you can find, tell me what it is and I'll point you.`),
        S('api_credential_type_choice', 'api/key/credential_type_choice', 'inquiry',
            'أختار «مفتاح + سرّ» ولا «رمز Bearer»', 'Key + secret or a single Bearer token?',
            'entity_bearer_token:516 intent_compare:344 entity_key_word:139',
            `الاتنين بيوصلوا لنفس الصلاحيات، الفرق في الشكل:\n• مفتاح + سرّ: بيتبعت كده: Authorization: Bearer <api_key>.<secret> (بنقطة بينهم). الشكل الكلاسيكي.\n• رمز Bearer: رمز واحد بيتبعت زي ما هو — أسهل في الأدوات الجاهزة اللي بتطلب «توكن» واحد.\n• الاتنين معًا: بيعمل اعتمادين مرتبطين، كل واحد في سطر.\n\nلو مش متأكد: الأداة بتطلب خانة واحدة؟ خد Bearer.`,
            `Both reach the same scopes; the difference is the shape:\n• Key + secret: sent as Authorization: Bearer <api_key>.<secret> (dot between them). The classic form.\n• Bearer token: one token sent as is — simpler for ready-made tools that ask for a single "token".\n• Both: creates two linked credentials, one row each.\n\nNot sure? If the tool has a single field, choose Bearer.`,
            { alt: ['entity_bearer_token:516 entity_one_time_secret:344 entity_key_word:139'] }),
        S('api_key_expiry_limit', 'api/key/expiry_limit', 'technical',
            'مش قادر أحط تاريخ انتهاء بعيد للمفتاح', 'Cannot set a far-away key expiry date',
            'entity_key_word:139 entity_expiry_setting:645 symptom_rejected:215',
            `تاريخ انتهاء المفتاح لازم يكون في المستقبل، وأقصى مدة ٧٣٠ يوم (سنتين). الاختيارات الجاهزة: ٣٠ أو ٩٠ أو ١٨٠ يوم أو سنة، أو تاريخ محدد، أو «بلا انتهاء» — والأخير بيفضل صالح لحد ما توقفه بإيدك.\n\nنصيحة أمان: مدة محددة + تدوير قبل ما تخلص أحسن من «بلا انتهاء».`,
            `A key's expiry must be in the future, and at most 730 days (two years). The presets: 30, 90 or 180 days, a year, a specific date, or "no expiry" — the last stays valid until you stop it yourself.\n\nSecurity tip: a fixed period plus rotating before it ends beats "no expiry".`,
            { alt: ['entity_key_word:139 entity_date_notes:645 symptom_rejected:215'] }),
        S('mcp_tool_missing_in_ai_app', 'integration/mcp/tool_missing', 'technical',
            'أداة مش ظاهرة في تطبيق الذكاء الاصطناعي المربوط', 'A tool is missing in the connected AI app',
            'entity_mcp_tool:3 symptom_not_visible:2 entity_mcp:1',
            `التطبيق المربوط بيشوف بس الأدوات اللي صلاحيتها موجودة في المفتاح أو الاتصال بتاعه — والأداة اللي صلاحيتها ناقصة مابتظهرش خالص، ولو اتنادت بيترد عليها برفض (403).\n\nمثال: أدوات التذاكر محتاجة «قراءة التذاكر» أو «إنشاء التذاكر»، والاشتراكات محتاجة صلاحيات الاشتراكات.\n\nالحل: أنشئ مفتاح بالصلاحية الناقصة واربط بيه، أو لو الربط بـ OAuth، افصله واربطه تاني ووافق على الصلاحيات المطلوبة.`,
            `The connected app only sees tools whose scope its key or connection has — a tool whose scope is missing doesn't appear at all, and calling it is refused (403).\n\nExample: ticket tools need "read tickets" or "create tickets"; subscription tools need the subscription scopes.\n\nFix: create a key with the missing scope and connect with it, or if you connected with OAuth, disconnect, reconnect and approve the scopes you need.`,
            { alt: ['entity_mcp_tool:3 entity_ai_client:2 symptom_not_visible:1'] }),
        S('mcp_ai_app_asks_reauthorize', 'integration/mcp/reauthorize_prompt', 'technical',
            'تطبيق الذكاء الاصطناعي بيطلب أوافق تاني', 'The AI app keeps asking me to authorize again',
            'entity_ai_client:3 intent_reauthorize:3',
            `في الربط بـ OAuth: رمز الدخول بيعيش ساعة ويتجدد تلقائيًا، ورمز التجديد بيعيش ٣٠ يوم وبيتبدّل مع كل استخدام. فالطلب يرجع لو:\n• التطبيق مااستخدمش الربط أكتر من ٣٠ يوم.\n• التطبيق فشل يحفظ رمز التجديد الجديد (بيحصل لو اتفتح من أكتر من جهاز بنفس الربط).\n• المفتاح المرتبط بالربط اتوقف.\n\nوافق مرة تانية وهيكمل. لو بيطلبها كل ساعة بالظبط، قولّي اسم التطبيق وأفتح تذكرة.`,
            `With an OAuth connection: the access token lives one hour and refreshes itself; the refresh token lives 30 days and is replaced on every use. So the prompt comes back if:\n• the app hasn't used the connection for over 30 days;\n• the app failed to store the new refresh token (happens when the same connection is used from several devices);\n• the key behind the connection was stopped.\n\nApprove once more and it continues. If it asks every hour exactly, tell me the app's name and I'll open a ticket.`),
        S('mcp_close_ticket_refused', 'integration/mcp_tool/close_ticket_refused', 'technical',
            'أمر قفل التذكرة من التطبيق المربوط بيترفض', 'Closing a ticket from the connected app is refused',
            'entity_mcp_tool:370 atom_close:139 entity_ticket:490',
            `ده متوقع حاليًا: أداة قفل التذكرة متاحة لفريق الدعم بس. من حساب عميل، أداة تعديل التذكرة بتسمح بالأرشفة (الإخفاء من قائمتك) مش بالقفل.\n\nلو المشكلة اتحلت فعلًا، اكتب ده كرد على التذكرة والفريق يقفلها.`,
            `That's expected for now: the close-ticket tool is available to the support team only. From a customer account, the update-ticket tool can archive (hide from your list), not close.\n\nIf the issue is really solved, say so as a reply on the ticket and the team will close it.`,
            { alt: ['entity_ai_client:215 atom_close:139 entity_ticket:430 symptom_rejected:215'] }),
        S('mcp_cancel_active_subscription_refused', 'integration/mcp_tool/cancel_active_refused', 'technical',
            'إلغاء الاشتراك من التطبيق المربوط مش شغال', 'Cancelling a subscription from the connected app does nothing',
            'entity_mcp_tool:268 atom_cancel:139 entity_subscription:323 intent_cancel:268',
            `أداة الإلغاء بتلغي «طلب» اشتراك لسه قيد المراجعة بس — مش اشتراك متفعّل.\n\nإلغاء اشتراك شغّال بيتم من «الباقات والاشتراك» أو بطلب للدعم، والاشتراك بيفضل شغال لحد نهاية المدة المدفوعة.`,
            `The cancel tool cancels a subscription REQUEST that is still under review — not an active subscription.\n\nAn active subscription is cancelled from "Plans & subscription" or by asking support, and it stays active until the end of the paid period.`,
            { alt: ['entity_ai_client:215 intent_cancel:645 symptom_not_happening:139'] }),
        S('leads_added_lead_not_saved', 'leads/lead/not_saved', 'other',
            'العميل المحتمل اللي ضفته اختفى', 'The lead I added disappeared',
            'entity_leads:533 symptom_disappeared:290 intent_add:178',
            `صفحة «العملاء المحتملون» لسه نسخة معاينة: العميل اللي بتضيفه بيتحفظ في الصفحة المفتوحة بس، وبيختفي مع التحديث — لسه مش مربوطة بقاعدة البيانات، والتصدير كمان مش متاح.\n\nلحد ما تتفعّل، سجّل عملاءك المحتملين في ملف عندك. ولو عايز تتابع موعد تفعيلها، قولّي.`,
            `The "Leads" page is still a preview: a lead you add is kept only in the open page and disappears on refresh — it isn't connected to the database yet, and export isn't available either.\n\nUntil it's live, keep your leads in a file of your own. If you'd like to follow when it launches, tell me.`,
            { alt: ['entity_leads:3 entity_export:2 symptom_not_working:1'] }),
        S('leads_sample_entries_unknown', 'leads/sample_data/unknown_entries', 'inquiry',
            'أسماء في العملاء المحتملين أنا ماضفتهاش', 'Names in Leads I never added',
            'entity_leads:2 entity_sample_data:4',
            `الأسماء دي بيانات تجريبية بتوضح شكل الصفحة (المراحل، الاهتمام، قيمة الفرصة) — مش عملاء حقيقيين ومش بيانات حد تاني.\n\nالصفحة لسه معاينة ومش متوصلة بقاعدة البيانات، فمفيش بيانات حقيقية فيها لحد دلوقتي.`,
            `Those names are sample data showing how the page works (stages, interest, deal value) — not real customers and not anyone else's data.\n\nThe page is still a preview and isn't connected to the database, so it holds no real data yet.`),
        S('subscription_request_already_pending', 'subscription/request/already_pending', 'billing',
            'بيقولي عندك طلب اشتراك قيد المراجعة', 'It says I already have a subscription request under review',
            'entity_review_state:508 entity_subscription:323 symptom_rejected:169',
            `مسموح بطلب واحد مفتوح لكل باقة، عشان مايتدفعش مرتين لنفس الحاجة. الطلب اللي قبله لسه مستني المراجعة.\n\nاستنى رد الفريق عليه (الطلبات بالتحويل بتتراجع خلال ساعة في المعتاد)، أو قولّي لو عايز تلغيه أو تعدّل فيه وأنا أوصلك بتذكرته.`,
            `One open request per plan is allowed, so the same thing isn't paid twice. Your previous request is still awaiting review.\n\nWait for the team's reply on it (transfer requests are usually reviewed within an hour), or tell me if you want to cancel or change it and I'll take you to its ticket.`,
            { alt: ['symptom_pending:223 intent_subscribe:424 entity_subscription:212 atom_request:139'] }),
        S('subscription_early_renewal_days_kept', 'subscription/renewal/early_extends_from_end', 'billing',
            'لو جددت بدري الأيام الفاضلة هتضيع؟', 'If I renew early, do I lose the remaining days?',
            'atom_renewal:139 entity_early_timing:860',
            `لأ، مابتضيعش. التجديد بيضيف المدة الجديدة بعد تاريخ انتهاء اشتراكك الحالي، فالأيام الفاضلة محفوظة.\n\nالاستثناء الوحيد: لو مفيش اشتراك شغّال في نفس الباقة وقت التأكيد، المدة بتتحسب من يوم تأكيد الطلب.`,
            `No, they aren't lost. Renewal adds the new period after your current end date, so the remaining days are kept.\n\nThe only exception: if there's no active subscription on that plan when the request is confirmed, the period starts from the confirmation date.`),
        S('subscription_upgrade_end_date_unchanged', 'subscription/upgrade/merge_keeps_end_date', 'billing',
            'رقّيت الباقة وتاريخ الانتهاء ماتغيرش', 'I upgraded and the end date did not change',
            'atom_upgrade:330 entity_date_notes:530 atom_unchanged:139',
            `ده الطبيعي: الترقية بتدمج اشتراكك في الباقة الأكبر بنفس تاريخ الانتهاء الحالي، وبيتحصّل الفرق بس عن المدة الفاضلة.\n\nلو عايز مدة أطول، ده «تجديد» مش ترقية — تقدر تعمله بعدها من «الباقات والاشتراك».`,
            `That's normal: an upgrade merges your subscription into the bigger plan with the SAME end date, and only the difference for the remaining period is charged.\n\nIf you want a longer period, that's a "renewal", not an upgrade — you can do it afterwards from "Plans & subscription".`,
            { alt: ['entity_merge_plan:139 entity_date_notes:860'] }),
        S('subscription_autoreply_bonus_missing', 'subscription/autoreply_bonus/missing', 'billing',
            'الأيام المجانية الإضافية مع الرد الآلي مانزلتش', 'Bonus free days with auto-reply are missing',
            'entity_bonus_days:610 entity_auto_reply:390',
            `عرض الواتساب: لو اشتركت في خدمة الرد الآلي مع الباقة، بتاخد ١٤ يوم إضافي مع الشهري أو ٣ شهور إضافية مع السنوي.\n\nالإضافة بتتحسب لما الفريق يأكد الطلب. لو اتأكد وتاريخ الانتهاء مش فيه الزيادة، قولّي رقم الطلب أو التذكرة وأنا أفتح مراجعة.`,
            `WhatsApp offer: if you subscribe to the auto-reply service with the plan, you get 14 extra days on monthly or 3 extra months on yearly.\n\nThe bonus is applied when the team confirms the request. If it's confirmed and the end date doesn't include it, tell me the request or ticket number and I'll open a review.`),
        S('subscription_launch_price_period', 'subscription/launch_price/duration', 'inquiry',
            'سعر الإطلاق هيفضل لحد إمتى؟', 'How long does the launch price last?',
            'entity_launch_price:4 intent_pricing:1',
            `أسعار الإطلاق سارية ٦ شهور أو لحد ما يوصل عدد العملاء للمستهدف — أيهما أقرب. المكتوب في صفحة الاشتراكات هو السعر الحالي.\n\nاللي بيشترك دلوقتي بيدفع سعر الإطلاق عن المدة اللي دفعها. لو عندك سؤال عن سعر التجديد بعد انتهاء العرض، قولّي وأوصلك بالفريق.`,
            `Launch prices apply for 6 months or until the target number of customers is reached — whichever comes first. What the subscriptions page shows is the current price.\n\nSubscribing now means paying the launch price for the period you pay for. If you have a question about the renewal price after the offer ends, tell me and I'll connect you with the team.`),
        S('payment_card_page_wallet_coming_soon', 'billing/payment_gateway/method_coming_soon', 'billing',
            'اختيار المحفظة في صفحة الدفع مكتوب «متاحة قريبًا»', 'Wallet option on the payment page says "coming soon"',
            'entity_coming_soon:3 entity_gateway_word:1 entity_payment:1',
            `صفحة الدفع الإلكتروني حاليًا بتقبل الكارت البنكي (فيزا/ماستركارد) بس، واختيار المحفظة فيها لسه جاي.\n\nتقدر تدفع بمحفظة كاش أو إنستاباي أو تحويل بنكي من طلب الاشتراك نفسه: اختار «تحويل خارجي» وارفع إثبات التحويل (صورة أو PDF لحد ٨ ميجا)، والطلب بيتراجع يدويًا.`,
            `The online payment page currently accepts bank cards (Visa/Mastercard) only; its wallet option is coming later.\n\nYou can pay by mobile wallet, InstaPay or bank transfer from the subscription request itself: choose "external transfer" and upload the proof (an image or PDF up to 8 MB); the request is reviewed manually.`),
        S('security_2fa_asked_every_login', 'security/2fa/asked_every_time', 'login',
            'كود التحقق بخطوتين بيتطلب مني كل مرة', 'Two-step code is requested every time',
            'entity_2fa:390 entity_trust_device:470 atom_unchanged:139',
            `في صفحة التحقق فيه اختيار «ثق بهذا الجهاز لمدة ٣٠ يومًا» — علّم عليه قبل «تحقق ودخول».\n\nلو معلّم عليه وبرضه بيطلب الكود:\n• مسح بيانات المتصفح أو الكوكيز بيلغي الثقة.\n• التصفح الخفي أو متصفح تاني = جهاز جديد.\n• بعد ٣٠ يوم بيطلبه تاني، وده مقصود.`,
            `The verification page has "Trust this device for 30 days" — tick it before "Verify and sign in".\n\nIf it's ticked and still asks:\n• Clearing browser data or cookies removes the trust.\n• Private browsing or another browser counts as a new device.\n• After 30 days it asks again, by design.`,
            { alt: ['entity_2fa:390 entity_every_time:458 entity_login:153', 'entity_2fa:390 entity_otp:153 atom_device:305 entity_trust_device:153'] }),
        S('security_2fa_use_recovery_code', 'security/2fa/recovery_code_use', 'login',
            'أستخدم رمز الاستعادة فين؟', 'Where do I use a recovery code?',
            'entity_use_code:508 intent_recover:323 entity_2fa:169',
            `رمز الاستعادة بيتكتب مكان كود التطبيق: في صفحة الدخول اكتبه في نفس خانة الرمز (أو من «استخدام رمز الاستعادة؟» في صفحة التحقق).\n\n• كل رمز بيتستخدم مرة واحدة بس.\n• بعد الدخول بيظهرلك عدد الرموز الفاضلة.\n• لو قربت تخلص: من «حماية الحساب» أوقف التحقق بخطوتين وفعّله تاني — ده بيطلّع رموز جديدة (والقديمة بتبطل).\n\nولو مش لاقي أي رمز والموبايل ضاع، قولّي وأفتح تذكرة استرجاع وصول.`,
            `A recovery code goes where the app code goes: on the sign-in page type it in the same code field (or use "Use a recovery code?" on the verification page).\n\n• Each code works once only.\n• After signing in you're shown how many codes are left.\n• If you're running low: in "Account protection" turn two-step verification off and on again — that issues new codes (the old ones stop working).\n\nIf you can't find any code and the phone is lost, tell me and I'll open an access-recovery ticket.`,
            ),
        S('security_2fa_too_many_attempts', 'security/2fa/too_many_attempts', 'login',
            'مكتوب «تم تجاوز عدد المحاولات»', 'It says too many attempts',
            'symptom_too_many_attempts:610 entity_2fa:390',
            `ده حماية مؤقتة بعد كذا كود غلط ورا بعض: استنى ١٥ دقيقة، وبعدين جرّب بكود جديد من التطبيق (مش القديم).\n\nلو الأكواد بتترفض رغم إنها صح، الغالب إن ساعة الموبايل مش مظبوطة: خلّي التاريخ والوقت «تلقائي» قبل المحاولة الجاية. ولو الموبايل مش معاك، تقدر تدخل بواحد من رموز الاستعادة في نفس الخانة.`,
            `It's a temporary protection after several wrong codes in a row: wait 15 minutes, then try a fresh code from the app (not the old one).\n\nIf correct codes keep getting rejected, your phone's clock is most likely off: set date & time to "automatic" before the next attempt. If you don't have your phone, you can sign in with one of your recovery codes in the same field.`,
            { alt: ['symptom_too_many_attempts:777 entity_otp:223'] }),
        S('login_telegram_code_unavailable', 'login/telegram_otp/unavailable', 'login',
            'مكتوب إرسال الرمز عبر تليجرام غير متاح', 'It says sending the code via Telegram is unavailable',
            'entity_telegram:390 entity_otp:223 symptom_not_working:387',
            `رمز الدخول عبر تيليجرام ميزة لسه مش مكتملة، ومش مطلوبة عند الدخول — فالرسالة دي مش مشكلة في حسابك.\n\nارجع لصفحة الدخول وسجّل دخول من جديد عادي. ولحماية حسابك اعتمد على التحقق بخطوتين من «حماية الحساب». لو الرسالة دي منعتك تدخل خالص، قولّي وأفتح تذكرة.`,
            `The Telegram sign-in code is an unfinished feature and isn't required at sign-in — so this message isn't a problem with your account.\n\nGo back to the sign-in page and sign in again normally. To protect your account, rely on two-step verification under "Account protection". If the message actually stops you from signing in, tell me and I'll open a ticket.`,
            { alt: ['entity_telegram:390 atom_code:139 symptom_name_taken:247 entity_otp:223', 'entity_telegram:390 atom_code:139 symptom_not_working:247 entity_otp:223'] })
    ]
};
