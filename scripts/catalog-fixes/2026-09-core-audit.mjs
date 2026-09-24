/**
 * 2026-09-core-audit.mjs
 * ------------------------------------------------------------
 * The changeset produced by auditing the 650 shipped (Free) scenarios.
 * Kept as a script rather than a hand-edited JSON diff so every change is
 * named, justified, and re-runnable: `node scripts/catalog-fixes/2026-09-core-audit.mjs`
 * applied to the pre-audit files produces the committed files exactly, and
 * applied twice changes nothing (each step checks before it acts).
 *
 * Three kinds of change, and nothing else:
 *
 *   1. MERGES — pairs that are the same case to a customer. Found by the
 *      intent-key inventory (scripts/data/core-intents.tsv), confirmed by
 *      reading both answers. The survivor keeps its own signature and takes
 *      the removed scenario's signature as an ALTERNATIVE (see
 *      scenarioSignatures in scenario-types.js), so on every message it scores
 *      exactly max(old survivor, old removed): no wording that reached either
 *      stops reaching the case, and the glossary is not touched. Removed ids
 *      are recorded in aliases.json so stored sessions and traces resolve.
 *
 *   2. SIGNATURE FIXES — a scenario keyed on the wrong token.
 *
 *   3. FACT CORRECTIONS — answers that state behaviour the platform's own
 *      code contradicts. Every one is traced to a line in Mad3oom's
 *      docs/KNOWLEDGE_BASE_AUDIT_AR.md evidence matrix (itself traced to
 *      source). Claims that are merely UNVERIFIED are listed in the report,
 *      not rewritten: replacing one guess with another is not a fix.
 *
 * @no-legitimate-corpus — contains replacement answer text, not customer messages.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const CATALOG = path.join(ROOT, 'sie/scenarios/scenario-catalog.data/scenarios.json');
const ALIASES = path.join(ROOT, 'sie/scenarios/scenario-catalog.data/aliases.json');
const INTENTS = path.join(ROOT, 'scripts/data/core-intents.tsv');

const catalogFile = JSON.parse(fs.readFileSync(CATALOG, 'utf8'));
const scenarios = catalogFile.scenarios;
const byId = () => new Map(scenarios.map((s) => [s.id, s]));
const log = [];

const sig = (pairs) => pairs.map(([token, weight]) => ({ token, weight, source: 'text' }));

// ------------------------------------------------------------
// 1. Merges: removed -> survivor, with the survivor's new signature where
//    it needs one to absorb the removed scenario's vocabulary.
// ------------------------------------------------------------
const MERGES = [
    { remove: 'convo_trial_extension_request', into: 'billing_trial_extension_request',
      why: 'Same request ("extend my trial"); both open a ticket.' },
    { remove: 'report_scheduled_delivery_new', into: 'report_scheduled_delivery',
      why: 'Same request; the "_new" copy was added without noticing the first.' },
    { remove: 'infra_data_location', into: 'compliance_data_residency',
      why: 'Same question ("where is my data stored"); both open a ticket.' },
    { remove: 'scale_attachment_too_big', into: 'ticket_attachment_too_large',
      why: 'Same complaint, with contradictory limits in the two answers (see the fact correction below).' },
    { remove: 'convo_seasonal_rush', into: 'ops_seasonal_capacity',
      why: 'Same primary token (social_seasonal_rush) and the same advice at two lengths.' },
    { remove: 'everything_broken_urgent', into: 'platform_wide_outage',
      why: 'Same case ("everything is down"); both open a ticket.' },
    { remove: 'bot_flow_testing', into: 'bot_test_mode',
      why: 'Same question ("test the bot before publishing"); one answered, one only opened a ticket.' },
    { remove: 'api_test_credentials', into: 'api_sandbox_request',
      why: 'Same request (a test environment / credentials for the API), same primary token.' },
    { remove: 'convo_asks_shorter_answer', into: 'convo_answer_too_long',
      why: 'Same request ("shorter, please").' },
    { remove: 'convo_sent_by_mistake', into: 'convo_wrong_message',
      why: 'Same case (message sent by mistake).' },
    { remove: 'convo_apologizes_after_anger', into: 'convo_angry_calming_down',
      why: 'Same case (customer apologises for earlier anger).' },
    { remove: 'wa_number_suspended_by_meta', into: 'whatsapp_number_banned',
      why: 'Same event: a banned WhatsApp number is a number suspended by Meta. Both open a ticket.' },
    { remove: 'convo_short_ok', into: 'convo_neutral_acknowledgement',
      why: 'Identical answers to a bare "ok".' },
    { remove: 'wa_emoji_arabic_garbled', into: 'data_import_encoding',
      why: 'Same cause and same fix (file not saved as UTF-8). The survivor only opened a ticket; it now carries the answer.',
      takeResolutionFromRemoved: true },
    { remove: 'team_remove_agent_data', into: 'team_offboarding_agent',
      why: 'Same situation with CONTRADICTORY answers (one said open tickets move to unassigned automatically, the other that they are left without an owner). The survivor keeps the safe ordering (reassign, then disable).' }
];

// ------------------------------------------------------------
// 3. Fact corrections. Each cites the evidence row it follows.
// ------------------------------------------------------------
const answer = (ar, en) => ({ hasAutoResolution: true, text: { ar, en } });
const CORRECTIONS = {
    // Mad3oom assets/js/account/account-core.js: «لا يوجد تحقق برمز للهاتف حتى
    // الآن» and «رمز الدخول عبر تيليجرام — غير متاح حاليًا». No SMS code exists;
    // the only codes are the authenticator app's (2FA) and e-mailed LINKS.
    login_otp_not_received: answer(
        'المنصة مابتبعتش أكواد على الموبايل (SMS) خالص، فخلّينا نحدد الكود ده جاي منين:\n• كود التحقق بخطوتين: مش بيتبعت — بيظهر في تطبيق المصادقة على موبايلك (زي Google Authenticator) وبيتغيّر كل شوية.\n• تأكيد الإيميل أو تغيير كلمة المرور: ده لينك مش كود، بيوصل على الإيميل — بصّ في الـ Spam والـ Promotions، واستنى دقيقة قبل ما تطلب واحد جديد.\n• كود تليجرام للدخول: الميزة دي لسه مش مكتملة ومش مطلوبة عند الدخول.\n\nقولّي الشاشة اللي بتطلب الكود مكتوب فيها إيه، وأنا أكمل معاك.',
        'The platform doesn\'t send codes to your phone (SMS) at all, so let\'s pin down where this code comes from:\n• Two-step verification code: it isn\'t sent — it appears in the authenticator app on your phone (such as Google Authenticator) and changes every few seconds.\n• E-mail confirmation or password change: that\'s a LINK, not a code, sent by e-mail — check Spam and Promotions, and wait a minute before requesting another.\n• Telegram sign-in code: that feature isn\'t complete yet and isn\'t required at sign-in.\n\nTell me what the screen asking for the code says and I\'ll take it from there.'),
    // account-core.js: PNG / JPG / WEBP, at most 2 MB. No minimum dimensions in the code.
    ui_profile_picture_not_uploading: answer(
        'متطلبات الصورة: PNG أو JPG أو WEBP، ومايزيدش حجمها عن ٢ ميجا.\n\nلو الرفع بيفشل رغم كده:\n• جرّب تفتح الصورة وتحفظها من جديد — الملفات المحمّلة من واتساب أحيانًا بتبقى بامتداد غلط.\n• لو الصورة من آيفون بصيغة HEIC، حوّلها لـ JPG الأول.\n• جرّب من متصفح تاني.',
        'Image requirements: PNG, JPG or WEBP, no larger than 2 MB.\n\nIf uploading still fails:\n• Open the image and save it again — files downloaded from WhatsApp sometimes carry the wrong extension.\n• If it\'s an iPhone HEIC image, convert it to JPG first.\n• Try another browser.'),
    // account-core.js: 8+ characters with an upper-case letter, a lower-case
    // letter and a digit; account-settings.js: changing it ends other sessions.
    howto_change_password: answer(
        'تغيير كلمة المرور وانت داخل على حسابك:\n١. افتح إعدادات الحساب ← حماية الحساب.\n٢. اكتب كلمة المرور الحالية، وبعدين الجديدة مرتين.\n٣. اضغط «تحديث كلمة المرور».\n\nالجديدة لازم تكون ٨ حروف على الأقل وفيها حرف كبير وحرف صغير ورقم، ومختلفة عن الحالية. بعد التغيير بيتم تسجيل خروجك من باقي الأجهزة تلقائيًا — ده مقصود لحمايتك.',
        'Changing your password while signed in:\n1. Open Account settings → Account protection.\n2. Enter your current password, then the new one twice.\n3. Press "Update password".\n\nThe new one must be at least 8 characters with an upper-case letter, a lower-case letter and a digit, and different from the current one. Afterwards you\'re signed out of your other devices automatically — that\'s intentional, for your protection.'),
    // The 30-minute figure has no source in the platform's code; the one
    // lockout with a stated duration is two-step verification (15 minutes).
    login_account_locked: answer(
        'بعد كذا محاولة دخول غلط ورا بعض، الدخول بيتوقف مؤقتًا كإجراء حماية.\n\nاستنى شوية قبل المحاولة الجاية، وبدل التخمين استخدم «نسيت كلمة المرور» من صفحة الدخول. ولو الحساب لسه مش بيفتح أو محتاج تدخل حالًا، قولّي وأصعّد الموضوع لفريق الدعم.',
        'After several wrong sign-in attempts in a row, sign-in is paused as a protection measure.\n\nWait a little before the next attempt, and instead of guessing use "Forgot password" on the sign-in page. If the account still won\'t open, or you need in now, tell me and I\'ll escalate it to the support team.'),
    // company-api.js: a customer can STOP / re-activate a key; there is no delete.
    api_key_rotation: answer(
        'تدوير المفتاح من غير انقطاع:\n١. أنشئ مفتاح جديد بنفس الصلاحيات (القديم بيفضل شغال).\n٢. حدّث أنظمتك تستخدم الجديد.\n٣. راقب «آخر النداءات» وتأكد إن مفيش حاجة لسه بتستخدم القديم.\n٤. أوقف المفتاح القديم من القائمة (زرار «إيقاف») — الإيقاف بيسري على الخادم على طول.\n\nالترتيب ده مهم — لو أوقفت القديم الأول هيحصل انقطاع. ونصيحة: دوّر المفاتيح كل ٩٠ يوم، وفورًا لو حد من الفريق ساب الشغل.',
        'Rotating a key without downtime:\n1. Create a new key with the same scopes (the old one keeps working).\n2. Update your systems to use the new one.\n3. Watch "Recent calls" and make sure nothing still uses the old one.\n4. Stop the old key from the list ("Stop") — it takes effect on the server at once.\n\nThe order matters — stopping the old one first causes downtime. Tip: rotate keys every 90 days, and immediately if someone leaves the team.'),
    // KB audit §3: "لا مسار عميل للتخفيض ولا لإلغاء اشتراك فعّال" (whatsapp-subscription-service.js knows new/renew/upgrade only).
    subscription_cancel_request: answer(
        'إلغاء الاشتراك مش متاح كزرار في حسابك — بيتم عن طريق فريق الدعم عشان يراجع معاك المدة المدفوعة ومصير البيانات.\n\nقولّي «افتح تذكرة» وأنا أبعت طلب الإلغاء للفريق بالتفاصيل. ولو فيه حاجة معيّنة مضايقاك في الخدمة، قولهالي — يمكن نحلها بدل ما تلغي [[icon:smile]]',
        'Cancelling is not a button in your account — the support team handles it, so they can go over the paid period and what happens to your data with you.\n\nSay "open a ticket" and I will send the cancellation request to the team with the details. And if something specific is bothering you, tell me — we may be able to fix it instead.'),
    // KB audit: upgrade is a REQUEST (new / renew / upgrade), paid by one of the
    // four methods and reviewed; "instant" and "prorated" have no source.
    subscription_upgrade_request: answer(
        'الترقية بتتطلب من «الباقات والاشتراك»: اختار الباقة الأكبر واطلب الترقية، وبعدين ادفع بالوسيلة اللي تناسبك.\n\nلو الدفع بتحويل بنكي أو محفظة كاش أو إنستاباي، لازم ترفع إثبات التحويل مع الطلب، والطلب بيتراجع يدويًا — وبيفتح تذكرة تتابع منها. ولو مش متأكد أنهي باقة تناسبك، قولّي بتستخدم إيه أكتر وأنا أرشحلك.',
        'Upgrades are requested from "Plans & subscription": pick the larger plan, request the upgrade, then pay with the method that suits you.\n\nFor bank transfer, cash wallet or InstaPay you must upload proof of transfer with the request, which is reviewed manually — it opens a ticket you can follow. If you are not sure which plan fits, tell me what you use most and I will suggest one.'),
    // Mad3oom company-dashboard/index.html:261-299 + company-dashboard.js:onCreateMember:
    // a member is ADDED by the company admin with name, e-mail, password and
    // confirmation — there is no e-mail invitation — and company-model.js
    // COMPANY_ROLE_LABELS has exactly two roles.
    howto_add_agent: answer(
        'إضافة عضو لفريقك بتتم من «لوحة الشركة» ← الأعضاء ← إضافة مستخدم:\n١. اكتب اسمه وإيميله.\n٢. حط كلمة مرور وأكّدها — مفيش دعوة بالإيميل، فابعتله بيانات الدخول بنفسك.\n٣. اختار دوره: «مدير الشركة» أو «عضو في الشركة».\n\nالإضافة متاحة لمدير الشركة بس. وبعد أول دخول، الأفضل العضو يغيّر كلمة المرور من الأمان.',
        'Adding a team member is done from the "Company dashboard" → Members → Add user:\n1. Enter their name and e-mail.\n2. Set a password and confirm it — there is no e-mail invitation, so share the sign-in details yourself.\n3. Choose their role: "Company admin" or "Company member".\n\nOnly a company admin can add members. After the first sign-in, the member should change the password under Security.'),
    team_role_permissions_unclear: answer(
        'في لوحة الشركة فيه دورين بس:\n• «مدير الشركة»: بيدير الأعضاء (إضافة وإزالة) وبيعدّل بيانات الشركة، وبيدير مفاتيح الـ API لو باقتك فيها الميزة دي.\n• «عضو في الشركة»: بيستخدم اللوحة — التذاكر والتقارير ونشاطه — من غير إدارة الأعضاء.\n\nالقاعدة العملية: خلي عدد المديرين أقل ما يمكن.',
        'The company dashboard has two roles only:\n• "Company admin": manages members (add/remove), edits the company details, and manages API keys if your plan includes that feature.\n• "Company member": uses the dashboard — tickets, reports, their own activity — without managing members.\n\nRule of thumb: keep the number of admins as small as possible.'),
    team_invite_not_received: answer(
        'إضافة الأعضاء على المنصة مش بتبعت إيميل دعوة أصلًا: مدير الشركة بيضيف العضو بإيميله وكلمة مرور بيحددها بنفسه.\n\nيعني العضو يدخل بالإيميل وكلمة المرور اللي المدير حطها — والمدير يبعتهاله بأي وسيلة آمنة. ولو محدش فاكر كلمة المرور، العضو يستخدم «نسيت كلمة المرور» من صفحة الدخول.',
        'Adding members doesn\'t send an invitation e-mail at all: the company admin adds the member with their e-mail and a password they set themselves.\n\nSo the member signs in with that e-mail and the password the admin chose — shared by the admin through a secure channel. If nobody remembers the password, the member uses "Forgot password" on the sign-in page.'),
    // KB audit evidence matrix: the customer's API path is Company dashboard → API,
    // key creation needs the api_tokens entitlement, and the limit is 60 calls/min;
    // api-management.html is an ADMIN page.
    howto_use_api: answer(
        'للبدء مع الـ API:\n١. من «لوحة الشركة» ← الـ API، اضغط «إنشاء مفتاح» — الزرار متاح لو باقتك فيها ميزة مفاتيح الـ API.\n٢. احفظ المفتاح في مكان آمن وابعته في هيدر Authorization مع كل طلب.\n٣. الحد ٦٠ نداء في الدقيقة للمفتاح.\n\nالتوثيق وأمثلة الطلبات في صفحة «المطورين». لو عندك سؤال عن endpoint معيّن، اسألني.',
        'To start with the API:\n1. From the "Company dashboard" → API, press "Create key" — available if your plan includes the API keys feature.\n2. Store the key safely and send it in the Authorization header with every request.\n3. The limit is 60 calls per minute per key.\n\nDocumentation and request examples are on the "Developers" page. Ask me about any specific endpoint.'),
    // Mad3oom request-subdomain.html: the customer requests <name>.mad3oom.com —
    // English lowercase letters, digits and hyphens, availability check, then
    // «قيد المراجعة» → «تمت الموافقة» / «مرفوض». The DNS record is created by the
    // platform team (subdomains/create-subdomain.html); the customer sets none.
    howto_setup_subdomain: answer(
        'النطاق الفرعي بيبقى على شكل اسمك.mad3oom.com، وبتطلبه من صفحة «طلب نطاق فرعي»:\n١. اكتب الاسم بالإنجليزي: حروف صغيرة وأرقام وشرطة (-)، من غير شرطة في الأول أو الآخر.\n٢. اضغط «التحقق من توافر الاسم»، ولو متاح ابعت الطلب.\n٣. الطلب بيبقى «قيد المراجعة»، وبعد الموافقة الفريق بيجهّز النطاق وبياخد وقت بسيط لحد ما يشتغل.\n\nمش محتاج تضيف أي سجلات DNS بنفسك.',
        'A subdomain takes the form yourname.mad3oom.com, requested from the "Request a subdomain" page:\n1. Enter the name in English: lowercase letters, digits and hyphens, with no hyphen at the start or end.\n2. Press "Check availability", and if it is free, submit the request.\n3. The request shows "Under review"; after approval the team sets it up, and it takes a short while to go live.\n\nYou do not need to add any DNS records yourself.'),
    dns_subdomain_issue: answer(
        'لو نطاقك الفرعي (اسمك.mad3oom.com) مش شغال:\n• اتأكد إن حالة الطلب «تمت الموافقة» — لو لسه «قيد المراجعة» فهو لسه ماتجهزش.\n• بعد الموافقة بياخد وقت لحد ما النطاق ينتشر ويشتغل عند الكل.\n• جرّب تفتحه من شبكة تانية (بيانات الموبايل) عشان تستبعد الكاش عندك.\n\nلو الموافقة عدّى عليها يوم كامل والنطاق لسه مش بيفتح، قولّي وأفتحلك تذكرة.',
        'If your subdomain (yourname.mad3oom.com) isn\'t working:\n• Check that the request is "Approved" — if it is still "Under review", it hasn\'t been set up yet.\n• After approval it takes a while to propagate and work everywhere.\n• Try opening it from another network (mobile data) to rule out your local cache.\n\nIf a full day has passed since approval and it still doesn\'t open, tell me and I\'ll open a ticket.'),
    // KB audit: WhatsApp balance is read-only in the dashboard ("تواصل مع الدعم للشحن");
    // the low-balance alert is raised by the account-health panel against a
    // threshold set for the account, not a customer setting.
    wa_wallet_insufficient: answer(
        'لما رصيد الواتساب يخلص، الإرسال بيتوقف لحد ما الرصيد يتشحن.\n\nالشحن مش متاح من لوحتك مباشرة — الرصيد هناك للعرض بس (مع آخر ٥ حركات). اطلب الشحن من فريق الدعم: قولّي «افتح تذكرة شحن رصيد» وأنا أبعتها. وبتوصلك في «حالة حسابك» تنبيهات لما الرصيد ينزل تحت الحد الأدنى المحدد لحسابك.',
        'When the WhatsApp balance runs out, sending stops until it is topped up.\n\nTop-ups are not available from your dashboard — the balance there is read-only (with the last 5 transactions). Ask the support team to top up: say "open a top-up ticket" and I will send it. Your account-health panel also alerts you when the balance drops below the minimum set for your account.'),
    billing_downgrade_request: answer(
        'النزول لباقة أقل مش متاح من حسابك مباشرة — المتاح من صفحة الاشتراكات هو الاشتراك الجديد والتجديد والترقية بس. التخفيض بيتم عن طريق فريق الدعم.\n\nقبل ما تطلبه، خد بالك: لو عدد المستخدمين أو الأرقام المربوطة عندك أكبر من حد الباقة الأقل، هتحتاج تقلّلهم. قولّي «افتح تذكرة» وأنا أبعت الطلب للفريق.',
        'Moving to a smaller plan is not available from your account — the Subscriptions page offers new subscriptions, renewals and upgrades only. Downgrades go through the support team.\n\nBefore asking, note: if you have more users or linked numbers than the smaller plan allows, you will need to reduce them. Say "open a ticket" and I will send the request to the team.'),
    // KB audit §3: PAYMENT_METHODS = bank transfer / cash wallet / InstaPay / internal gateway; proof mandatory.
    billing_change_payment_method: answer(
        'وسيلة الدفع بتختارها مع كل عملية دفع أو تجديد، مش بتتخزن في الحساب. الوسائل المتاحة: تحويل بنكي، محفظة كاش، إنستاباي، أو بوابة الدفع الداخلية.\n\nلو هتدفع بتحويل أو محفظة أو إنستاباي، لازم ترفع إثبات التحويل (صورة أو PDF لحد ٨ ميجا) مع الطلب — من غيره الطلب مابيكملش.',
        'You choose the payment method with each payment or renewal; it is not stored on the account. Available methods: bank transfer, cash wallet, InstaPay, or the internal payment gateway.\n\nFor a transfer, wallet or InstaPay payment you must upload proof of transfer (an image or PDF up to 8MB) with the request — without it the request cannot complete.'),
    subscription_payment_rejected: answer(
        'لو الدفع اترفض، راجع حسب الوسيلة اللي استخدمتها:\n• بوابة الدفع: اتأكد إن الكارت مفعّل عليه الشراء أونلاين وإن الرصيد كافي.\n• تحويل بنكي أو محفظة كاش أو إنستاباي: الطلب مابيكملش من غير إثبات التحويل (صورة أو PDF لحد ٨ ميجا) — اتأكد إنه اترفع وإنه واضح.\n\nلو كل ده مظبوط والدفع لسه مرفوض، قولّي وأصعّدها للفريق المالي.',
        'If a payment was rejected, check according to the method you used:\n• Payment gateway: make sure the card allows online purchases and has enough balance.\n• Bank transfer, cash wallet or InstaPay: the request does not complete without proof of transfer (an image or PDF up to 8MB) — make sure it was uploaded and is legible.\n\nIf all of that is right and it is still rejected, tell me and I will escalate it to the finance team.'),
    // The retry schedule ("3 attempts over 7 days", "3 then 7 then 14 days") has no source anywhere in either repository.
    billing_auto_renewal_failed: answer(
        'لو التجديد مااتمّش، غالبًا الدفع نفسه اللي ماكملش — مثلًا إثبات تحويل ماترفعش، أو كارت مرفوض على بوابة الدفع.\n\nجدّد من صفحة «الاشتراكات» بالوسيلة اللي تناسبك، ولو دفعت فعلًا والتجديد مش ظاهر، ابعتلي إثبات الدفع وأنا أفتح تذكرة للفريق المالي.',
        'If a renewal did not go through, it is usually the payment itself that did not complete — for example, proof of transfer was not uploaded, or a card was declined on the payment gateway.\n\nRenew from the "Subscriptions" page with the method that suits you. If you already paid and the renewal is not showing, send me the proof of payment and I will open a ticket for the finance team.'),
    billing_dunning_window: answer(
        'لو الدفع فشل، أسرع حل إنك تجدّد تاني من صفحة «الاشتراكات» بوسيلة دفع تانية، وترفع إثبات التحويل لو دفعت بتحويل أو محفظة أو إنستاباي.\n\nالمدة اللي الخدمة بتفضل شغالة فيها بعد فشل الدفع بيحددها فريق الدعم حسب حالة حسابك — لو قلقان إنها تقف، قولّي وأفتحلك تذكرة عشان يأكدولك [[icon:note]]',
        'If a payment failed, the quickest fix is to renew again from the "Subscriptions" page with another method, uploading proof of transfer if you pay by transfer, wallet or InstaPay.\n\nHow long service continues after a failed payment is decided by the support team for your account — if you are worried it will stop, tell me and I will open a ticket so they can confirm.'),
    // "90 days" retention: no source in either repository.
    billing_data_after_cancel: answer(
        'بياناتك مش بتتمسح لحظة الإلغاء، لكن مدة الاحتفاظ بيها بيأكدها فريق الدعم وقت تنفيذ الإلغاء — فاسألهم عنها في نفس التذكرة.\n\nوقبل أي حاجة، صدّر اللي يهمك: التقارير في لوحة الشركة بتتصدّر CSV وXLSX وPDF — ده بياخد دقايق وبيفضل عندك مهما حصل.',
        'Your data is not deleted the moment you cancel, but the retention period is confirmed by the support team when the cancellation is processed — ask them in the same ticket.\n\nBefore anything else, export what matters: reports in the company dashboard export to CSV, XLSX and PDF. It takes minutes and stays with you whatever happens.'),
    convo_hesitant_worried_about_commitment: answer(
        'سؤال في محله [[icon:note]] الاشتراك شهري أو سنوي، وبتجدده بنفسك من صفحة «الاشتراكات». أي تغيير زي الإلغاء أو النزول لباقة أقل بيتم عن طريق فريق الدعم، وبيراجعوا معاك المدة المدفوعة قبل أي حاجة.\n\nلو حابب تجرّب الأول قبل ما تلتزم، اسألني عن الفترة التجريبية.',
        'A fair question. Plans are monthly or yearly and you renew them yourself from the "Subscriptions" page. Changes such as cancelling or moving to a smaller plan go through the support team, who review the paid period with you first.\n\nIf you would like to try before committing, ask me about the trial.'),
    // KB audit evidence matrix: "المرفقات: 5 ملفات × 5MB، صور/PDF/txt/log/csv" and "لا رفع مرفقات مع الرد في واجهة العميل".
    ticket_attachment_too_large: answer(
        'حدود مرفقات التذكرة: لحد ٥ ملفات، كل ملف لحد ٥ ميجا، والأنواع المقبولة صور وPDF وملفات نصية (txt وlog وcsv).\n\nلو الملف أكبر:\n• الصور: صغّر الأبعاد أو احفظها JPG.\n• السجلات: قسّمها لأكتر من ملف أو خد الجزء اللي فيه الخطأ بس.\n• الفيديو: ارفعه على أي خدمة تخزين وحط الرابط في وصف التذكرة.\n\nخد بالك إن المرفقات بتترفع مع فتح التذكرة، مش مع الرد عليها.',
        'Ticket attachment limits: up to 5 files, each up to 5MB; accepted types are images, PDF and text files (txt, log, csv).\n\nIf a file is bigger:\n• Images: reduce the dimensions or save as JPG.\n• Logs: split them, or include only the part with the error.\n• Video: upload it to any storage service and put the link in the ticket description.\n\nNote that attachments are added when opening a ticket, not when replying to one.'),
    // KB audit §3: "ساعات دعم ثابتة 9ص–6م — Not Found، الساعات من إعدادات الإدارة".
    convo_checking_availability: answer(
        'أنا متاح معاك ٢٤ ساعة طول الأسبوع [[icon:smile]]\n\nمواعيد فريق الدعم البشري بيحددها الفريق نفسه وبتظهرلك في لوحتك في قسم «توفّر فريق الدعم» (متاح الآن / خارج ساعات العمل). وبرّه المواعيد تقدر تفتح تذكرة في أي وقت، وبتتسجل فورًا.',
        'I am available 24/7.\n\nThe human team sets its own working hours, shown in your dashboard under "Support availability" (available now / outside working hours). Outside those hours you can open a ticket at any time and it is recorded immediately.'),
    // KB audit §3: webhooks are managed from admin/settings.html only; no customer UI.
    webhook_not_receiving: answer(
        'لو الـ Webhook مش بيستقبل أحداث، راجع عندك الأول:\n• الـ endpoint لازم يكون HTTPS بشهادة صالحة.\n• لازم يرد بـ 2xx بسرعة؛ الرد البطيء بيتحسب فشل.\n• اتأكد إن الـ firewall مش بيحجب الطلبات الواردة.\n\nإعداد الـ Webhooks وسجل محاولاتها بيتدار من فريق المنصة مش من حسابك — لو كل اللي فوق مظبوط، قولّي وأفتحلك تذكرة عشان يراجعوا السجل.',
        'If your webhook is not receiving events, check your side first:\n• The endpoint must be HTTPS with a valid certificate.\n• It must answer 2xx quickly; slow responses count as failures.\n• Make sure your firewall is not blocking incoming requests.\n\nWebhook configuration and its delivery log are managed by the platform team, not from your account — if everything above is fine, tell me and I will open a ticket so they can check the log.'),
    // KB audit §3: migration 034 removed trg_reopen_ticket_on_owner_reply — a reply no longer reopens.
    ticket_reopened_automatically: answer(
        'الرد على تذكرة مقفولة مابيعيدش فتحها تلقائيًا — الرد بيتسجل بس الحالة مابتتغيرش. التذكرة بتتفتح تاني بس لو حد ضغط «إعادة الفتح» على تذكرة حالتها «تم الحل»، وجوّه التذكرة هتلاقي عدّاد «أُعيد فتحها X مرة».\n\nلو شايفها بتتفتح من غير ما حد يضغط الزرار، ابعتلي رقمها وأنا أفتح تذكرة للفريق يراجع سجلها.',
        'Replying to a closed ticket does not reopen it — the reply is recorded but the status does not change. A ticket reopens only when someone presses "Reopen" on a ticket marked "Resolved", and inside the ticket you will see a "reopened X times" counter.\n\nIf you see it reopening without anyone pressing the button, send me its number and I will open a ticket for the team to check its history.'),
    // KB audit evidence matrix: views all/open/awaiting reply/closed; "إخفاء من قائمتي" has no undo in the customer UI.
    ticket_disappeared: answer(
        'التذاكر مابتتمسحش، لكنها ممكن تختفي من القائمة اللي قدامك:\n• لو اتقفلت: غيّر العرض لـ «مغلقة» أو «كل التذاكر».\n• لو اخترت «إخفاء من قائمتي»: دي مابيتلغيش من حسابك — قولّي رقم التذكرة وأنا أفتح طلب للفريق يرجّعها.\n\nلو مش فاكر الرقم، قولّي عنوانها التقريبي وتاريخها.',
        'Tickets are not deleted, but they can drop out of the list you are looking at:\n• If it was closed: switch the view to "Closed" or "All tickets".\n• If you chose "Hide from my list": that cannot be undone from your account — send me the ticket number and I will ask the team to restore it.\n\nIf you do not remember the number, give me its approximate title and date.'),
    // Mad3oom data-deletion.html (the page linked for data deletion): «send an
    // email to support@mad3oom.com. Include your account email and request
    // type. We will process within 30 days.» The previous answer promised an
    // export from the Reports page, a forfeited wallet and disconnected
    // numbers — none of which the product documents — and routed the request
    // through a chat ticket instead of the documented channel.
    ui_delete_account_request: answer(
        'حذف الحساب وبياناته بيتم بطلب مكتوب على الإيميل:\n١. ابعت على support@mad3oom.com من نفس الإيميل المسجّل بيه حسابك.\n٢. اكتب إنه طلب حذف بيانات، ونوع الطلب (الحساب كله أو بيانات معيّنة).\n\nالطلب بيتنفّذ خلال ٣٠ يوم. لو محتاج أي حاجة من بياناتك، احفظها عندك قبل ما تبعت الطلب.',
        'Account and data deletion is done by written request by e-mail:\n1. Write to support@mad3oom.com from the e-mail address your account is registered with.\n2. Say it is a data-deletion request, and which kind (the whole account or specific data).\n\nRequests are processed within 30 days. If you need anything from your data, keep a copy before sending the request.'),
    // KB audit: external payment requests open a ticket with a 1-hour first-response target; proof ≤ 8MB mandatory.
    billing_bank_transfer_pending: answer(
        'الدفع بتحويل بنكي أو محفظة كاش أو إنستاباي بيتراجع يدويًا: طلبك بيفتح تذكرة تلقائيًا، وهدف أول رد عليها ساعة واحدة.\n\nعشان المراجعة تمشي بسرعة، اتأكد إن إثبات التحويل (صورة أو PDF لحد ٨ ميجا) اترفع وإنه واضح فيه المبلغ والتاريخ. تقدر تتابع التذكرة من «تذاكري».',
        'Payments by bank transfer, cash wallet or InstaPay are reviewed manually: your request opens a ticket automatically, with a first-response target of one hour.\n\nTo keep the review quick, make sure the proof of transfer (an image or PDF up to 8MB) was uploaded and clearly shows the amount and date. You can follow the ticket from "My tickets".')
};

// ------------------------------------------------------------
// Apply.
// ------------------------------------------------------------
const aliases = fs.existsSync(ALIASES) ? JSON.parse(fs.readFileSync(ALIASES, 'utf8')) : { note: '', aliases: {} };

for (const m of MERGES) {
    const map = byId();
    const removed = map.get(m.remove);
    const survivor = map.get(m.into);
    if (!removed) continue; // already applied
    const alternatives = survivor.alternativeSignatures || [];
    for (const signature of [removed.evidenceSignature, ...(removed.alternativeSignatures || [])]) {
        const key = JSON.stringify(signature);
        if (JSON.stringify(survivor.evidenceSignature) !== key && !alternatives.some((a) => JSON.stringify(a) === key)) {
            alternatives.push(signature);
        }
    }
    survivor.alternativeSignatures = alternatives;
    if (m.takeResolutionFromRemoved) {
        survivor.resolution = removed.resolution;
        survivor.requiresTicketIfUnresolved = removed.requiresTicketIfUnresolved;
    }
    scenarios.splice(scenarios.indexOf(removed), 1);
    aliases.aliases[m.remove] = { into: m.into, why: m.why };
    log.push(`merge: ${m.remove} -> ${m.into}`);
}

for (const [id, resolution] of Object.entries(CORRECTIONS)) {
    const s = byId().get(id);
    if (!s) throw new Error(`correction target missing: ${id}`);
    if (JSON.stringify(s.resolution) !== JSON.stringify(resolution)) {
        s.resolution = { ...resolution, ...(s.resolution.knowledgeSource ? { knowledgeSource: s.resolution.knowledgeSource } : {}) };
        s.requiresTicketIfUnresolved = false;
        log.push(`fact correction: ${id}`);
    }
}

// convo_praise_for_arabic was keyed on behaviour_testing_bot — the TEST token.
// A bare "do you understand Arabic?" therefore tied with convo_testing_the_bot
// and the alphabetical tie-break answered it with "thanks for the compliment".
{
    const s = byId().get('convo_praise_for_arabic');
    const wanted = sig([['social_praise', 3], ['behaviour_testing_bot', 2], ['emotion_grateful', 1]]);
    if (JSON.stringify(s.evidenceSignature) !== JSON.stringify(wanted)) {
        s.evidenceSignature = wanted;
        log.push('signature: convo_praise_for_arabic keyed on praise, not on the testing token');
    }
}

// The catch-all: never promoted by the ranking specificity rule.
{
    const s = byId().get('unknown');
    if (s.catchAll !== true) { s.catchAll = true; log.push('flag: unknown is the catch-all'); }
}

// Intent keys: the inventory. Every scenario carries one; CI requires them unique.
{
    const intents = new Map(fs.readFileSync(INTENTS, 'utf8').trim().split('\n').map((l) => l.split('\t')));
    // Two keys change meaning with the merges above.
    intents.set('team_review_data', 'report/agent_review/advice');
    for (const s of scenarios) {
        const key = intents.get(s.id);
        if (!key) throw new Error(`no intent key for ${s.id}`);
        if (s.intent !== key) s.intent = key;
    }
}

aliases.note = 'Scenario ids removed by the 2026-09 audit, and the scenario that now handles the same case. Read by the comparator and available to anything resolving a stored scenario id.';
fs.writeFileSync(CATALOG, JSON.stringify(catalogFile, null, 2) + '\n');
fs.writeFileSync(ALIASES, JSON.stringify(aliases, null, 2) + '\n');
console.log(log.join('\n'));
console.log(`scenarios: ${scenarios.length}`);
