/**
 * Max · عام — الإيميل من ناحية العميل، والأمان اليومي. GENERAL.
 *
 * Mail-client and personal-security facts true for any service. The one
 * platform claim — "we never ask for your password or a verification code"
 * — is the one Pro's email_phishing_suspected already states.
 *
 * Neighbours checked:
 *   Promotions / Other tab     ≠ core email_going_to_spam (the business's mail channel)
 *   mailbox full               ≠ core email_bouncing_back (their customers' mail)
 *   sender blocked by mistake  — nothing
 *   company mail filter        ≠ gen_work_network_blocking (the web, not mail)
 *   remote-access scam         ≠ Pro email_phishing_suspected (a message, not a call + app)
 *   caller asking for the code ≠ Pro email_phishing_suspected (an e-mail/link)
 *   adware pop-ups             ≠ gen_popup_blocked (OUR window is blocked)
 *   screenshot with my data    ≠ Pro ticket_sent_sensitive_data (already sent)
 * Rejected as not representable: e-mail images not showing («الصور» is core's
 * WhatsApp-media token); a notification arriving twice (every word is a base
 * token, next to core notifications_too_many); "I replied to the e-mail and
 * nobody answered" (Pro/core words only, next to Pro email_official_senders).
 *
 * @no-legitimate-corpus
 */
import { S, T } from '../dsl.mjs';

