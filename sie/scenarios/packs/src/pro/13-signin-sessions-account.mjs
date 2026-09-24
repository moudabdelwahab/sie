/**
 * Pro · أنواع الدخول، الجلسات والأجهزة الموثوقة، الأمان، وبيانات الحساب.
 *
 * Facts (Mad3oom, read 2026-09-24):
 *  - login.html: account type «حساب شخصي» / «حساب تابع لشركة»; a company
 *    member enters the company's e-mail or commercial-register number plus
 *    their own identifier (resolve_company_member_login) — error «بيانات
 *    الشركة أو العضو غير صحيحة، أو العضو غير تابع لهذه الشركة». Personal
 *    sign-in takes e-mail, phone or username («لا يوجد حساب مرتبط بهذا
 *    الرقم», «اسم المستخدم غير موجود»). Username /^[A-Za-z0-9_]{3,20}$/,
 *    availability and reserved names checked. «المتابعة بـ Pi Network» via
 *    the Pi SDK. On a company subdomain: «هذا النطاق … ليس مرتبطاً بحسابك» /
 *    «سجّل الدخول بالحساب المالك» / «النطاق الفرعي غير موجود أو تم حذفه».
 *  - assets/js/account/account-settings.js + account-core.js: sessions — no
 *    detailed list yet, «تسجيل الخروج من كل الأجهزة الأخرى», a password
 *    change ends other sessions; trusted devices listed with «إزالة» /
 *    «إزالة كل الأجهزة» (removing one signs nobody out, it asks for the code
 *    next time); 2FA off with a current code or a recovery code; recovery
 *    codes shown once and stored encrypted — new ones by turning 2FA off and
 *    on; QR fallback «أدخل المفتاح أدناه يدويًا»; e-mail change by a link to
 *    the NEW address, the current one stays until it is clicked; phone
 *    required, «غير موثّق برمز» — no phone verification exists yet; the bio
 *    «تظهر لفريق الدعم عند التعامل مع طلباتك».
 *  - assets/js/sie-client.js: «بعتّ رسايل كتير في وقت قصير … استنى N ثانية».
 *  - roadmap.html: notifications in-platform, e-mail and Telegram today;
 *    WhatsApp notifications «قادم»; voice support next stage; AI voice calls a
 *    future vision «غير مخطط لها ضمن الجدول الحالي».
 *  - forum.js: sign-in required to post; sections, topics, comments, likes.
 *
 * @no-legitimate-corpus
 */
import { S, T } from '../dsl.mjs';

