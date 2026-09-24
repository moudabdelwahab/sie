/**
 * Pro · بوابة شركتك، ملاحظات على الموظفين، وأخطاء الإرسال.
 *
 * Facts: create-subdomain.html (portal logo PNG/JPG/SVG, up to 2MB,
 * transparent background preferred); company dashboard "customer tickets"
 * stream; WhatsApp Cloud API — a delivered message cannot be recalled by the
 * business, and approved templates are per language (general Cloud API
 * behaviour, and the service is built on it per comparison.html).
 *
 * @no-legitimate-corpus
 */
import { S, T } from '../dsl.mjs';

export default {
    tokens: [
        T('entity_my_portal', 'بوابة الدعم الخاصة بشركتي', 'my company support portal', ['البوابة بتاعتي', 'البوابه بتاعتي', 'بوابتنا', 'بوابة الدعم بتاعتنا', 'our portal']),
        T('entity_my_customers', 'عملائي', 'my customers', ['عملائي', 'عملايي', 'عملاءنا', 'عملائنا', 'my customers']),
        T('entity_staff_complaint', 'شكوى في موظف دعم', 'complaint about a support agent', ['شكوى في موظف', 'شكوي في موظف', 'اسلوب', 'اتعامل معايا وحش', 'قليل الذوق']),
        T('intent_thank_agent', 'شكر موظف بعينه', 'thank a specific agent', ['اشكر', 'عايز اشكر', 'تشكر']),
        T('entity_formal_letter', 'رد رسمي مكتوب', 'formal written response', ['رد رسمي', 'خطاب رسمي', 'جواب رسمي', 'ورقة رسمية', 'official letter']),
        T('entity_template_language', 'لغة القالب', 'template language', ['لغة القالب', 'لغه القالب', 'القالب بالانجليزي', 'القالب بالعربي'])
    ],
    scenarios: [
        S('portal_logo_upload', 'widget/portal_branding/logo', 'other',
            'عايز أحط لوجو شركتي على بوابة الدعم', 'Put my company logo on the support portal',
            'entity_my_portal:3 entity_profile_picture:3',
            `لوجو بوابة الدعم الخاصة بنطاقك الفرعي بيتضاف من فريق المنصة. جهّز ملف:\n• PNG أو JPG أو SVG.\n• لحد ٢ ميجا.\n• والأفضل بخلفية شفافة عشان يبان كويس على أي لون.\n\nقولّي «افتح تذكرة» وارفع اللوجو فيها وأنا أبعت الطلب.`,
            `The logo on your subdomain's support portal is added by the platform team. Prepare a file that is:\n• PNG, JPG or SVG;\n• up to 2MB;\n• ideally with a transparent background so it looks right on any colour.\n\nSay "open a ticket" and attach the logo there, and I'll send the request.`,
            { alt: ['entity_logo:3 entity_my_portal:3', 'entity_profile_picture:3 entity_subdomain:3'] }),
        S('portal_customer_tickets_missing', 'ticket/company_streams/customer_tickets_missing', 'other',
            'تذاكر عملائي مش ظاهرة في لوحة الشركة', "My customers' tickets are not showing",
            'entity_my_customers:2 entity_ticket:2 symptom_not_visible:2',
            `تذاكر عملائك بتظهر في مسار «تذاكر العملاء» في لوحة الشركة (مش في «تذاكري»)، وده للعرض بس.\n\nلو المسار نفسه فاضي وعملاءك فاتحين تذاكر من بوابتك، ابعتلي رقم تذكرة واحدة من عندهم أو وقت فتحها وأنا أفتحلك تذكرة عشان الفريق يراجع الربط بين البوابة وشركتك.`,
            `Your customers' tickets appear in the "Customer tickets" stream in the company dashboard (not in "My tickets"), and it's view-only.\n\nIf that stream is empty while your customers are opening tickets from your portal, send me one of their ticket numbers or when it was opened and I'll open a ticket for the team to check the link between the portal and your company.`,
            { alt: ['entity_customer_tickets_stream:3 symptom_not_visible:3'] }),
        S('support_staff_complaint', 'support/staff_conduct/complaint', 'other',
            'عايز أشتكي من أسلوب موظف دعم', 'Complaint about a support agent\'s conduct',
            'entity_staff_complaint:4 atom_support:1',
            `آسف إن ده حصل، وده بيتاخد بجدية. عشان الشكوى توصل صح:\n• رقم التذكرة أو وقت المحادثة.\n• اللي حصل بالظبط، بكلامه لو تقدر.\n\nقولّي التفاصيل وأنا أفتح تذكرة شكوى بتروح للإدارة مش لنفس الموظف.`,
            `I'm sorry that happened, and it's taken seriously. For the complaint to land properly:\n• the ticket number or the time of the conversation;\n• exactly what happened, in their words if you can.\n\nGive me the details and I'll open a complaint ticket that goes to management, not to the same agent.`),
        S('support_thank_specific_agent', 'support/staff_conduct/praise_agent', 'inquiry',
            'عايز أشكر موظف دعم معيّن', 'I want to thank a specific support agent',
            'intent_thank_agent:3 entity_agent:3',
            `ده لطف منك [[icon:smile]] أسهل طريقة إن شكرك يوصل: اكتبه كرد على التذكرة اللي ساعدك فيها، وقيّم التذكرة لما تتقفل — التقييم بيوصل للفريق وبيتحسب للموظف.\n\nولو عايز، قولّي اسمه واللي عمله وأنا أوصل الشكر للإدارة.`,
            `That's kind of you. The easiest way for your thanks to land: write it as a reply on the ticket where they helped, and rate the ticket when it's closed — ratings reach the team and count for the agent.\n\nIf you like, tell me their name and what they did and I'll pass it to management.`),
        S('support_formal_written_response', 'support/formal_response/request', 'other',
            'محتاج رد رسمي مكتوب من الشركة', 'I need a formal written response',
            'entity_formal_letter:4',
            `الرد اللي في التذكرة نفسه رد مكتوب ومؤرّخ من فريق الدعم، وتقدر تستخدمه كمرجع.\n\nلو محتاج خطاب رسمي بصيغة معيّنة (لإدارتك أو لجهة حكومية مثلًا)، قولّي الغرض والصيغة المطلوبة وأنا أفتح تذكرة للفريق يجهّزه.`,
            `The reply in a ticket is itself a dated, written response from the support team, and you can use it as a reference.\n\nIf you need a formal letter in a specific format (for your management or an authority, say), tell me the purpose and required format and I'll open a ticket for the team to prepare it.`),
        S('campaign_sent_by_mistake', 'whatsapp/campaign/sent_by_mistake', 'whatsapp',
            'بعت حملة واتساب بالغلط', 'I sent a WhatsApp campaign by mistake',
            'entity_campaign:3 atom_by_mistake:3',
            `رسايل الواتساب اللي اتسلّمت مابتترجعش، فالتركيز على تقليل الأثر:\n١. لو الحملة لسه شغالة، أوقفها فورًا.\n٢. ابعت رسالة متابعة قصيرة للي وصلتهم: «الرسالة اللي فاتت اتبعتت بالغلط، نعتذر».\n٣. راجع لو فيه عملاء طلبوا إيقاف الرسايل، وسجّلهم.\n\nكتير من البلاغات بعد حملة غلط بيأثر على جودة الرقم، فالرسالة التوضيحية السريعة مهمة.`,
            `Delivered WhatsApp messages can't be recalled, so focus on limiting the impact:\n1. If the campaign is still running, stop it now.\n2. Send a short follow-up to recipients: "The previous message was sent in error, apologies."\n3. Check whether any customers asked to stop messages, and record them.\n\nMany reports after a mistaken campaign hurt the number's quality rating, so a quick clarifying message matters.`),
        S('wa_template_language_mismatch', 'whatsapp/template/language_mismatch', 'whatsapp',
            'القالب متعتمد بلغة وعايز أبعته بلغة تانية', 'Template approved in one language, needed in another',
            'entity_template_language:4 entity_whatsapp_template:1',
            `القالب المعتمد بيتعتمد لكل لغة لوحدها — القالب العربي مش بيتبعت بالإنجليزي تلقائيًا.\n\nقدّم نسخة من نفس القالب باللغة التانية (نفس الاسم، لغة مختلفة) وبتدخل مراجعة زي أي قالب جديد. ولحد ما تتعتمد، ابعت للعملاء دول بالنسخة المعتمدة.`,
            `Approved templates are approved per language — an Arabic template isn't sent in English automatically.\n\nSubmit a version of the same template in the other language (same name, different language); it goes through review like any new template. Until it's approved, use the approved version for those customers.`)
    ]
};