export default {
    tokens: [
        T('entity_promotions_tab', 'تبويب الترويج', 'Promotions tab', ['promotions', 'الترويجيه', 'تبويب الترويج', 'other tab', 'focused', 'updates tab']),
        T('entity_mailbox_full', 'صندوق البريد مليان', 'mailbox full', ['صندوق البريد مليان', 'صندوق البريد', 'البريد مليان', 'الانبوكس مليان', 'mailbox full', 'mailbox quota']),
        T('entity_blocked_sender', 'بلوك للمرسل', 'blocked the sender', ['بلوك للايميل', 'عملت بلوك', 'حظرت المرسل', 'blocked sender', 'blocked the sender', 'unblock']),
        T('entity_mail_receiving', 'مش بيستقبل', 'not receiving', ['بيستقبل', 'مش بيستقبل', 'مابيستقبلش', 'مبيستقبلش', 'بيوصلوش', 'quarantine']),
        T('entity_remote_app', 'برنامج تحكّم عن بعد', 'remote-access app', ['anydesk', 'اني ديسك', 'انى ديسك', 'teamviewer', 'تيم فيوير', 'تيم فيور', 'rustdesk', 'quicksupport', 'تحكم عن بعد', 'برنامج تحكم', 'remote access', 'remote control']),
        T('entity_someone_asked', 'حد طلب مني', 'someone asked me', ['حد طلب مني', 'طلب مني', 'حد عايزني', 'someone asked me', 'asked me to']),
        T('entity_caller', 'حد كلّمني', 'someone called me', ['حد كلمني', 'كلمني حد', 'حد اتصل', 'اتصل بيا', 'كلموني', 'رن عليا', 'مكالمه من', 'مكالمة من', 'someone called', 'called me']),
        T('entity_adware', 'إعلانات بتفتح لوحدها', 'ads opening by themselves', ['اعلانات بتفتح', 'اعلانات كتير', 'اعلانات غريبه', 'صفحات غريبه بتفتح', 'صفحات غريبة بتفتح', 'نوافذ بتفتح لوحدها', 'popups everywhere', 'adware', 'ads keep opening']),
        T('entity_my_data', 'بياناتي', 'my personal data', ['بياناتي', 'بيانات شخصيه', 'بيانات شخصية', 'my data', 'personal data', 'my details']),
        T('entity_redact', 'أخبّي', 'hide / blur', ['اخبي', 'اغطي', 'اشطب', 'اطمس', 'blur', 'redact', 'hide my data'])
    ],
    scenarios: [
        S('gen_email_in_promotions_tab', 'email/client/promotions_tab', 'technical',
            'الإيميلات بتروح لتبويب الترويج (Promotions)', 'E-mails land in the Promotions tab',
            'entity_promotions_tab:4 entity_email:2',
            `Gmail بيوزّع الإيميلات على تبويبات (الأساسي، الترويج، التحديثات)، وOutlook بيقسمها «المركّز» و«أخرى»:\n• افتح الإيميل من التبويب اللي وصل فيه، واسحبه لـ «الأساسي» (أو في Outlook: «نقل إلى المركّز» ← «دايمًا»).\n• Gmail هيسألك تعمل كده لكل الإيميلات الجاية من نفس المرسل — وافق.\n• ضيف عنوان المرسل لجهات الاتصال.`,
            `Gmail sorts mail into tabs (Primary, Promotions, Updates), and Outlook into "Focused" and "Other":\n• Open the e-mail from the tab it landed in and drag it to "Primary" (in Outlook: "Move to Focused" ▸ "Always").\n• Gmail will offer to do this for future mail from the same sender — accept.\n• Add the sender's address to your contacts.`),
        S('gen_mailbox_full', 'email/client/mailbox_full', 'technical',
            'صندوق البريد بتاعي مليان', 'My mailbox is full',
            'entity_mailbox_full:5 entity_email:1',
            `لما صندوق البريد يتملي، الإيميلات الجديدة (ومنها رسايلنا وأكواد التحقق) بترجع ومابتوصلش:\n• Gmail: المساحة مشتركة مع Drive وصور جوجل — امسح الإيميلات الكبيرة (دوّر بـ larger:10M)، وفضّي «المهملات».\n• Outlook/Hotmail: امسح القديم وفضّي «العناصر المحذوفة».\n\nبعدها اطلب الإيميل اللي كنت مستنيه تاني.`,
            `When a mailbox is full, new e-mails (including ours and verification codes) bounce and never arrive:\n• Gmail: storage is shared with Drive and Google Photos — delete large e-mails (search larger:10M) and empty the Bin.\n• Outlook/Hotmail: delete old mail and empty "Deleted Items".\n\nThen request the e-mail you were waiting for again.`),
        S('gen_email_sender_blocked', 'email/client/sender_blocked', 'technical',
            'عملت بلوك لإيميلكم بالغلط', 'I blocked your e-mails by mistake',
            'entity_blocked_sender:4 entity_email:2',
            `تقدر تشيل الحظر من إعدادات الإيميل:\n• Gmail (كمبيوتر): الإعدادات ← «عرض كل الإعدادات» ← «الفلاتر والعناوين المحظورة» ← امسح العنوان من القائمة.\n• Gmail (موبايل): افتح أي إيميل قديم من المرسل ← القائمة (⋮) ← «إلغاء حظر».\n• Outlook: الإعدادات ← البريد ← البريد العشوائي ← «المرسلون المحظورون».\n\nوبعدها بصّ في الـ Spam — الإيميلات اللي اتحظرت غالبًا راحت هناك.`,
            `You can remove the block in your mail settings:\n• Gmail (computer): Settings ▸ "See all settings" ▸ "Filters and Blocked Addresses" ▸ remove the address.\n• Gmail (phone): open any old e-mail from the sender ▸ menu (⋮) ▸ "Unblock".\n• Outlook: Settings ▸ Mail ▸ Junk email ▸ "Blocked senders".\n\nThen check Spam — blocked e-mails usually went there.`),
        S('gen_company_mail_filter', 'email/client/company_filter', 'technical',
            'إيميل الشركة مش بيستقبل رسايلكم', 'Our company e-mail does not receive your messages',
            'entity_mail_receiving:516 atom_company:139 entity_email:344',
            `إيميلات الشركات غالبًا وراها فلتر أو «حجر» بيحجز الرسايل الأوتوماتيك قبل ما توصل:\n• اطلب من قسم IT يدوّر في الحجر (Quarantine) على رسايلنا ويسمح بدومين المرسل.\n• اطلب منهم يضيفوه لقائمة المرسلين الموثوقين.\n• لحد ما يتحل، تقدر تستخدم إيميل شخصي للحاجات المستعجلة زي أكواد التحقق.`,
            `Company mailboxes often sit behind a filter or "quarantine" that holds automated messages before they arrive:\n• Ask your IT team to look in the quarantine for our messages and allow the sender's domain.\n• Ask them to add it to the trusted senders list.\n• Until it's fixed, you can use a personal e-mail for urgent things such as verification codes.`),
        S('gen_remote_access_scam', 'security/scam/remote_access_app', 'security',
            'حد طلب مني أنزّل برنامج تحكّم عن بعد (AnyDesk)', 'Someone asked me to install a remote-access app (AnyDesk)',
            'entity_remote_app:4 entity_someone_asked:2',
            `متنزّلوش — وده مهم: برنامج التحكم عن بعد بيدّي اللي على الطرف التاني تحكّم كامل في جهازك، وبيقدر يشوف حساباتك وأكوادك وتطبيق البنك.\n• احنا مش بنطلب منك تنزّل برنامج تحكّم ولا نطلب كلمة المرور أو كود تحقق.\n• لو نزّلته فعلًا: اقفله وامسحه، غيّر كلمات المرور المهمة من جهاز تاني، وسجّل خروج من كل الأجهزة.\n• لو في حد اتصل بيك باسمنا، ابعتلي رقمه وميعاد المكالمة.`,
            `Don't install it — this matters: a remote-access app gives the person on the other end full control of your device, including your accounts, codes and banking app.\n• We never ask you to install a remote-control app, nor for your password or a verification code.\n• If you already installed it: close and uninstall it, change your important passwords from another device, and sign out of all devices.\n• If someone called you in our name, send me their number and when they called.`),
        S('gen_caller_asks_for_code', 'security/scam/caller_asks_code', 'security',
            'حد كلّمني وطلب الكود اللي جالي', 'Someone called me and asked for the code I received',
            'entity_caller:810 entity_otp:190',
            `متديهوش الكود — أي حد بيطلب كود التحقق اللي وصلك بيحاول يدخل حسابك، حتى لو قال إنه من الدعم:\n• احنا مش بنطلب كود التحقق ولا كلمة المرور أبدًا، لا بمكالمة ولا برسالة.\n• لو قلته فعلًا: غيّر كلمة المرور دلوقتي، سجّل خروج من كل الأجهزة، وفعّل التحقق بخطوتين.\n• ابعتلي رقمه وميعاد المكالمة عشان الفريق يتابع.`,
            `Don't give them the code — anyone asking for a verification code you received is trying to get into your account, even if they say they're from support:\n• We never ask for a verification code or your password, not by call and not by message.\n• If you already told them: change your password now, sign out of all devices, and turn on two-step verification.\n• Send me their number and when they called so the team can follow up.`,
            { alt: ['entity_caller:860 atom_code:139', 'entity_caller:670 atom_support:139 entity_otp:190'] }),
        S('gen_adware_popups', 'security/device/adware_popups', 'security',
            'إعلانات وصفحات غريبة بتفتح لوحدها', 'Ads and strange pages open by themselves',
            'entity_adware:860 atom_by_itself:139',
            `ده غالبًا إضافة متصفح أو برنامج إعلانات اتسطّب من غير ما تاخد بالك — مش من الموقع:\n• المتصفح: افتح الإضافات وامسح أي إضافة ماتعرفهاش أو مش فاكر سطّبتها.\n• كروم: الإعدادات ← إعادة الضبط والتنظيف ← «استعادة الإعدادات لقيمها الأصلية».\n• أندرويد: الإعدادات ← الإشعارات، ودوّر على موقع أو تطبيق بيبعت إعلانات واقفل إشعاراته.\n• شغّل فحص من برنامج حماية معروف.`,
            `This is usually a browser extension or adware installed without you noticing — not the site:\n• Browser: open Extensions and remove anything you don't recognise or don't remember installing.\n• Chrome: Settings ▸ Reset settings ▸ "Restore settings to their original defaults".\n• Android: Settings ▸ Notifications — find any site or app sending ads and turn its notifications off.\n• Run a scan with a well-known security program.`),
        S('gen_screenshot_privacy', 'security/privacy/screenshot_redact', 'security',
            'أبعت صورة فيها بياناتي؟', 'Should I send a screenshot that shows my personal data?',
            'entity_my_data:2 entity_redact:2 entity_wa_media:2',
            `ابعتها، بس خبّي الحساس الأول:\n• غطّي أو اشطب: رقم الكارت كامل، الرقم السري أو الـ CVV، كلمات المرور، وأي كود تحقق.\n• على الموبايل: بعد ما تاخد الصورة، دوس «تعديل» وارسم فوق البيانات.\n• آخر ٤ أرقام من الكارت، والتاريخ والمبلغ، مفيش مشكلة تبان — بيساعدوني ألاقي العملية.`,
            `Send it, but hide the sensitive parts first:\n• Cover or cross out: the full card number, PIN or CVV, passwords, and any verification code.\n• On a phone: after taking the screenshot, tap "Edit" and draw over the data.\n• The last 4 digits of the card, the date and the amount are fine to show — they help me find the transaction.`)
    ]
};
