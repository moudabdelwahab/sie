/**
 * Pro · المساعد الذكي نفسه — questions customers ask ABOUT this assistant.
 *
 * Facts are this repository's own behaviour, cited where it lives:
 *  - quota: customer_sie_access (unlimited / quota / expiration);
 *    sie_consume_message() is spent per turn BEFORE interpretation, so a
 *    greeting counts; the Telegram link-code message does not
 *    (channel-identity.js LINK_REPLIES);
 *  - the account-health panel warns at quota use and at access expiry;
 *  - Telegram linking: request a code from the settings page, send it to
 *    the bot; invalid/expired -> request a new one (channel-identity.js);
 *  - tickets: the assistant asks before opening one; a "no" queues the
 *    conversation for human review (sie-review-queue.js); an open ticket on
 *    the same category is not duplicated; ticket creation can be switched
 *    off in settings (sie-chat-bridge.js TICKET_DISABLED_TEXT);
 *  - reply language follows the customer's language (response-language-policy.js).
 *
 * Deliberately absent: "forget me"/"what do you remember" — those are memory
 * instructions the interpretation stage handles before any scenario runs.
 *
 * @no-legitimate-corpus
 */
import { S, T } from '../dsl.mjs';

export default {
    tokens: [
        T('entity_assistant', 'المساعد الذكي', 'the smart assistant', ['المساعد الذكي', 'المحرك الذكي', 'المساعد', 'المحرك', 'sie']),
        T('entity_message_quota', 'حصة رسائل المساعد', 'assistant message quota', ['حصة الرسايل', 'حصه الرسايل', 'الحصة', 'الحصه', 'الكوتة', 'الكوته', 'رصيد الرسايل', 'quota']),
        T('entity_access_period', 'صلاحية الوصول', 'access period', ['صلاحية الوصول', 'صلاحيه الوصول', 'مدة الوصول']),
        T('entity_link_code', 'كود الربط', 'link code', ['كود الربط', 'كود ربط', 'link code']),
        T('intent_unlink', 'فك الربط', 'unlink', ['فك الربط', 'الغي الربط', 'افصل الربط', 'unlink', 'افك الربط', 'افك ربط']),
        T('symptom_no_reply', 'مش بيرد', 'not replying', ['مش بترد', 'مابتردش', 'مش بيرد', 'مابيردش', 'ساكت', 'not replying']),
        T('intent_declined_ticket', 'رفضت فتح تذكرة', 'declined a ticket', ['قلت لا', 'قولت لأ', 'مارضيتش افتح']),
        T('symptom_disabled', 'متوقف من الإعدادات', 'switched off in settings', ['متوقف', 'متوقفة', 'متوقفه', 'مقفول من الاعدادات', 'disabled']),
        T('entity_counts_toward', 'بتتحسب من الرصيد', 'counts toward', ['بتتحسب', 'بيتحسب', 'بتتخصم', 'بيتخصم', 'counts'])
    ],
    scenarios: [
        S('assistant_message_quota', 'assistant/quota/usage', 'inquiry',
            'حصة رسائل المساعد الذكي', 'The smart assistant message quota',
            'entity_message_quota:4 entity_assistant:1',
            `استخدامك للمساعد ممكن يكون بحصة رسائل محددة لحسابك. تشوف المستخدم منها في «الاستهلاك والحدود»، وبيوصلك تنبيه في «حالة حسابك» لما تقرب تخلص.\n\nلما الحصة تخلص، المساعد بيوقف ردوده الذكية وبيكمل معاك الدعم العادي — ولزيادة الحصة تواصل مع فريق الدعم.`,
            `Your use of the assistant may have a message quota set for your account. See how much is used under "Usage & limits", and the account-health panel alerts you when it's nearly used up.\n\nWhen it runs out, the assistant stops its smart replies and regular support continues — contact the support team to increase it.`),
        S('assistant_quota_what_counts', 'assistant/quota/what_counts', 'inquiry',
            'إيه اللي بيتحسب من رسائل المساعد', 'What counts toward the assistant quota',
            'entity_counts_toward:3 entity_message_quota:3',
            `كل رسالة بتبعتها للمساعد بتتحسب رسالة من الحصة — حتى التحية أو «شكرًا»، لأن الحساب بيحصل قبل ما المساعد يقرر نوع الرسالة.\n\nاللي مابيتحسبش: رسالة كود ربط تيليجرام. ونصيحة توفّر: ابعت مشكلتك في رسالة واحدة واضحة بدل كذا رسالة قصيرة.`,
            `Every message you send to the assistant counts as one from the quota — even a greeting or "thanks", because counting happens before the assistant decides what kind of message it is.\n\nWhat doesn't count: the Telegram link-code message. A saving tip: send your problem in one clear message rather than several short ones.`),
        S('assistant_access_expired', 'assistant/access/expired', 'inquiry',
            'صلاحية وصولي للمساعد الذكي انتهت', 'My access to the smart assistant expired',
            'entity_access_period:3 entity_assistant:2 symptom_expired:1',
            `بعض الحسابات بيكون وصولها للمساعد الذكي لمدة محددة، ولما المدة تخلص بيظهرلك في «حالة حسابك»: «انتهت صلاحية وصولك للمحرك الذكي».\n\nالتجديد بيتم عن طريق فريق الدعم — اضغط «تواصل مع الدعم» من نفس التنبيه. ولحد ما يتجدد، الدعم العادي شغال معاك.`,
            `Some accounts have assistant access for a fixed period; when it ends the account-health panel shows "Your access to the smart engine has expired".\n\nRenewal goes through the support team — press "Contact support" on that alert. Until then, regular support keeps working.`),
        S('assistant_link_telegram', 'assistant/telegram/how_to_link', 'inquiry',
            'أربط حسابي بالمساعد على تيليجرام إزاي', 'Link my account to the assistant on Telegram',
            'entity_link_code:470 entity_telegram:390 atom_link:139',
            `١. في مدعوم، افتح صفحة الإعدادات واطلب كود ربط تيليجرام.\n٢. افتح بوت مدعوم على تيليجرام وابعتله الكود كرسالة لوحده.\n٣. هيرد عليك «اتربط حسابك بنجاح» — وبعدها تسألني من تيليجرام على طول.\n\nالكود لمرة واحدة، ورسالة الكود نفسها مابتتحسبش من حصة الرسائل.`,
            `1. In Mad3oom, open the settings page and request a Telegram link code.\n2. Open the Mad3oom bot on Telegram and send it the code on its own.\n3. It replies "your account is linked" — then you can ask me from Telegram directly.\n\nThe code is single-use, and the code message doesn't count against your message quota.`,
            { alt: ['entity_assistant:407 entity_telegram:390 intent_how_to:203'] }),
        S('assistant_link_code_rejected', 'assistant/telegram/link_code_rejected', 'other',
            'كود ربط تيليجرام مش شغال', 'The Telegram link code is not working',
            'entity_link_code:4 symptom_rejected:1 entity_telegram:1',
            `لو البوت رد إن «الكود ده مش مظبوط أو انتهت صلاحيته»:\n• الكود لمرة واحدة وليه مدة — اطلب كود جديد من صفحة الإعدادات.\n• ابعته لوحده في رسالة، من غير مسافات أو كلام قبله.\n• اتأكد إنك بتبعته للبوت الصح.\n\nولو رد «حصلت مشكلة مؤقتة»، ده من عندنا — استنى دقيقة وجرّب تاني.`,
            `If the bot replies that "this code isn't right or has expired":\n• codes are single-use and time-limited — request a new one from the settings page;\n• send it alone in a message, with no spaces or text before it;\n• make sure you're sending it to the right bot.\n\nIf it replies "a temporary problem occurred", that's on our side — wait a minute and try again.`,
            { alt: ['entity_link_code:3 symptom_not_working:2 symptom_rejected:1', 'entity_link_code:4 symptom_expired:1 entity_telegram:1 symptom_rejected:1'] }),
        S('assistant_unlink_telegram', 'assistant/telegram/unlink', 'other',
            'عايز أفك ربط تيليجرام بحسابي', 'Unlink Telegram from my account',
            'intent_unlink:4 entity_telegram:2',
            `فك الربط بيتم عن طريق فريق الدعم، عشان يتأكدوا إن الطلب جاي من صاحب الحساب.\n\nقولّي «افتح تذكرة» وأنا أبعت الطلب. ولو السبب إن حد تاني ربط حسابك من غير علمك، غيّر كلمة المرور دلوقتي وقولّي ده في التذكرة.`,
            `Unlinking goes through the support team, so they can confirm the request comes from the account owner.\n\nSay "open a ticket" and I'll send the request. If the reason is that someone else linked your account without your knowledge, change your password now and mention it in the ticket.`),
        S('assistant_not_replying', 'assistant/availability/not_replying', 'other',
            'المساعد الذكي مش بيرد عليا', 'The smart assistant is not replying',
            'symptom_no_reply:3 entity_assistant:3',
            `لو المساعد مابيردش، الأسباب المعتادة:\n• حصة رسائل المساعد خلصت، أو صلاحية الوصول انتهت — هتلاقي تنبيه في «حالة حسابك».\n• على تيليجرام: الحساب لسه مش مربوط — ابعت كود الربط الأول.\n• المساعد متوقف مؤقتًا من إعدادات الفريق.\n\nفي كل الحالات الدعم العادي شغال: افتح تذكرة من «تذاكري».`,
            `If the assistant isn't replying, the usual reasons are:\n• the assistant message quota is used up, or access expired — you'll see an alert in the account-health panel;\n• on Telegram: the account isn't linked yet — send the link code first;\n• the assistant is temporarily switched off in the team's settings.\n\nIn every case regular support still works: open a ticket from "My tickets".`),
        S('assistant_opened_ticket_where', 'assistant/ticket/where_is_it', 'inquiry',
            'المساعد فتحلي تذكرة — ألاقيها فين', 'The assistant opened a ticket — where is it',
            'entity_assistant:360 atom_open_action:139 entity_ticket:360 atom_where:139',
            `التذكرة اللي المساعد بيفتحها بتتسجل على حسابك زي أي تذكرة، وتلاقيها في «تذاكري» — ورقمها كان في رسالة التأكيد.\n\nالتذكرة بيتكتب فيها ملخص التشخيص اللي اتكلمنا فيه، فالفريق مش هيسألك من الأول. أي تفاصيل جديدة، ضيفها كرد عليها.`,
            `A ticket the assistant opens is recorded on your account like any other; you'll find it in "My tickets" — its number was in the confirmation message.\n\nIt includes a summary of the diagnosis we went through, so the team won't start from scratch. Add any new details as a reply there.`,
            { alt: ['entity_assistant:430 atom_open_action:139 entity_ticket:430'] }),
        S('assistant_declined_ticket_what_next', 'assistant/ticket/declined_what_next', 'inquiry',
            'قلت لأ لفتح التذكرة — يحصل إيه؟', 'I declined the ticket — what happens now?',
            'intent_declined_ticket:4 entity_ticket:1',
            `ولا حاجة ضاعت: لما بترفض فتح التذكرة، المحادثة بتتسجل في مركز المراجعة عشان حد من الفريق يشوفها ويتواصل معاك لو احتاج.\n\nولو غيّرت رأيك، قولّي «افتح تذكرة» في أي وقت.`,
            `Nothing is lost: when you decline, the conversation is logged in the review center so someone on the team can look at it and reach you if needed.\n\nIf you change your mind, just say "open a ticket" at any time.`),
        S('assistant_open_ticket_exists_notice', 'assistant/ticket/already_open_notice', 'inquiry',
            'المساعد قال إن عندي تذكرة مفتوحة في نفس الموضوع', 'The assistant says I already have an open ticket on this',
            'entity_assistant:430 entity_ticket:430 atom_similar:139',
            `المساعد مابيفتحش تذكرة تانية لو عندك تذكرة مفتوحة في نفس التصنيف، عشان موضوعك مايتقسمش بين تذكرتين وكل واحدة تمشي لوحدها.\n\nكمّل على التذكرة المفتوحة: أي تفاصيل تقولها هنا أو تضيفها هناك بتوصل للفريق. ولو مشكلتك الجديدة مختلفة فعلًا، قولّي الفرق.`,
            `The assistant won't open a second ticket if you already have one open in the same category, so your issue isn't split across two tickets moving separately.\n\nContinue on the open one: details you give here or add there reach the team. If your new problem is actually different, tell me how.`),
        S('assistant_ticket_creation_disabled', 'assistant/ticket/creation_disabled', 'other',
            'المساعد قال إن فتح التذاكر متوقف', 'The assistant says ticket creation is switched off',
            'symptom_disabled:516 entity_ticket:344 atom_open_action:139',
            `ده معناه إن فتح التذاكر من خلال المساعد متوقف حاليًا من إعدادات الفريق — مش مشكلة في حسابك.\n\nتقدر تفتح التذكرة بنفسك من «تذاكري» ← تذكرة جديدة، أو تتواصل مع الفريق مباشرة من «توفّر فريق الدعم».`,
            `It means ticket creation through the assistant is currently switched off in the team's settings — not a problem with your account.\n\nYou can open the ticket yourself from "My tickets" → New ticket, or reach the team directly from "Support availability".`,
            { alt: ['entity_assistant:2 symptom_disabled:3 entity_ticket:2 atom_open_action:1'] }),
        S('assistant_where_available', 'assistant/channels/where', 'inquiry',
            'ألاقي المساعد الذكي فين', 'Where can I use the smart assistant',
            'entity_assistant:860 atom_where:139',
            `المساعد متاح في مكانين:\n• المحادثة على منصة مدعوم.\n• بوت مدعوم على تيليجرام، بعد ما تربط حسابك بكود الربط من الإعدادات.\n\nوفي الاتنين بيستخدم نفس حسابك ونفس حصة الرسائل.`,
            `The assistant is available in two places:\n• chat on the Mad3oom platform;\n• the Mad3oom bot on Telegram, after linking your account with the link code from settings.\n\nBoth use the same account and the same message quota.`),
        S('assistant_reply_in_english', 'assistant/language/english', 'inquiry',
            'ينفع أكلم المساعد بالإنجليزي؟', 'Can I talk to the assistant in English?',
            'entity_english_language:3 entity_assistant:3 intent_how_to:1',
            `أيوه — المساعد بيرد باللغة اللي بتكتب بيها. اكتب بالإنجليزي وهيرد بالإنجليزي، وارجع للعربي في أي وقت وهيرجع معاك.\n\nYes — the assistant replies in the language you write in. Write in English and it answers in English; switch back to Arabic whenever you like.`,
            `Yes — the assistant replies in the language you write in. Write in English and it answers in English; switch back to Arabic whenever you like.`)
    ]
};