export default {
    tokens: [
        T('entity_company_mode', 'حساب تابع لشركة', 'company member account', ['حساب تابع لشركه', 'حساب تابع لشركة', 'تابع لشركه', 'تابع لشركة', 'حساب تابع']),
        T('entity_username', 'اسم المستخدم', 'username', ['اسم المستخدم', 'اليوزر', 'يوزر', 'اليوزرنيم', 'username']),
        T('entity_signup', 'إنشاء حساب', 'signing up', ['بعمل حساب', 'اعمل حساب', 'انشاء حساب', 'انشئ حساب', 'حساب جديد', 'بسجل', 'وانا بسجل']),
        T('entity_not_accepted', 'مش مقبول', 'not accepted', ['مش مقبول', 'مش راضي يقبل']),
        T('entity_pi_network', 'Pi Network', 'Pi Network', ['pi network', 'باي نتورك', 'باي نت ورك', 'متصفح pi']),
        T('entity_not_linked_account', 'مش مرتبط بحسابك', 'not linked to your account', ['مش مرتبط بحسابك', 'ليس مرتبطا بحسابك', 'مش مرتبط']),
        T('entity_all_devices', 'كل الأجهزة', 'all devices', ['كل الاجهزه', 'كل الاجهزة', 'باقي الاجهزه', 'باقي الاجهزة', 'الاجهزه التانيه', 'الاجهزة التانية']),
        T('entity_logout', 'تسجيل خروج', 'sign out', ['تسجيل خروج', 'اسجل خروج', 'اعمل خروج', 'خروج', 'logout']),
        T('entity_turn_off', 'أوقف', 'turn off', ['اوقف', 'اوقفه', 'اعطل', 'اعطله', 'الغي تفعيل', 'الغي التفعيل']),
        T('entity_codes_word', 'رموز', 'codes', ['رموز', 'الرموز', 'اكواد', 'الاكواد']),
        T('entity_still_old', 'لسه القديم', 'still the old one', ['لسه القديم', 'ولسه القديم', 'لسه هو القديم']),
        T('entity_unverified', 'غير موثّق', 'not verified', ['غير موثق', 'مش موثق', 'غير متوثق', 'مش متوثق']),
        T('entity_bio', 'النبذة', 'bio', ['النبذه', 'نبذه', 'نبذة عني', 'نبذه عني', 'bio']),
        T('entity_too_many_messages', 'رسايل كتير', 'too many messages', ['رسايل كتير', 'رسائل كتير', 'رسايل كتيره', 'في وقت قصير']),
        T('entity_notify_me', 'توصلني إشعارات', 'notify me', ['توصلني اشعارات', 'ابقي اعرف علي', 'تبعتولي اشعارات']),
        T('entity_post_topic', 'أنشر موضوع', 'post a topic', ['انشر موضوع', 'انشر', 'اكتب موضوع', 'موضوع جديد', 'بوست']),
        T('entity_voice_support', 'دعم صوتي', 'voice support', ['دعم صوتي', 'مكالمات', 'مكالمه صوتيه', 'كول سنتر', 'اتصال تليفوني'])
    ],
    scenarios: [
        S('login_company_member_mode', 'login/account_type/company_member', 'login',
            'أدخل إزاي بحساب تابع لشركة', 'How to sign in as a company member',
            'entity_company_mode:843 entity_login:156',
            `في صفحة الدخول اختار «حساب تابع لشركة» فوق، وبعدين:\n١. في الخانة الأولى: بريد الشركة أو رقم سجلها التجاري.\n٢. بياناتك إنت (إيميلك أو رقمك أو اسم المستخدم) وكلمة المرور.\n\nلو ظهر «بيانات الشركة أو العضو غير صحيحة، أو العضو غير تابع لهذه الشركة»: اتأكد من بيانات الشركة، وإن مدير الشركة ضافك فعلًا كعضو فيها.`,
            `On the sign-in page choose "Company member account" at the top, then:\n1. In the first field: the company's e-mail or commercial-register number.\n2. Your own details (e-mail, phone or username) and password.\n\nIf "the company or member details are incorrect, or the member doesn't belong to this company" appears: check the company details, and that the company admin actually added you as a member.`,
            { alt: ['entity_company_mode:633 entity_login:156 intent_how_to:211', 'entity_company_mode:643 symptom_login_failed:356'] }),
        S('login_identifier_options', 'login/identifier/options', 'login',
            'أدخل باسم المستخدم أو رقم الموبايل؟', 'Can I sign in with my username or phone?',
            'entity_username:843 entity_login:156',
            `أيوه — خانة الدخول بتقبل الإيميل أو رقم الهاتف أو اسم المستخدم، أيهم تكتبه.\n\n• «لا يوجد حساب مرتبط بهذا الرقم»: الرقم مش متسجل بالشكل ده — جرّب الإيميل.\n• «اسم المستخدم غير موجود»: اتأكد إنك كاتبه بالحروف الإنجليزية زي ما سجّلته.`,
            `Yes — the sign-in field accepts your e-mail, phone number or username, whichever you type.\n\n• "No account is linked to this number": the number isn't registered that way — try your e-mail.\n• "Username not found": check you typed it in English letters exactly as registered.`),
        S('signup_username_rules', 'account/signup/username_rules', 'login',
            'اسم المستخدم مش مقبول وأنا بسجل', 'Username not accepted at sign-up',
            'entity_username:430 entity_signup:430 entity_not_accepted:139',
            `اسم المستخدم لازم يكون:\n• من ٣ لـ٢٠ حرف.\n• حروف إنجليزية وأرقام وشرطة سفلية (_) بس — من غير مسافات ولا عربي.\n• مش مستخدم قبل كده، ومش من الأسماء المحجوزة.\n\nتحت الخانة بيظهرلك وانت بتكتب إذا كان الاسم متاح.`,
            `The username must be:\n• 3 to 20 characters;\n• English letters, digits and underscore (_) only — no spaces, no Arabic;\n• not already taken, and not one of the reserved names.\n\nBelow the field you're told, as you type, whether it's available.`,
            { alt: ['entity_username:514 symptom_name_taken:314 entity_signup:171', 'entity_username:480 entity_not_accepted:139 atom_register:139 entity_signup:240'] }),
        S('login_pi_network', 'login/pi_network/how', 'login',
            'الدخول بـ Pi Network', 'Signing in with Pi Network',
            'entity_pi_network:843 entity_login:156',
            `«المتابعة بـ Pi Network» بتدخلك بحساب Pi بتاعك من غير كلمة مرور. الخيار ده بيشتغل لما تفتح المنصة من متصفح Pi — من متصفح عادي الزرار مش هيكمّل.\n\nلو ظهر «تم إلغاء تسجيل الدخول بـ Pi Network» يبقى الموافقة اتلغت من ناحية Pi؛ جرّب تاني ووافق. ولو ظهر خطأ تاني، ابعتلي نصه.`,
            `"Continue with Pi Network" signs you in with your Pi account without a password. It works when you open the platform from the Pi Browser — from a regular browser the button won't complete.\n\nIf "Pi Network sign-in cancelled" appears, the approval was cancelled on Pi's side; try again and approve. For any other error, send me its text.`),
        S('login_subdomain_not_yours', 'login/subdomain/not_linked', 'login',
            'بيقول النطاق ده مش مرتبط بحسابك', 'It says this subdomain is not linked to my account',
            'entity_not_linked_account:610 entity_domain:390',
            `إنت فاتح صفحة دخول بوابة شركة (اسمها.mad3oom.com) وحسابك مش تبعها. سجّل الدخول بالحساب المالك للنطاق ده، أو ادخل من الموقع الرئيسي بدل رابط البوابة.\n\nولو مكتوب «هذا النطاق الفرعي غير موجود أو تم حذفه»، يبقى الرابط قديم أو فيه غلطة — اطلب الرابط الصحيح من الشركة.`,
            `You're on a company portal's sign-in page (name.mad3oom.com) and your account doesn't belong to it. Sign in with the account that owns that subdomain, or sign in from the main site instead of the portal link.\n\nIf it says "this subdomain doesn't exist or was deleted", the link is old or mistyped — ask the company for the correct link.`,
            { alt: ['entity_not_linked_account:610 entity_subdomain:390'] }),
        S('security_logout_other_devices', 'security/sessions/logout_others', 'login',
            'عايز أسجّل خروج من كل الأجهزة', 'Sign out of all other devices',
            'entity_all_devices:3 entity_logout:2',
            `من إعدادات الحساب ← حماية الحساب ← الجلسات: «تسجيل الخروج من كل الأجهزة الأخرى» — الجهاز اللي انت عليه بيفضل داخل.\n\nالمنصة لسه مابتعرضش قائمة تفصيلية بالجلسات. ولو شاكك إن حد دخل على حسابك: اعمل الخروج من كل الأجهزة، وغيّر كلمة المرور (التغيير نفسه كمان بيقفل الجلسات التانية).`,
            `From Account settings → Account protection → Sessions: "Sign out of all other devices" — the device you're on stays signed in.\n\nThe platform doesn't show a detailed session list yet. If you suspect someone signed in to your account: sign out everywhere else, and change your password (the change itself also closes other sessions).`),
        S('security_trusted_devices_manage', 'security/trusted_devices/manage', 'login',
            'أشيل جهاز من الأجهزة الموثوقة', 'Remove a trusted device',
            'entity_trust_device:3 intent_delete:2',
            `«الأجهزة الموثوقة» في «حماية الحساب» هي الأجهزة اللي اخترت عليها «تذكّر هذا الجهاز»، فمابيتطلبش منها كود التحقق.\n\nاضغط «إزالة» جنب الجهاز، أو «إزالة كل الأجهزة». الإزالة مابتطلّعش حد من حسابه — بس بترجّع طلب الكود في الدخول الجاي من الجهاز ده. لو عايز تطلّع حد فعلًا، استخدم «تسجيل الخروج من كل الأجهزة الأخرى».`,
            `"Trusted devices" in Account protection are the devices where you chose "Remember this device", so they aren't asked for the verification code.\n\nPress "Remove" next to a device, or "Remove all devices". Removing doesn't sign anyone out — it just brings the code back on the next sign-in from that device. To actually sign someone out, use "Sign out of all other devices".`,
            { alt: ['entity_trust_device:860 atom_remove:139'] }),
        S('security_2fa_turn_off', 'security/2fa/disable', 'login',
            'عايز أوقف التحقق بخطوتين', 'Turn off two-step verification',
            'entity_turn_off:610 entity_2fa:390',
            `من «حماية الحساب» ← التحقق بخطوتين: اكتب رمز حالي من تطبيق المصادقة، أو واحد من رموز الاستعادة، واضغط «إيقاف التحقق بخطوتين».\n\nالإيقاف بيقلل حماية حسابك، فلو السبب إن الموبايل اتغير، الأفضل توقفه وتفعّله تاني على الموبايل الجديد على طول.`,
            `From Account protection → Two-step verification: enter a current code from the authenticator app, or one of your recovery codes, and press "Turn off two-step verification".\n\nTurning it off lowers your account's protection, so if the reason is a new phone, turn it off and immediately back on with the new phone.`),
        S('security_2fa_new_recovery_codes', 'security/2fa/recovery_codes_regenerate', 'login',
            'رموز الاستعادة خلصت أو ضاعت — عايز جداد', 'Recovery codes used up or lost — I need new ones',
            'entity_codes_word:508 intent_recover:323 symptom_expired:169',
            `رموز الاستعادة بتظهر مرة واحدة وقت التفعيل ومتخزنة بشكل مشفّر، فمحدش يقدر يعرضهالك تاني.\n\nعشان تاخد رموز جديدة: من «حماية الحساب» أوقف التحقق بخطوتين (برمز حالي من التطبيق) وفعّله تاني — هتظهرلك رموز جديدة والقديمة بتبطل. احفظها في مكان آمن بعيد عن الموبايل.`,
            `Recovery codes are shown once, when you enable two-step verification, and stored encrypted, so nobody can show them to you again.\n\nTo get new ones: in Account protection turn two-step verification off (with a current app code) and back on — new codes appear and the old ones stop working. Keep them somewhere safe, away from your phone.`,
            { alt: ['entity_codes_word:3 entity_2fa:2 intent_recover:1'] }),
        S('security_2fa_qr_not_showing', 'security/2fa/qr_setup_failed', 'login',
            'كود QR بتاع التحقق بخطوتين مش ظاهر أو مش بيتقري', '2FA QR code not showing or not scanning',
            'entity_qr_code:407 entity_2fa:390 symptom_not_visible:203',
            `لو رمز QR مش ظاهر أو التطبيق مش قادر يقراه: تحته في مفتاح نصّي — في تطبيق المصادقة اختار «إدخال مفتاح يدويًا» وانسخه.\n\nبعدين اكتب الكود المكوّن من ٦ أرقام اللي ظهر في التطبيق واضغط «تأكيد وتفعيل». لو الكود اترفض، اضغط «ابدأ الإعداد من جديد» وجرّب تاني.`,
            `If the QR code doesn't show or the app can't read it: below it there's a text key — in your authenticator app choose "Enter a setup key" and copy it in.\n\nThen type the 6-digit code shown in the app and press "Confirm and enable". If the code is rejected, press "Start setup again" and retry.`),
        S('account_email_change_pending', 'account/email/change_confirmation', 'other',
            'غيّرت الإيميل ولسه القديم هو اللي ظاهر', 'Changed my e-mail but the old one still shows',
            'entity_email:344 atom_change:139 entity_still_old:516',
            `ده الطبيعي لحد ما تأكد: «طلب تغيير البريد» بيبعت لينك تأكيد على الإيميل الجديد، وإيميلك الحالي بيفضل هو المسجّل لحد ما تضغط اللينك.\n\nافتح الإيميل الجديد (وبصّ في الـ Spam) واضغط اللينك. لو ماوصلش، اطلب التغيير تاني واتأكد من كتابة العنوان.`,
            `That's normal until you confirm: "Request e-mail change" sends a confirmation link to the NEW address, and your current e-mail stays registered until you click it.\n\nOpen the new mailbox (check Spam too) and click the link. If it didn't arrive, request the change again and check the address.`,
            { alt: ['entity_email:344 entity_still_old:516 atom_unchanged:139'] }),
        S('account_phone_not_verified_label', 'account/phone/not_verified', 'other',
            'رقم الهاتف مكتوب جنبه «غير موثّق»', 'My phone number says "not verified"',
            'entity_unverified:4 entity_phone_number:2',
            `«غير موثّق برمز» معناها إن الرقم متسجّل من غير كود تحقق — وده لأن المنصة لسه مافيهاش تحقق للرقم بكود أصلًا، مش مشكلة عندك.\n\nالرقم مطلوب عشان الحساب يفضل مفعّل وبيتستخدم في الدخول، فاتأكد بس إنه صحيح ومكتوب بالشكل ده: 01012345678 أو ‎+201012345678.`,
            `"Not verified by code" means the number is registered without a verification code — because the platform has no phone code verification at all yet, not because of a problem on your side.\n\nThe number is required to keep the account active and is used to sign in, so just make sure it's correct and written like 01012345678 or +201012345678.`),
        S('account_bio_visibility', 'account/profile_bio/visibility', 'inquiry',
            'النبذة اللي في حسابي بتظهر لمين', 'Who sees the bio in my profile?',
            'entity_bio:4',
            `النبذة اختيارية، وبتظهر لفريق الدعم وهو بيتعامل مع طلباتك — مفيدة لو حابب يعرفوا مجال شغلك أو طريقة التواصل اللي تفضّلها.\n\nماتكتبش فيها بيانات حساسة زي كلمات مرور أو أرقام كروت.`,
            `The bio is optional, and it's shown to the support team when they handle your requests — useful if you'd like them to know your line of work or how you prefer to be contacted.\n\nDon't put sensitive data in it, such as passwords or card numbers.`),
        S('assistant_rate_limited_wait', 'assistant/rate_limit/wait', 'other',
            'المساعد بيقولي بعت رسايل كتير واستنى', 'The assistant says I sent too many messages and to wait',
            'entity_too_many_messages:4 entity_assistant:1',
            `المساعد بيحدّ عدد الرسايل في وقت قصير عشان يفضل سريع للكل. استنى الثواني المكتوبة في الرسالة، وبعدين ابعت رسالة واحدة فيها كل التفاصيل بدل كذا رسالة ورا بعض.\n\nالانتظار ده مابيتحسبش من حصة رسايلك.`,
            `The assistant limits how many messages it takes in a short time so it stays fast for everyone. Wait the seconds stated in the message, then send one message with all the details instead of several in a row.\n\nThis wait doesn't count against your message quota.`),
        S('notif_ticket_updates_on_whatsapp', 'notification/ticket_whatsapp/availability', 'inquiry',
            'ينفع توصلني إشعارات التذاكر على الواتساب؟', 'Can I get ticket notifications on WhatsApp?',
            'entity_notify_me:3 entity_whatsapp:2 entity_ticket:1',
            `لسه لأ. إشعارات التذاكر (فتح وحل) بتوصل حاليًا جوه المنصة، وعلى الإيميل، وعلى تليجرام لو رابط حسابك.\n\nإشعارات الواتساب موجودة في خارطة الطريق كخطوة جاية. لحد ما تتفعّل، تليجرام أسرع طريقة توصلك بيها الإشعارات على الموبايل.`,
            `Not yet. Ticket notifications (opened and resolved) currently arrive inside the platform, by e-mail, and on Telegram if your account is linked.\n\nWhatsApp notifications are on the roadmap as a next step. Until then, Telegram is the fastest way to get them on your phone.`),
        S('forum_post_topic_how', 'community/forum/post_how', 'inquiry',
            'أنشر موضوع في المنتدى إزاي', 'How to post a topic in the forum',
            'entity_post_topic:3 entity_forum:2 intent_how_to:1',
            `لازم تكون مسجّل دخول. بعدين:\n١. افتح المنتدى واختار القسم المناسب.\n٢. اكتب موضوعك وانشره.\n\nتقدر تعلّق على مواضيع غيرك وتعجب بيها، وبيوصلك إشعار لما حد يتفاعل معاك. ولو ظهر «يرجى تسجيل الدخول أولاً»، سجّل دخول وارجع للمنتدى.`,
            `You need to be signed in. Then:\n1. Open the forum and choose the right section.\n2. Write your topic and publish it.\n\nYou can comment on and like other people's topics, and you're notified when someone interacts with yours. If "please sign in first" appears, sign in and come back to the forum.`,
            { alt: ['entity_post_topic:643 entity_forum:356'] }),
        S('platform_voice_support_availability', 'platform/roadmap/voice_support', 'inquiry',
            'فيه دعم بالمكالمات أو صوتي؟', 'Is there phone or voice support?',
            'entity_voice_support:4',
            `المنصة نصية حاليًا — مفيش مكالمات ولا دعم صوتي.\n\nفي خارطة الطريق: الدعم الصوتي خطوة جاية، والمكالمات بالذكاء الاصطناعي ورسائل الصوت رؤية مستقبلية مش ضمن الجدول الحالي. لحد كده، التذاكر والمحادثة الفورية هما أسرع طريق للدعم.`,
            `The platform is text-based today — there are no calls and no voice support.\n\nOn the roadmap: voice support is a next step, while AI voice calls and voice messages are a future vision outside the current schedule. Until then, tickets and live chat are the fastest route to support.`)
    ]
};
