/**
 * Max · عام — شبكة البيت، برامج الحماية، ساعة الجهاز، بقاء تسجيل الدخول،
 * والوصول للإيميل. GENERAL (not Mad3oom-specific).
 *
 * Every answer is about the customer's browser, device, network or mailbox,
 * stated with facts that hold for any site. The two platform facts used are
 * verified: sign-in accepts e-mail, phone or username (Mad3oom login.html,
 * Pro login_identifier_options), and the session is kept in the browser's
 * site data (api-config.js creates the default supabase-js client, which
 * persists the session in browser storage). The site is served from
 * mad3oom.com and its subdomains (www., sie., wa. in Mad3oom's HTML/JS);
 * mad3oom.online is only the e-mail domain and is NOT named as a site.
 *
 * Each case was checked against its nearest neighbours before writing:
 *   home internet   ≠ gen_work_network_blocking (work firewall), convo_weak_internet
 *   antivirus       ≠ ui_extension_blocking (browser extensions)
 *   device clock    ≠ ssl_certificate_issue (a customer domain's certificate),
 *                     security_2fa_code_rejected_clock (authenticator codes —
 *                     Pro's entity_device_clock, deliberately not reused)
 *   logged out on close ≠ login_token_expired, app_login_loop (session expiry, app)
 *   which e-mail    ≠ login_credentials_forgotten (password), email_wrong_address
 *   lost the mailbox ≠ account_email_change_pending (changing a known address)
 * Rejected in the same pass, as behavioural duplicates of core conversation
 * scenarios (same reply, different words — vocabulary, not scenarios):
 * «لا خلاص مش عايز» = convo_goodbye_nothing_else, «استنى متعملش حاجة» =
 * convo_asks_to_wait, «خليني اشرح تاني» = convo_wrong_message, «اتحلت
 * لوحدها» = convo_after_resolution_check.
 *
 * @no-legitimate-corpus
 */
import { S, T } from '../dsl.mjs';

