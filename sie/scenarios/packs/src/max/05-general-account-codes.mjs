/**
 * Max · عام — الحساب والدخول وأكواد التحقق. GENERAL (not Mad3oom-specific).
 *
 * Answers use facts that hold for any site, and only platform facts already
 * verified for Pro: sign-in accepts e-mail, phone or username (Mad3oom
 * login.html, Pro login_identifier_options); «نسيت كلمة المرور» exists
 * (forgot-password.html); 2FA can be turned off and has recovery codes
 * (Pro security_2fa_turn_off / security_2fa_use_recovery_code); signing out
 * other devices exists (Pro security_logout_other_devices). E-mail addresses
 * are case-insensitive at sign-in (supabase-js lower-cases them).
 *
 * The code cases split one family the user named explicitly — «الكود مش
 * بيوصل» (core login_otp_not_received) vs «وصل بس غلط» vs «وصل متأخر» vs
 * «مش راضي يبعت تاني» — each a different state with a different fix. «خلصت
 * المحاولات» is Pro security_2fa_too_many_attempts (same fix for any code:
 * wait, then a NEW code) — vocabulary, not a scenario.
 *
 * Neighbours checked before writing:
 *   email already registered ≠ Pro account_phone_already_registered (phone)
 *   username forgotten       ≠ Pro signup_username_rules (choosing one)
 *   switch accounts          ≠ Pro ticket_opened_on_wrong_account (a ticket)
 *   works on one device      ≠ gen_home_internet_blocking (a network)
 *   browser won't save pw    ≠ gen_password_autofill_wrong (saves the OLD one)
 *   code rejected            ≠ Pro security_2fa_code_rejected_clock (authenticator)
 *   authenticator new phone  ≠ core security_2fa_device_lost (phone is GONE)
 *   pw sent to someone       ≠ Pro ticket_sent_sensitive_data (in a ticket)
 *   strong password how      ≠ core security_password_policy_strict (rules refuse)
 * Removed on reading the neighbour: reset e-mail not arriving
 * (login_credentials_forgotten says Spam/Promotions, then a ticket).
 *
 * @no-legitimate-corpus
 */
import { S, T } from '../dsl.mjs';

