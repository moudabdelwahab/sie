/**
 * Pro · تفعيل الحساب، المحادثة الفورية، مركز المساعدة، وصفحات عامة.
 *
 * Facts (Mad3oom pages, read directly):
 *  - account-gate.html: new accounts can sit on a waitlist ("حسابك في قائمة
 *    الانتظار"); a phone number is REQUIRED to activate; the same number
 *    cannot be registered on more than one account; an optional separate
 *    WhatsApp number; "تفعيل بكود المرور" activates with a passcode;
 *  - invoice.html: a public page on mad3oom.com that verifies an invoice
 *    and shows its total;
 *  - chat-end.html: "تم إنهاء المحادثة" with a quality rating
 *    (سيء جداً … ممتاز);
 *  - knowledge-base.html / help-center.js: categories, search, most read,
 *    related articles, 👍/👎 per article;
 *  - developers.html: API · MCP · OAuth 2.1; payment.html: the payment gateway;
 *  - comparison.html: "لماذا WhatsApp Cloud API؟" — the WhatsApp service is
 *    built on Meta's Cloud API.
 *
 * @no-legitimate-corpus
 */
import { S, T } from '../dsl.mjs';

export default {
    tokens: [
        T('entity_waitlist', 'قائمة الانتظار', 'waitlist', ['قائمة الانتظار', 'قايمة الانتظار', 'قايمه الانتظار', 'ويت ليست', 'waitlist']),
        T('entity_passcode', 'كود المرور', 'passcode', ['كود المرور', 'كود مرور', 'passcode']),
        T('symptom_already_registered', 'متسجل على حساب تاني', 'already registered', ['متسجل قبل كده', 'مستخدم قبل كده', 'متسجل على حساب تاني', 'already registered', 'already used']),
        T('entity_invoice_verify', 'التحقق من صحة الفاتورة', 'invoice verification', ['اتاكد انها صحيحة', 'مزورة', 'مزوره']),
        T('entity_chat_ended', 'إنهاء المحادثة', 'chat ended', ['انهيت', 'انهيتها', 'قفلت', 'اتقفلت مني', 'ended']),
        T('entity_live_word', 'الفورية', 'live', ['الفورية', 'الفوريه', 'لايف شات', 'live']),
        T('entity_article', 'مقال في مركز المساعدة', 'help article', ['مقال', 'المقالات', 'مقاله', 'مقالة', 'article', 'articles']),
        T('entity_not_found_word', 'مالقيتش', "didn't find", ['مالقيتش', 'مالاقيتش', 'ملقتش', 'مفيش مقال']),
        T('entity_useful_vote', 'مفيد أو مش مفيد', 'helpful vote', ['مفيد', 'مش مفيد', 'مفيده', 'helpful', 'not helpful']),
        T('entity_oauth', 'OAuth', 'OAuth', ['oauth', 'اوث', 'o auth']),
        T('entity_gateway_word', 'بوابة', 'gateway', ['بوابة', 'بوابه', 'gateway']),
        T('entity_official_word', 'رسمي', 'official', ['الرسمي', 'رسمي', 'cloud', 'كلاود', 'official', 'الرسميه', 'رسميه', 'الرسمية'])
    ],
    scenarios: [
        S('account_waitlist', 'account/activation/waitlist', 'login',
            'حسابي في قائمة الانتظار', 'My account is on the waitlist',
            'entity_waitlist:4 entity_account:1',
            `«حسابك في قائمة الانتظار» معناها إن التسجيل اتم، والحساب مستني تفعيل. عشان التفعيل يمشي:\n• كمّل رقم هاتفك في نفس الصفحة لو مطلوب — الرقم شرط للتفعيل.\n• لو معاك «كود مرور»، اختار «تفعيل بكود المرور» والحساب بيتفعّل على طول.\n\nلو كمّلت الرقم ومفيش كود وطوّل الانتظار، قولّي وأفتحلك تذكرة.`,
            `"Your account is on the waitlist" means registration went through and the account is waiting for activation. To move it along:\n• add your phone number on the same page if asked — it's required for activation;\n• if you have a "passcode", choose "Activate with passcode" and the account activates immediately.\n\nIf you've added the number, have no passcode, and it's taking long, tell me and I'll open a ticket.`),
        S('account_activate_with_passcode', 'account/activation/passcode', 'login',
            'تفعيل الحساب بكود المرور', 'Activating the account with a passcode',
            'entity_passcode:4',
            `لو معاك كود مرور من فريق مدعوم أو من شريك، اختار «لديك كود مرور؟ تفعيل بكود المرور» في صفحة تفعيل الحساب واكتبه، والحساب بيتفعّل ويحوّلك للوحة على طول.\n\nلو الكود اترفض، اتأكد إنك كتبته زي ما هو من غير مسافات، ولو لسه، قولّي وأفتحلك تذكرة.`,
            `If you have a passcode from the Mad3oom team or a partner, choose "Have a passcode? Activate with passcode" on the account activation page and enter it; the account activates and takes you to your dashboard.\n\nIf it's rejected, make sure you typed it exactly with no spaces; if it still fails, tell me and I'll open a ticket.`),
        S('account_phone_already_registered', 'account/phone_number/already_registered', 'login',
            'رقم الهاتف متسجل على حساب تاني', 'The phone number is registered on another account',
            'symptom_already_registered:3 entity_phone_number:3 entity_wrong_account:1',
            `رقم الهاتف مايتسجلش على أكتر من حساب. لو الرسالة ظهرتلك:\n• غالبًا عندك حساب قديم بنفس الرقم — جرّب تدخل بيه، أو استخدم «نسيت كلمة المرور».\n• لو الرقم ده جديد عليك وكان مع حد قبلك، قولّي وأفتحلك تذكرة عشان الفريق يراجع الحساب القديم.\n\nوخد بالك إن خانة رقم الواتساب منفصلة واختيارية — رقم الهاتف هو المطلوب.`,
            `A phone number can't be registered on more than one account. If you see that message:\n• you probably have an older account with that number — try signing into it, or use "Forgot password";\n• if the number is new to you and belonged to someone else before, tell me and I'll open a ticket for the team to review the old account.\n\nNote the WhatsApp number field is separate and optional — the phone number is the required one.`),
        S('invoice_verify_authenticity', 'billing/invoice/verify_authenticity', 'subscription',
            'أتأكد إن الفاتورة دي حقيقية إزاي', 'How to verify an invoice is genuine',
            'entity_invoice_verify:610 entity_invoice:390',
            `فواتير المنصة ليها صفحة «التحقق من صحة الفاتورة» على mad3oom.com، بتعرض بيانات الفاتورة الأصلية والإجمالي من النظام نفسه.\n\nقارن اللي في الصفحة باللي معاك. لو مختلفين، أو الرابط على دومين تاني، متدفعش حاجة وابعتلي صورة الفاتورة وأنا أفتح تذكرة للفريق المالي.`,
            `Platform invoices have a "Verify invoice" page on mad3oom.com that shows the original invoice details and total from the system itself.\n\nCompare it with what you have. If they differ, or the link is on another domain, don't pay anything — send me the invoice and I'll open a ticket for the finance team.`),
        S('livechat_ended_restart', 'chat/live_chat/restart_after_end', 'other',
            'قفلت المحادثة الفورية بالغلط', 'I ended the live chat by mistake',
            'entity_chat_ended:510 entity_chat_widget:490',
            `مفيش مشكلة — افتح «المحادثة الفورية» من القائمة الجانبية تاني وابدأ محادثة جديدة.\n\nلو كنت في نص موضوع، ابدأ رسالتك بملخص قصير للي اتقال عشان اللي هيرد يكمل من غير ما يسألك من الأول. ولو الموضوع محتاج متابعة أطول، التذكرة أنسب.`,
            `No problem — open "Live chat" from the sidebar again and start a new conversation.\n\nIf you were mid-topic, start with a short summary of what was said so whoever answers can continue without starting over. If it needs longer follow-up, a ticket suits it better.`),
        S('livechat_rate_quality', 'chat/live_chat/rating', 'inquiry',
            'تقييم المحادثة الفورية بعد إنهائها', 'Rating the live chat after it ends',
            'entity_rate_service:256 entity_chat_widget:446 entity_live_word:297',
            `بعد ما تنهي المحادثة بتظهر صفحة «تم إنهاء المحادثة» بسؤال «كيف كانت جودة الخدمة؟» من «سيء جداً» لـ«ممتاز».\n\nالتقييم اختياري بس بيوصل للفريق فعلًا. ولو فيه حاجة محددة ضايقتك في المحادثة، قولهالي هنا وأنا أوصلها.`,
            `When you end a chat, the "Conversation ended" page asks "How was the quality of service?" from "Very bad" to "Excellent".\n\nRating is optional but does reach the team. If something specific bothered you in the chat, tell me here and I'll pass it on.`),
        S('livechat_vs_ticket', 'support/channel_choice/chat_vs_ticket', 'inquiry',
            'أستخدم المحادثة الفورية ولا أفتح تذكرة؟', 'Live chat or a ticket?',
            'entity_live_word:2 entity_chat_widget:2 entity_ticket:2',
            `• المحادثة الفورية: لسؤال سريع أو حاجة بتتحل في نفس القعدة.\n• التذكرة: لمشكلة محتاجة متابعة أو فريق تقني أو مرفقات — كل حاجة بتتسجل برقم، وبتتابع حالتها من «تذاكري».\n\nلو بدأت في المحادثة واتضح إن الموضوع أكبر، اطلب تحويله لتذكرة.`,
            `• Live chat: for a quick question or something solved in one sitting.\n• Ticket: for a problem needing follow-up, the technical team or attachments — everything is recorded with a number and you follow its status in "My tickets".\n\nIf a chat turns out bigger than expected, ask for it to become a ticket.`,
            { alt: ['entity_live_word:516 entity_ticket:344 atom_open_action:139'] }),
        S('helpcenter_no_article_found', 'kb/article/not_found', 'inquiry',
            'مالقيتش مقال بيجاوب سؤالي', "I couldn't find an article for my question",
            'entity_not_found_word:3 entity_article:3',
            `جرّب البحث بكلمة واحدة مميزة بدل جملة (مثلًا «الفاتورة» بدل «ازاي اجيب الفاتورة بتاعتي»)، وبص في «مقالات ذات صلة» تحت أقرب مقال.\n\nولو مفيش فعلًا مقال، اسألني هنا — ولو الإجابة محتاجة الفريق أفتحلك تذكرة. وتقييم المقالات بـ 👍 / 👎 بيساعد الفريق يعرف المواضيع الناقصة.`,
            `Search with one distinctive word rather than a sentence (e.g. "invoice" instead of "how do I get my invoice"), and check "Related articles" under the closest one.\n\nIf there really is no article, ask me here — if the answer needs the team, I'll open a ticket. Rating articles 👍 / 👎 also helps the team see which topics are missing.`),
        S('helpcenter_rate_article', 'kb/article/rating', 'inquiry',
            'تقييم المقال (مفيد / مش مفيد)', 'Rating an article (helpful / not helpful)',
            'entity_useful_vote:3 entity_article:1',
            `كل مقال في مركز المساعدة تحته 👍 / 👎. تقييمك بيوصل للفريق وبيحدد المقالات اللي محتاجة تتحسن أو تتكتب من جديد.\n\nولو المقال ماحلّش مشكلتك، اسألني هنا بعد التقييم وأنا أكمّل معاك.`,
            `Every help-center article has 👍 / 👎 underneath. Your rating reaches the team and flags articles that need improving or rewriting.\n\nIf the article didn't solve your problem, ask me here after rating and I'll take it from there.`),
        S('developers_oauth', 'api/oauth/what_is', 'api',
            'الـ OAuth في مدعوم لإيه', 'What OAuth is for in Mad3oom',
            'entity_oauth:4',
            `صفحة «توثيق المطورين» فيها تلات طرق للربط: مفاتيح الـ API، والـ MCP، وOAuth 2.1.\n\nالـ OAuth مناسب لما تطبيق تاني محتاج يتصرف بإذن المستخدم نفسه من غير ما ياخد كلمة المرور بتاعته — بيطلب موافقة وبياخد صلاحية محددة ممكن تتلغى. لو بتربط نظامك الداخلي بس، مفتاح API أبسط.`,
            `The "Developers" documentation covers three ways to integrate: API keys, MCP and OAuth 2.1.\n\nOAuth fits when another application needs to act with a user's permission without taking their password — it asks for consent and receives a limited, revocable permission. For connecting only your own internal system, an API key is simpler.`),
        S('payment_gateway_page_error', 'billing/payment_gateway/not_opening', 'subscription',
            'بوابة الدفع مش بتفتح', "The payment gateway page won't open",
            'entity_gateway_word:338 entity_payment:323 symptom_blank_page:338',
            `لو صفحة بوابة الدفع مش بتفتح أو واقفة:\n• جرّب متصفح تاني أو وضع التصفح الخفي — إضافات منع الإعلانات أحيانًا بتوقفها.\n• اتأكد إن مفيش VPN شغال.\n• ماتدفعش مرتين: لو مش متأكد إن العملية الأولى اتمت، استنى وراجع حسابك البنكي.\n\nولو لسه مش بتفتح، الوسائل التانية متاحة: تحويل بنكي أو محفظة كاش أو إنستاباي بإثبات تحويل.`,
            `If the payment gateway page won't open or hangs:\n• try another browser or a private window — ad blockers sometimes stop it;\n• make sure no VPN is on;\n• don't pay twice: if unsure whether the first attempt went through, wait and check your bank account.\n\nIf it still won't open, other methods are available: bank transfer, cash wallet or InstaPay with proof of transfer.`,
            { alt: ['entity_gateway_word:338 entity_payment:323 symptom_not_working:338'] }),
        S('whatsapp_cloud_api_vs_app', 'whatsapp/cloud_api/compare_app', 'inquiry',
            'الفرق بين WhatsApp Cloud API والواتساب العادي', 'WhatsApp Cloud API vs the regular app',
            'entity_official_word:139 entity_whatsapp:265 intent_compare:331 entity_api:265',
            `خدمة الواتساب في مدعوم مبنية على WhatsApp Cloud API الرسمي من ميتا، والفرق عن الواتساب العادي:\n• أكتر من موظف يردوا من نفس الرقم في نفس الوقت.\n• الرسايل اللي بتبدأها إنت بره نافذة الـ ٢٤ ساعة لازم تكون بقالب معتمد.\n• الرقم المربوط بالـ API مابيشتغلش في نفس الوقت على تطبيق الواتساب العادي.\n\nلو محتاج تعرف تفاصيل الباقات، صفحة مقارنة حلول الواتساب بتوضحها.`,
            `Mad3oom's WhatsApp service is built on Meta's official WhatsApp Cloud API. Compared with the regular app:\n• several agents can reply from the same number at once;\n• messages you initiate outside the 24-hour window must use an approved template;\n• a number connected to the API can't be used at the same time in the regular WhatsApp app.\n\nThe WhatsApp solutions comparison page explains the plans in detail.`)
    ]
};
