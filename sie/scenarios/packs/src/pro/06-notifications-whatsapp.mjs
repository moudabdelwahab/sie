/**
 * Pro · الإشعارات والبريد وواتساب (الفجوات فقط).
 *
 * Facts: Mad3oom notification-router.js — ten categories (tickets,
 * subscriptions, balance & billing, WhatsApp, smart engine, security,
 * account, rewards, chat, system) and routing of a notification to its
 * ticket or dashboard section; send-ticket-email ALLOWED_SENDERS
 * (support@ / no-reply@ / info@). The WhatsApp entries state only general
 * WhatsApp behaviour (number format, delivery ticks, text formatting, link
 * previews) — the service's internals are outside both repositories, and
 * the core already has 56 WhatsApp scenarios.
 *
 * @no-legitimate-corpus
 */
import { S, T } from '../dsl.mjs';

export default {
    tokens: [
        T('entity_bell', 'جرس الإشعارات', 'notification bell', ['الجرس', 'العداد على الجرس', 'bell']),
        T('intent_mark_read', 'تعليم كمقروء', 'mark as read', ['كمقروء', 'مقروءة', 'مقروءه', 'علم الكل', 'mark as read', 'mark all read']),
        T('entity_notif_click', 'فتح الإشعار', 'opening a notification', ['بيوديني', 'الاشعار بيوديني', 'لما ادوس على الاشعار', 'بيفتح فين', 'when i click']),
        T('entity_notif_categories', 'تصنيفات الإشعارات', 'notification categories', ['تصنيفات', 'تصنيف الاشعار', 'categories']),
        T('atom_security', 'الأمان', 'security', ['الامان', 'امان', 'أمان', 'امني', 'أمني', 'security']),
        T('entity_sender_address', 'عنوان مرسل البريد', 'e-mail sender address', ['عنوان المرسل', 'من عنوان', 'noreply', 'no reply', 'sender address']),
        T('entity_phishing', 'رسالة احتيال', 'phishing', ['احتيال', 'مشبوه', 'مشبوهة', 'بيدعي انه منكم', 'phishing', 'scam']),
        T('entity_country_code', 'كود الدولة', 'country code', ['كود الدولة', 'كود الدوله', 'مفتاح الدولة', 'مفتاح الدوله', 'country code']),
        T('entity_delivery_ticks', 'علامات التسليم', 'delivery ticks', ['صحين', 'علامتين', 'الصح الازرق', 'صح رمادي', 'ticks', 'double tick', 'blue ticks']),
        T('entity_text_formatting', 'تنسيق النص', 'text formatting', ['خط عريض', 'بولد', 'مايل', 'تنسيق الرسالة', 'تنسيق', 'bold', 'italic']),
        T('entity_link_preview', 'معاينة الرابط', 'link preview', ['معاينة الرابط', 'معاينه الرابط', 'preview', 'link preview'])
    ],
    scenarios: [
        S('notif_bell_counter_stuck', 'notification/bell_counter/stuck', 'other',
            'عداد الجرس مش بيروح', 'The bell counter will not clear',
            'entity_bell:3 symptom_not_updating:2 entity_notification:1',
            `العداد على الجرس وفي القائمة الجانبية بيعدّ الإشعارات اللي لسه ماتعلمتش كمقروءة. افتح قائمة الإشعارات واعلّم الإشعار كمقروء، أو افتحه — وحدّث الصفحة.\n\nلو العداد فضل ثابت بعد كده، سجّل خروج ودخول تاني. ولو لسه، قولّي.`,
            `The counter on the bell and in the sidebar counts notifications not yet marked as read. Open the notifications list and mark them as read, or open them — then refresh the page.\n\nIf it stays stuck, sign out and back in. If it still does, tell me.`),
        S('notif_mark_all_read', 'notification/read_state/mark_all', 'inquiry',
            'أعلّم كل الإشعارات كمقروءة إزاي', 'How to mark all notifications as read',
            'intent_mark_read:4 entity_notification:1',
            `من قسم «الإشعارات» في القائمة الجانبية تقدر تعلّم الإشعارات كمقروءة، وفتح أي إشعار بيعلّمه مقروء لوحده.\n\nالإشعار المقروء مابيتمسحش — بيفضل في القائمة لو احتجت ترجعله.`,
            `From "Notifications" in the sidebar you can mark notifications as read, and opening one marks it as read automatically.\n\nRead notifications aren't deleted — they stay in the list in case you need them later.`),
        S('notif_click_destination', 'notification/routing/where_it_goes', 'inquiry',
            'لما أدوس على الإشعار بيوديني فين', 'Where a notification takes me',
            'entity_notif_click:4 entity_notification:1',
            `كل إشعار بيوديك لمكانه: إشعار عن تذكرة بيفتح التذكرة نفسها، وإشعار عن اشتراك أو رصيد أو أمان بيفتح القسم بتاعه في لوحتك.\n\nلو إشعار فتحلك صفحة مش مرتبطة بيه، ابعتلي عنوانه وأنا أبلّغ الفريق.`,
            `Each notification opens where it belongs: a ticket notification opens that ticket; subscription, balance or security notifications open their section of your dashboard.\n\nIf one opens an unrelated page, send me its title and I'll report it to the team.`),
        S('notif_categories_meaning', 'notification/categories/meaning', 'inquiry',
            'أنواع الإشعارات اللي بتوصلني', 'The kinds of notifications I get',
            'entity_notif_categories:3 entity_notification:3',
            `الإشعارات متقسمة لعشر تصنيفات: التذاكر، والاشتراكات، والرصيد والفوترة، وواتساب، والمحرك الذكي، والأمان، والحساب، والمكافآت، والمحادثة، والنظام.\n\nالتصنيف بيبان بلون وأيقونة جنب الإشعار، فتعرف أهميته من نظرة. إشعارات «الأمان» خصوصًا اقراها على طول.`,
            `Notifications fall into ten categories: tickets, subscriptions, balance & billing, WhatsApp, smart engine, security, account, rewards, chat and system.\n\nEach shows a colour and icon so you can gauge it at a glance. Read "Security" ones straight away.`),
        S('notif_security_alert', 'notification/security/what_to_do', 'login',
            'جالي إشعار أمان', 'I received a security notification',
            'atom_security:3 entity_notification:3',
            `إشعارات الأمان بتخص حاجة حساسة على حسابك. افتحه واقرا هو بيتكلم عن إيه:\n• لو عن حاجة إنت عملتها (زي تغيير كلمة المرور) — مفيش مطلوب منك.\n• لو عن حاجة ماعملتهاش: غيّر كلمة المرور فورًا، وفعّل التحقق بخطوتين، وقولّي أفتحلك تذكرة أمان.`,
            `Security notifications concern something sensitive on your account. Open it and see what it's about:\n• if it's something you did (like changing your password), nothing is needed;\n• if not: change your password now, turn on two-step verification, and tell me so I can open a security ticket.`),
        S('email_official_senders', 'email/sender/official_addresses', 'inquiry',
            'الإيميلات الرسمية بتيجي من أنهي عنوان', 'Which addresses official e-mails come from',
            'entity_sender_address:3 entity_email:3',
            `إيميلات المنصة الرسمية بتيجي من عناوين دعم مدعوم المعروفة: support@ وno-reply@ وinfo@ على دومين مدعوم.\n\nأي إيميل من عنوان تاني بيدّعي إنه مننا، متفتحش روابطه وابعته لنا في تذكرة. واحنا عمرنا ما هنطلب كلمة المرور بتاعتك في إيميل.`,
            `Official platform e-mails come from Mad3oom's known support addresses: support@, no-reply@ and info@ on the Mad3oom domain.\n\nIf an e-mail from any other address claims to be us, don't open its links — forward it to us in a ticket. We never ask for your password by e-mail.`),
        S('email_phishing_suspected', 'security/phishing/suspected', 'login',
            'وصلتني رسالة مشبوهة بتدّعي إنها منكم', 'A suspicious message claims to be from you',
            'entity_phishing:4',
            `متضغطش على أي رابط فيها ومتردش ببيانات. وعلشان تتأكد:\n• احنا مش بنطلب كلمة المرور أو كود التحقق أبدًا — لا بإيميل ولا واتساب.\n• الإيميلات الرسمية بتيجي من عناوين دعم مدعوم على دومين مدعوم.\n\nلو ضغطت على رابط أو كتبت بيانات، غيّر كلمة المرور فورًا وفعّل التحقق بخطوتين، وقولّي أفتح تذكرة أمان.`,
            `Don't click any of its links or reply with details. To be sure:\n• we never ask for your password or verification code — not by e-mail, not on WhatsApp;\n• official e-mails come from Mad3oom support addresses on the Mad3oom domain.\n\nIf you clicked a link or entered details, change your password now, turn on two-step verification, and tell me so I can open a security ticket.`),
        S('wa_number_country_code_format', 'whatsapp/number_format/country_code', 'whatsapp',
            'أكتب الرقم بكود الدولة إزاي', 'How to write a number with the country code',
            'entity_country_code:4 entity_whatsapp_number:1',
            `أرقام الواتساب لازم تتكتب بالصيغة الدولية: كود الدولة وبعده الرقم من غير الصفر الأولاني ومن غير + أو مسافات.\nمثال لرقم مصري 01012345678 ← 201012345678.\n\nالرقم المكتوب بصيغة محلية (بالصفر) أشهر سبب إن الرسالة ماتوصلش أو الرقم يطلع «غير موجود».`,
            `WhatsApp numbers must be in international format: the country code followed by the number without its leading zero, and without + or spaces.\nExample for an Egyptian number 01012345678 → 201012345678.\n\nA number written in local format (with the zero) is the most common reason a message doesn't arrive or the number shows as "not found".`),
        S('wa_delivery_ticks_meaning', 'whatsapp/delivery_ticks/meaning', 'whatsapp',
            'معنى علامات الصح على رسالة الواتساب', 'What the WhatsApp ticks mean',
            'entity_delivery_ticks:4 entity_whatsapp:1',
            `علامات الواتساب:\n• صح واحد رمادي: الرسالة اتبعتت من عندك ولسه ماوصلتش لموبايل العميل (غالبًا موبايله مقفول أو من غير نت).\n• صحين رمادي: وصلت لموبايله.\n• صحين أزرق: اتقرت — إلا لو العميل قافل «علامات القراءة»، ساعتها مش هتبقى زرقا أبدًا.`,
            `WhatsApp ticks:\n• One grey tick: sent from your side, not yet delivered to the customer's phone (usually off or offline).\n• Two grey ticks: delivered to their phone.\n• Two blue ticks: read — unless the customer has read receipts turned off, in which case they never turn blue.`),
        S('wa_text_formatting', 'whatsapp/text_formatting/how_to', 'whatsapp',
            'أكتب خط عريض أو مايل في رسالة الواتساب', 'Bold or italic text in a WhatsApp message',
            'entity_text_formatting:4 entity_whatsapp:1',
            `الواتساب بيدعم تنسيق بسيط بالعلامات حوالين الكلمة:\n• *كلمة* ← عريض.\n• _كلمة_ ← مايل.\n• ~كلمة~ ← مشطوب.\n\nمن غير مسافة بين العلامة والكلمة، وإلا التنسيق مابيطبقش.`,
            `WhatsApp supports simple formatting with symbols around a word:\n• *word* → bold.\n• _word_ → italic.\n• ~word~ → strikethrough.\n\nNo space between the symbol and the word, or it won't apply.`),
        S('wa_link_preview_missing', 'whatsapp/link_preview/missing', 'whatsapp',
            'الرابط في رسالة الواتساب من غير معاينة', 'A link in a WhatsApp message shows no preview',
            'entity_link_preview:4 entity_whatsapp:1',
            `معاينة الرابط (الصورة والعنوان) بتتعمل من بيانات الصفحة نفسها، ومش بتظهر في الحالات دي:\n• الصفحة مافيهاش صورة وعنوان معاينة (og:image وog:title).\n• الرابط مختصر أو بيحوّل أكتر من مرة.\n• الرابط مش في أول الرسالة أو ملزوق في كلام.\n\nالرسالة نفسها بتوصل عادي حتى من غير معاينة.`,
            `A link preview (image and title) is built from the page's own metadata, and won't show when:\n• the page has no preview image and title (og:image, og:title);\n• the link is shortened or redirects several times;\n• the link is glued to other text.\n\nThe message itself is delivered normally even without a preview.`),
        S('wa_change_connected_number', 'whatsapp/number/replace_connected', 'whatsapp',
            'عايز أغيّر رقم الواتساب المربوط برقم تاني', 'Replace the connected WhatsApp number',
            'atom_change:3 entity_whatsapp_number:3',
            `تغيير الرقم المربوط برقم تاني بيتم كفصل للرقم الحالي وربط الجديد — والمحادثات القديمة بتفضل مرتبطة بالرقم القديم، والقوالب المعتمدة ممكن تحتاج تتقدم تاني للرقم الجديد.\n\nعشان التغيير مايوقفش شغلك في النص، قولّي «افتح تذكرة» وأنا أبعت الطلب للفريق يرتب معاك التوقيت.`,
            `Replacing the connected number means disconnecting the current one and linking the new one — past conversations stay tied to the old number, and approved templates may need resubmitting for the new one.\n\nSo the change doesn't interrupt your work, say "open a ticket" and I'll send the request so the team can arrange the timing with you.`)
    ]
};