export default {
    tokens: [
        T('entity_code_rejected', 'الكود بيترفض', 'code rejected', ['الكود غلط', 'الكود بيقول غلط', 'كود غير صحيح', 'رمز غير صحيح', 'الرمز غلط', 'الكود مش مقبول', 'invalid code', 'wrong code', 'incorrect code', 'code is invalid']),
        T('entity_already_exists', 'موجود بالفعل', 'already exists', ['موجود بالفعل', 'مسجل بالفعل', 'متسجل بالفعل', 'موجود قبل كده', 'already exists', 'already in use', 'exists already']),
        // «وصل بعد / جالي بعد» — arrived AFTER (its time ran out). A phrase of
        // open words: «متأخر» is the base's symptom_slow and «خلص» its
        // symptom_expired, and core already reads «الكود متأخر» as NOT arrived
        // (symptom_otp_not_received) — so a bare «وصل متأخر» stays there.
        T('entity_arrived_after', 'وصل بعد ما وقته خلص', 'arrived after it expired', ['وصل بعد', 'وصلني بعد', 'وصلي بعد', 'جالي بعد', 'بيوصل بعد', 'بيوصلني بعد', 'بيجي بعد', 'بيجيلي بعد', 'جه بعد', 'arrived after', 'comes after', 'came after']),
        T('entity_resend_blocked', 'طلب كود تاني', 'requesting another code', ['ابعتلي تاني', 'اعادة الارسال', 'اعاده الارسال', 'اعادة ارسال', 'ارسال مره تانيه', 'ارسال مرة تانية', 'ارسل تاني', 'resend', 'send again', 'استنى قبل ما', 'حاول بعد شوية', 'try again later']),
        T('entity_two_accounts', 'أكتر من حساب', 'more than one account', ['حسابين', 'عندي حسابين', 'اكتر من حساب', 'الحساب التاني', 'two accounts', 'another account', 'switch account', 'switch accounts']),
        // «شغال عادي» — the working half of "works here, not there". Generic:
        // alone it means nothing (policy GENERIC_WORDS).
        T('entity_works_normally', 'شغال عادي', 'works normally', ['عادي', 'شغال عادي', 'بيفتح عادي', 'works fine', 'works normally']),
        T('entity_computer', 'الكمبيوتر', 'computer', ['من الكمبيوتر', 'على الكمبيوتر', 'اللابتوب', 'لابتوب', 'الكمبيوتر بتاعي', 'الديسكتوب', 'laptop', 'desktop', 'pc']),
        T('entity_remember_word', 'يفتكر', 'remember', ['يفتكر', 'بيفتكر', 'مابيفتكرش', 'يفتكرها', 'remember', 'remembers', 'save']),
        T('entity_new_phone', 'موبايل جديد', 'new phone', ['موبايل جديد', 'تليفون جديد', 'غيرت الموبايل', 'غيرت موبايلي', 'غيرت التليفون', 'جهاز جديد', 'موبايلي الجديد', 'new phone', 'changed my phone', 'new device']),
        T('entity_not_me', 'مش أنا اللي عملت كده', 'it was not me', ['ماعملتش حساب', 'معملتش حساب', 'ماسجلتش', 'مسجلتش', 'مش انا اللي سجلت', 'انا ماعملتش', 'didnt sign up', 'did not sign up', 'i didnt register']),
        T('entity_not_requested', 'ماطلبتش', 'did not request it', ['ماطلبتش', 'مطلبتش', 'من غير ما اطلب', 'انا مطلبتش', 'انا ماطلبتش', 'didnt request', 'did not request', 'i didnt ask for']),
        T('entity_capital_letter', 'حرف كبير (كابيتال)', 'capital letter', ['حرف كابيتال', 'اول حرف كابيتال', 'حرف كبير', 'بيكبر اول حرف', 'بيكتب اول حرف كبير', 'capital letter', 'uppercase', 'auto capitalize', 'autocapitalize']),
        // «شيرت / بعتله … » — the words around a base-resolved «الباسورد». Not a
        // bare «بعت»: it matched «ببعت» ("I'm sending") in any message.
        T('entity_shared_with_someone', 'بعتها لحد', 'shared with someone', ['بعتله', 'بعتهاله', 'شيرت', 'شيرته', 'شاركت', 'حد عرف', 'حد عارف', 'shared it']),
        T('entity_strong_password', 'كلمة مرور قوية', 'strong password', ['كلمة سر قوية', 'كلمة سر قويه', 'كلمة مرور قوية', 'كلمة سر صعبة']),
        // «قوي/صعب» next to a base-resolved «الباسورد». Generic alone.
        T('entity_strength_word', 'قوية', 'strong', ['قوي', 'قوية', 'قويه', 'صعب', 'صعبة', 'strong', 'secure'])
    ],
    scenarios: [
        S('gen_signup_email_already_used', 'account/signup/email_already_registered', 'login',
            'بيقولي الإيميل متسجّل قبل كده وأنا بعمل حساب', 'Signing up says the e-mail is already registered',
            'entity_already_exists:4 entity_email:2 entity_signup:1',
            `معناها إن فيه حساب معمول بالإيميل ده قبل كده — غالبًا انت أو حد من شركتك سجّل بيه:\n• ادخل بيه من صفحة الدخول بدل ما تعمل حساب جديد.\n• لو مش فاكر كلمة المرور: «نسيت كلمة المرور» — اللينك بيوصل للإيميل ده نفسه.\n\nولو متأكد إنك عمرك ما سجّلت بيه، قولّي وأنا أفتح طلب للفريق يراجع الحساب — ومتعملش حساب تاني بإيميل مختلف قبل ما نتأكد.`,
            `It means an account already exists with this e-mail — most likely you or someone at your company signed up with it:\n• Sign in with it from the sign-in page instead of creating a new account.\n• If you don't remember the password: "Forgot password" — the link goes to this same e-mail.\n\nIf you're sure you never signed up with it, tell me and I'll open a request for the team to review the account — and don't create a second account with another e-mail until we've checked.`),
        S('gen_username_forgotten', 'account/access/username_forgotten', 'login',
            'نسيت اسم المستخدم', 'I forgot my username',
            'entity_username:700 entity_forgot:299',
            `مش محتاجه عشان تدخل: خانة الدخول بتقبل كمان الإيميل أو رقم الموبايل المسجّلين. ادخل بأي واحد منهم، وهتلاقي اسم المستخدم في بيانات حسابك.\n\nولو ناسي كلمة المرور كمان، استخدم «نسيت كلمة المرور» بالإيميل.`,
            `You don't need it to sign in: the sign-in field also accepts your registered e-mail or phone number. Sign in with either, and you'll find your username in your account details.\n\nIf you've also forgotten the password, use "Forgot password" with your e-mail.`),
        S('gen_switch_between_accounts', 'account/access/switch_accounts', 'login',
            'عندي أكتر من حساب وعايز أبدّل بينهم', 'I have more than one account and want to switch',
            'entity_two_accounts:5 entity_account:1',
            `المتصفح بيفتكر حساب واحد في المرة:\n• عشان تبدّل: سجّل خروج من القائمة، وادخل بالحساب التاني.\n• ولو محتاج الاتنين مفتوحين مع بعض: افتح التاني في نافذة تصفح خفي أو في متصفح تاني.\n\nولو عملت حاجة من الحساب الغلط (زي تذكرة أو طلب)، قولّي وأنا أظبطها معاك.`,
            `A browser keeps one account signed in at a time:\n• To switch: sign out from the menu and sign in with the other account.\n• If you need both open together: open the second one in a private window or another browser.\n\nIf you did something from the wrong account (such as a ticket or a request), tell me and I'll sort it out with you.`,
            { alt: ['entity_two_accounts:3 entity_wrong_account:2'] }),
        S('gen_works_on_one_device_only', 'device/compare/one_device_only', 'technical',
            'شغال على جهاز ومش شغال على التاني', 'It works on one device but not the other',
            'entity_computer:3 qualifier_mobile:3 entity_works_normally:2',
            `لو نفس الحساب شغال على جهاز ومش شغال على التاني، المشكلة في الجهاز اللي مش شغال — مش في حسابك:\n١. على الجهاز ده: امسح بيانات موقعنا (الكوكيز وبيانات الموقع) وادخل تاني.\n٢. جرّب عليه نافذة تصفح خفي — لو اشتغل، السبب إضافة أو بيانات قديمة.\n٣. اتأكد إن تاريخ ووقت الجهاز «تلقائي».\n٤. جرّب متصفح تاني على نفس الجهاز.\n\nولو الجهازين على نفس الشبكة، يبقى السبب مش النت.`,
            `If the same account works on one device and not the other, the problem is the device that fails — not your account:\n1. On that device: clear our site's data (cookies and site data) and sign in again.\n2. Try a private window on it — if that works, an extension or old data is the cause.\n3. Make sure the device's date and time are set to automatic.\n4. Try another browser on the same device.\n\nIf both devices are on the same network, the internet isn't the cause.`,
            { alt: ['entity_computer:3 qualifier_mobile:2 symptom_not_working:2'] }),
        S('gen_browser_not_saving_password', 'device/browser/password_not_saved', 'login',
            'المتصفح مش بيعرض يحفظ كلمة المرور', 'The browser does not offer to save my password',
            'symptom_not_saving:520 entity_password:256 entity_browser:223',
            `المتصفح بيعرض حفظ كلمة المرور بعد ما تدخل بنجاح. لو مابيعرضش:\n• كروم: الإعدادات ← الملء التلقائي وكلمات المرور ← مدير كلمات المرور: اتأكد إن «عرض حفظ كلمات المرور» مفعّل، وإن موقعنا مش في قائمة المواقع اللي رفضت حفظها.\n• سفاري: الإعدادات ← كلمات المرور.\n• في التصفح الخفي المتصفح مابيحفظش أصلًا.\n\nولو الجهاز مش بتاعك، الأحسن ماتحفظهاش.`,
            `The browser offers to save a password after you sign in successfully. If it doesn't:\n• Chrome: Settings ▸ Autofill and passwords ▸ Password Manager: make sure "Offer to save passwords" is on, and that our site isn't on the list of sites you declined.\n• Safari: Settings ▸ Passwords.\n• A private window never saves passwords.\n\nIf the device isn't yours, it's better not to save it.`,
            { alt: ['entity_remember_word:557 entity_password:256 entity_browser:186'] }),
        S('gen_verification_code_rejected', 'account/codes/rejected', 'login',
            'كود التحقق وصل بس بيقول إنه غلط', 'The verification code arrived but is rejected',
            'entity_code_rejected:5 entity_otp:1',
            `لو الكود بيوصلك في رسالة وبيترفض:\n• استخدم آخر كود وصلك بس — أي طلب جديد بيلغي اللي قبله.\n• اكتبه بنفسك بدل النسخ: النسخ ساعات بيجيب مسافة أو حرف زيادة.\n• اتأكد إنه كود الخطوة دي بالظبط، مش كود قديم أو من موقع تاني.\n• الأكواد عمرها قصير — لو عدّى وقت، اطلب واحد جديد.\n\nولو الكود من تطبيق مصادقة (زي Google Authenticator) وبيترفض، السبب غالبًا ساعة الموبايل — خليها «تلقائي».`,
            `If the code reaches you in a message and is rejected:\n• Use only the latest code you received — every new request cancels the previous one.\n• Type it yourself instead of pasting: pasting sometimes brings an extra space or character.\n• Make sure it's the code for this exact step, not an old one or one from another site.\n• Codes are short-lived — if time has passed, request a new one.\n\nIf the code comes from an authenticator app (such as Google Authenticator) and is rejected, the phone's clock is the usual cause — set it to automatic.`),
        S('gen_verification_code_late', 'account/codes/arrives_late', 'login',
            'كود التحقق بيوصل متأخر بعد ما وقته يخلص', 'The verification code arrives after it has expired',
            'entity_arrived_after:675 entity_otp:190 symptom_expired:135',
            `لو الكود بيوصلك بعد ما وقته يخلص:\n• اطلب كود جديد وافضل على نفس الصفحة لحد ما يوصل — ماتطلبش تاني قبل ما دقيقة أو اتنين يعدّوا، لأن كل طلب جديد بيلغي اللي قبله.\n• لو بيوصل على الإيميل: الإيميلات أحيانًا بتتأخر — بصّ في الـ Spam وفي «الترويج» (Promotions).\n• لو بيوصل على الموبايل: الشبكة الضعيفة بتأخّر الرسايل — جرّب مكان إشارته أحسن أو واي فاي.`,
            `If the code reaches you after it has expired:\n• Request a new one and stay on the same page until it arrives — don't request again before a minute or two has passed, because every new request cancels the previous one.\n• If it comes by e-mail: e-mails are sometimes delayed — check Spam and Promotions.\n• If it comes to your phone: a weak signal delays messages — try somewhere with better signal or Wi-Fi.`),
        S('gen_code_resend_blocked', 'account/codes/resend_blocked', 'login',
            'مش راضي يبعت كود تاني — بيقولي استنى', 'It will not send another code — it says to wait',
            'entity_resend_blocked:810 entity_otp:190',
            `ده غالبًا حماية من الإرسال المتكرر: بعد كذا طلب ورا بعض، طلب كود جديد بيتقفل شوية.\n• استنى الوقت اللي ظاهر (أو دقايق قليلة)، وبعدين اطلب مرة واحدة بس.\n• استخدم آخر كود يوصلك.\n\nولو كل طلب بيفشل حتى بعد الانتظار، قولّي انت فين بالظبط (الدخول ولا التسجيل ولا غيره) عشان أشوفها.`,
            `This is usually protection against repeated sending: after several requests in a row, requesting a new code is paused for a while.\n• Wait the time shown (or a few minutes), then request once only.\n• Use the latest code you receive.\n\nIf every request still fails after waiting, tell me exactly where you are (signing in, signing up or elsewhere) so I can look into it.`),
        S('gen_authenticator_new_phone', 'account/2fa/move_to_new_phone', 'login',
            'غيّرت موبايلي وعايز أنقل تطبيق المصادقة', 'I changed phones and want to move my authenticator',
            'entity_new_phone:610 entity_2fa:390',
            `طول ما الموبايل القديم لسه معاك، النقل سهل:\n• Google Authenticator: من الموبايل القديم ← القائمة ← «نقل الحسابات» ← «تصدير»، وامسح الكود اللي هيظهر من الجديد.\n• أو من حسابك وانت داخل: وقّف التحقق بخطوتين، وفعّله تاني من الموبايل الجديد.\n\nمتمسحش التطبيق من القديم قبل ما تتأكد إن الجديد بيطلّع أكواد شغالة. ولو القديم مش معاك خلاص، ادخل بواحد من رموز الاستعادة.`,
            `As long as you still have the old phone, moving is easy:\n• Google Authenticator: on the old phone ▸ menu ▸ "Transfer accounts" ▸ "Export", and scan the code shown with the new phone.\n• Or, while signed in: turn two-step verification off, then turn it on again from the new phone.\n\nDon't delete the app from the old phone until the new one produces working codes. If you no longer have the old phone, sign in with one of your recovery codes.`,
            { alt: ['entity_new_phone:810 entity_otp:190'] }),
        S('gen_signup_email_not_me', 'account/security/signup_not_me', 'security',
            'جالي إيميل تسجيل حساب وأنا ماعملتش حساب', 'I got a sign-up e-mail but did not create an account',
            'entity_not_me:3 entity_email:3 entity_signup:2',
            `غالبًا حد كتب إيميلك بالغلط وهو بيسجّل.\n• متدوسش على أي لينك في الإيميل ده.\n• لو مش ناوي تستخدم الحساب، سيبه — ولو عايز نقفله، قولّي وأنا أفتح طلب للفريق.`,
            `Most likely someone typed your e-mail by mistake while signing up.\n• Don't click any link in that e-mail.\n• If you don't intend to use the account, leave it — and if you'd like it closed, tell me and I'll open a request for the team.`),
        S('gen_reset_email_not_requested', 'account/security/reset_not_requested', 'security',
            'جالي إيميل تغيير كلمة المرور وأنا ماطلبتش', 'I got a password reset e-mail I did not request',
            'entity_not_requested:3 entity_password:2 entity_email:3',
            `كلمة المرور بتاعتك ماتغيرتش. الإيميل ده بيتبعت لما حد يطلب «نسيت كلمة المرور» بإيميلك، واللينك مابيعملش حاجة لو ماحدش ضغط عليه.\n• متدوسش على اللينك، وامسح الإيميل.\n• لو اتكرر كتير أو حاسس إن حد بيحاول يدخل: غيّر كلمة المرور من جوه حسابك، وفعّل التحقق بخطوتين.`,
            `Your password hasn't changed. This e-mail is sent when someone requests "Forgot password" with your address, and the link does nothing unless it's clicked.\n• Don't click the link; delete the e-mail.\n• If it keeps happening or you think someone is trying to get in: change your password from inside your account and turn on two-step verification.`),
        S('gen_mobile_capitalizes_first_letter', 'device/keyboard/auto_capitalize', 'login',
            'الموبايل بيكتب أول حرف كابيتال في الإيميل أو الباسورد', 'My phone capitalizes the first letter of my e-mail or password',
            'entity_capital_letter:5 entity_email:1 entity_password:1',
            `الإيميل مش بيفرق بين الحروف الكبيرة والصغيرة، فأول حرف كابيتال فيه مش مشكلة. لكن كلمة المرور بتفرق — لو الموبايل بيكبّر أول حرف فيها، الدخول هيترفض:\n• اكتب كلمة المرور، ودوس على «عرض كلمة المرور» (رمز العين) وبصّ على أول حرف قبل ما تدخل.\n• ولو الكيبورد بيصحّح الكلام لوحده، قفّل التصحيح التلقائي مؤقتًا من إعدادات الكيبورد.`,
            `E-mail addresses ignore capital letters, so a capital first letter there is no problem. Passwords don't — if the phone capitalizes the first letter, sign-in is refused:\n• Type the password, tap "show password" (the eye icon) and check the first letter before signing in.\n• If the keyboard corrects words on its own, turn autocorrect off for a moment in the keyboard settings.`),
        S('gen_password_shared_by_mistake', 'account/security/password_shared', 'security',
            'بعت كلمة المرور لحد بالغلط', 'I sent my password to someone by mistake',
            'entity_shared_with_someone:743 entity_password:256',
            `غيّرها دلوقتي — دي أهم خطوة:\n• من إعدادات حسابك غيّر كلمة المرور لواحدة جديدة مااستخدمتهاش قبل كده.\n• بعدها سجّل خروج من كل الأجهزة، عشان أي حد دخل بيها يطلع.\n• فعّل التحقق بخطوتين: حتى لو حد عرف كلمة المرور بعد كده، مش هيقدر يدخل من غير الكود.\n\nولو نفس كلمة المرور مستخدمة في مواقع تانية، غيّرها هناك كمان.`,
            `Change it now — that's the most important step:\n• From your account settings, change the password to a new one you haven't used before.\n• Then sign out of all devices, so anyone who got in with it is signed out.\n• Turn on two-step verification: even if someone learns the password later, they can't get in without the code.\n\nIf you use the same password on other sites, change it there too.`),
        S('gen_strong_password_how', 'account/security/strong_password_how', 'security',
            'أعمل كلمة مرور قوية إزاي', 'How do I make a strong password',
            'entity_strong_password:5 intent_how_to:1',
            `أسهل طريقة لكلمة مرور قوية وسهلة تفتكرها:\n• ٣–٤ كلمات مالهمش علاقة ببعض، ومعاهم رقم ورمز.\n• كل ما كانت أطول كانت أقوى — ١٢ حرف أو أكتر.\n• متستخدمهاش في أي موقع تاني، ومتحطش فيها اسمك أو رقم موبايلك أو تاريخ ميلادك.\n• لو ده جهازك، سيب مدير كلمات المرور في المتصفح يحفظها.`,
            `The easiest way to a strong password you can remember:\n• 3–4 unrelated words, plus a number and a symbol.\n• Longer is stronger — 12 characters or more.\n• Don't reuse it on any other site, and don't put your name, phone number or birthday in it.\n• If this is your own device, let the browser's password manager save it.`,
            { alt: ['entity_strength_word:557 entity_password:256 intent_how_to:186'] })
    ]
};