export default {
    tokens: [
        T('entity_home_internet', 'نت البيت', 'home internet', ['نت البيت', 'انترنت البيت', 'الراوتر', 'راوتر', 'شركة الانترنت', 'شركه الانترنت', 'شركة النت', 'شركه النت', 'router']),
        T('entity_antivirus', 'برنامج الحماية', 'antivirus', ['الانتي فيرس', 'انتي فيرس', 'الانتي فايرس', 'انتي فايرس', 'مضاد الفيروسات', 'برنامج الحماية', 'برنامج الحمايه', 'الكاسبر', 'كاسبر', 'كاسبرسكي', 'افاست', 'نورتون', 'avast', 'kaspersky', 'antivirus', 'norton', 'eset']),
        // Pro owns entity_device_clock («ساعة الموبايل» — authenticator codes);
        // this is the BROWSER's clock warning, with words Pro does not use.
        T('entity_clock_warning', 'تحذير ساعة الجهاز', 'clock warning', ['ساعتك', 'ساعة الجهاز', 'ساعه الجهاز', 'تاريخ الجهاز', 'ساعة الكمبيوتر', 'ساعه الكمبيوتر', 'your clock', 'clock is behind', 'clock is ahead']),
        T('entity_not_secure', 'غير آمن', 'not secure', ['مش امن', 'مش آمن', 'غير امن', 'غير آمن', 'not secure', 'not private']),
        T('entity_on_browser_close', 'عند قفل المتصفح', 'on closing the browser', ['كل ما اقفل', 'لما اقفل', 'بعد ما اقفل', 'اقفله وافتحه', 'ادخل تاني']),
        T('entity_signed_up_with', 'الإيميل اللي سجّلت بيه', 'the address I signed up with', ['سجلت بانهي', 'سجلت باي', 'سجلت بيه', 'سجلت بيها', 'عملت بيه الحساب', 'عملت بيها الحساب', 'عملت بيه', 'signed up with', 'registered with']),
        T('entity_forgot', 'نسيت', 'forgot', ['نسيت', 'ناسي', 'مش فاكر', 'مش فاكره', 'forgot']),
        T('entity_lost_mailbox', 'مبقاش معايا', 'no longer have access', ['مبقاش معايا', 'مبقاش معاي', 'مبقتش بقدر', 'مبقتش اقدر', 'مش معايا خلاص', 'مش بقدر افتحه', 'lost access'])
    ],
    scenarios: [
        S('gen_home_internet_blocking', 'device/network/home_isp', 'technical',
            'الموقع مش بيفتح على نت البيت بس', 'The site does not open on my home internet only',
            'entity_home_internet:5 symptom_blank_page:1 entity_dashboard:1',
            `لو الموقع بيفتح على نت الموبايل ومش بيفتح على نت البيت، المشكلة غالبًا في الراوتر أو شركة الإنترنت:\n• اقفل الراوتر دقيقة وشغّله تاني.\n• جرّب جهاز تاني على نفس الشبكة — لو مش بيفتح برضه، يبقى من الشبكة مش من جهازك.\n• لو فضلت، بلّغ شركة الإنترنت إن موقع معيّن مش بيفتح عندهم، أو غيّر إعدادات الـ DNS في الراوتر لو عارف تعمل كده.\n\nولو مش بيفتح على نت الموبايل كمان، قولّي.`,
            `If the site opens on mobile data but not on your home internet, the problem is most likely the router or your internet provider:\n• Turn the router off for a minute and back on.\n• Try another device on the same network — if it fails there too, it's the network, not your device.\n• If it continues, tell your provider a specific site won't open for you, or change the router's DNS settings if you know how.\n\nIf it doesn't open on mobile data either, tell me.`,
            { alt: ['entity_home_internet:5 symptom_not_working:1'] }),
        S('gen_antivirus_blocking', 'device/security_software/blocking', 'technical',
            'برنامج الحماية (Antivirus) مانع الموقع', 'Antivirus software is blocking the site',
            'entity_antivirus:5 symptom_blank_page:1',
            `برامج الحماية ساعات بتمنع مواقع، أو بتفحص الاتصال الآمن بطريقة بتعطّل الصفحة:\n• وقّف «حماية الويب» في البرنامج دقيقة وافتح الموقع — لو اشتغل، يبقى البرنامج هو السبب.\n• ضيف mad3oom.com ونطاقاته الفرعية (*.mad3oom.com) لقائمة المواقع الموثوقة أو الاستثناءات جوه البرنامج.\n• ورجّع الحماية تشتغل بعدها.`,
            `Security software sometimes blocks sites, or inspects secure connections in a way that breaks the page:\n• Pause the program's "web protection" for a minute and open the site — if it works, the program is the cause.\n• Add mad3oom.com and its subdomains (*.mad3oom.com) to the program's trusted sites or exceptions.\n• Then turn protection back on.`,
            { alt: ['entity_antivirus:5 symptom_not_working:1'] }),
        S('gen_device_clock_wrong', 'device/clock/security_errors', 'technical',
            'المتصفح بيقول إن ساعة الجهاز غلط أو الاتصال مش آمن', 'The browser says the clock is wrong or the connection is not secure',
            'entity_clock_warning:5 entity_not_secure:2',
            `لو المتصفح بيقول إن ساعتك متأخرة أو متقدمة، أو إن الاتصال مش آمن على مواقع كتير مرة واحدة، غالبًا تاريخ الجهاز أو ساعته غلط — والشهادات الأمنية بتتحقق بالتاريخ.\n• ويندوز: الإعدادات ← الوقت واللغة ← فعّل «تعيين الوقت تلقائيًا».\n• ماك: إعدادات النظام ← عام ← التاريخ والوقت ← تلقائي.\n• الموبايل: الإعدادات ← التاريخ والوقت ← تلقائي.\n\nوبعدين افتح الصفحة تاني.`,
            `If the browser says your clock is behind or ahead, or that the connection isn't secure on many sites at once, the device's date or time is most likely wrong — security certificates are checked against the date.\n• Windows: Settings ▸ Time & language ▸ turn on "Set time automatically".\n• Mac: System Settings ▸ General ▸ Date & Time ▸ automatic.\n• Phone: Settings ▸ Date & time ▸ automatic.\n\nThen open the page again.`,
            { alt: ['entity_clock_warning:5 symptom_slow:1', 'entity_clock_warning:1'] }),
        S('gen_logged_out_on_browser_close', 'device/browser/session_not_kept', 'login',
            'بيطلب مني أدخل تاني كل ما أقفل المتصفح', 'I have to sign in again every time I close the browser',
            'entity_on_browser_close:518 symptom_token_expired:259 entity_browser:223',
            `تسجيل دخولك بيتحفظ في بيانات الموقع جوه المتصفح. لو بيطلب منك تدخل تاني كل ما تقفله:\n• غالبًا المتصفح مضبوط إنه يمسح بيانات المواقع عند الإغلاق — شيل الخيار ده، أو ضيف موقعنا للاستثناءات.\n• أو انت في وضع التصفح الخفي، واللي بيمسح كل حاجة لما تقفله.\n• برامج تنظيف الجهاز كمان ممكن تمسحها.`,
            `Your sign-in is kept in the site's data inside the browser. If you have to sign in again every time you close it:\n• The browser is most likely set to clear site data on exit — turn that off, or add our site as an exception.\n• Or you're in private browsing, which clears everything when closed.\n• Device-cleaning programs can also wipe it.`,
            { alt: ['entity_on_browser_close:637 entity_browser:223 atom_open_action:139'] }),
        S('gen_forgot_signup_email', 'account/access/which_email', 'login',
            'مش فاكر سجّلت بأنهي إيميل', 'I do not remember which e-mail I signed up with',
            'entity_signed_up_with:4 entity_email:2 entity_forgot:2',
            `جرّب بالترتيب:\n• خانة الدخول بتقبل كمان رقم الهاتف أو اسم المستخدم — لو فاكر واحد منهم، ادخل بيه وهتلاقي الإيميل في بيانات حسابك.\n• دوّر في كل إيميلاتك (والـ Spam) على رسائل وصلتك منّا — اللي فيه الرسائل هو غالبًا المسجّل.\n• استخدم «نسيت كلمة المرور» بكل إيميل عندك: اللينك بيوصل للإيميل المسجّل بس.\n\nلو مانفعش ولا حاجة، قولّي وأنا أفتح طلب للفريق يساعدك تتحقق من حسابك.`,
            `Try in this order:\n• The sign-in field also accepts your phone number or username — if you remember either, sign in with it and you'll find the e-mail in your account details.\n• Search all your mailboxes (and Spam) for messages from us — the one that has them is most likely the registered address.\n• Use "Forgot password" with each address you have: the link only arrives at the registered one.\n\nIf none of that works, tell me and I'll open a request for the team to help you verify your account.`,
            { alt: ['entity_forgot:610 entity_email:390'] }),
        S('gen_lost_access_to_email', 'account/access/lost_mailbox', 'login',
            'الإيميل المسجّل على الحساب مبقاش معايا', 'I no longer have access to the e-mail on my account',
            'entity_lost_mailbox:4 entity_email:3 entity_account:1',
            `لو لسه قادر تدخل حسابك: غيّر الإيميل من بيانات الحساب لإيميل معاك دلوقتي — وأي لينك تأكيد هيوصل للإيميل الجديد.\n\nلو مش قادر تدخل، ولينكات الاستعادة بتروح للإيميل اللي مبقاش معاك، ده محتاج الفريق يتحقق إنك صاحب الحساب قبل أي تغيير. قولّي وأنا أفتح الطلب، ومتبعتش كلمة المرور في المحادثة.`,
            `If you can still sign in: change the e-mail in your account details to one you have now — any confirmation link will go to the new address.\n\nIf you can't sign in, and recovery links go to the address you no longer have, the team needs to verify that you own the account before changing anything. Tell me and I'll open the request — and don't send your password in the chat.`,
            { alt: ['entity_lost_mailbox:610 entity_email:390'] })
    ]
};
