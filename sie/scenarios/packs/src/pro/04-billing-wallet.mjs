/**
 * Pro · الدفع والرصيد والاشتراكات — the verified payment model.
 *
 * Facts (Mad3oom KB audit + whatsapp-subscription-service.js as cited there):
 *  - request types: new / renew / upgrade; PAYMENT_METHODS = bank transfer,
 *    cash wallet, InstaPay, internal payment gateway;
 *  - proof of transfer is mandatory for external payments: image or PDF,
 *    up to 8MB; if the proof upload fails, the request is rolled back
 *    (cancel_my_subscription_request) — it is not left half-submitted;
 *  - each request opens a ticket, first-response target one hour;
 *  - WhatsApp balance is read-only with the last 5 transactions, no self
 *    top-up; the low-balance alert uses a threshold set for the account;
 *  - company dashboard: subscription statuses, a "notes on the dates"
 *    panel for inconsistent dates, and "available services" derived from
 *    active subscriptions.
 *
 * @no-legitimate-corpus
 */
import { S, T } from '../dsl.mjs';

export default {
    tokens: [
        T('entity_transfer_proof', 'إثبات التحويل', 'proof of transfer', ['اثبات التحويل', 'ايصال التحويل', 'اثبات الدفع', 'اثبات', 'الاثبات', 'proof of transfer']),
        T('entity_file_size_mb', 'حجم الملف بالميجا', 'file size in MB', ['ميجا', 'ميجابايت', 'mb', 'حجم الاثبات', 'حجمه كبير']),
        T('intent_subscribe', 'اشتراك جديد', 'subscribe', ['اشترك', 'عايز اشترك', 'ازاي اشترك', 'subscribe']),
        T('entity_transactions', 'حركات الرصيد', 'balance transactions', ['الحركات', 'حركات الرصيد', 'المعاملات', 'transactions']),
        T('entity_date_notes', 'ملاحظات على التواريخ', 'notes on dates', ['ملاحظات على التواريخ', 'التواريخ', 'تاريخ الانتهاء', 'تاريخ البداية', 'dates']),
        T('entity_available_services', 'الخدمات المتاحة', 'available services', ['الخدمات المتاحة', 'الخدمات المتاحه', 'خدماتي', 'available services']),
        T('entity_low_balance', 'رصيد منخفض', 'low balance', ['رصيد منخفض', 'الرصيد قليل', 'نفد الرصيد', 'الرصيد نفد'])
    ],
    scenarios: [
        S('billing_upload_transfer_proof', 'billing/transfer_proof/how_to_upload', 'subscription',
            'أرفع إثبات التحويل إزاي', 'How to upload proof of transfer',
            'entity_transfer_proof:4 entity_payment:1 intent_how_to:1',
            `إثبات التحويل بيترفع مع طلب الاشتراك أو التجديد أو الترقية نفسه، لما تختار الدفع بتحويل بنكي أو محفظة كاش أو إنستاباي:\n• صورة أو PDF، لحد ٨ ميجا.\n• لازم يبان فيه المبلغ والتاريخ ورقم العملية.\n\nمن غير الإثبات الطلب مابيكملش. وبعد الإرسال الطلب بيفتح تذكرة تتابع منها المراجعة.`,
            `Proof of transfer is uploaded with the subscription, renewal or upgrade request itself, when you choose bank transfer, cash wallet or InstaPay:\n• an image or PDF, up to 8MB;\n• it must show the amount, date and transaction number.\n\nWithout it the request can't complete. Once sent, the request opens a ticket where you can follow the review.`),
        S('billing_transfer_proof_too_large', 'billing/transfer_proof/too_large', 'subscription',
            'ملف إثبات التحويل كبير ومش راضي يترفع', 'Proof-of-transfer file too large',
            'entity_transfer_proof:3 entity_file_size_mb:2 symptom_limit_reached:1',
            `الحد الأقصى لملف الإثبات ٨ ميجا. لو أكبر:\n• صوّر الإيصال screenshot بدل صورة الكاميرا — أصغر بكتير.\n• أو احفظه PDF من تطبيق البنك.\n• أو صغّر الصورة من الموبايل (مشاركة ← حجم متوسط).\n\nالمهم إن المبلغ والتاريخ ورقم العملية يفضلوا مقروءين.`,
            `The proof file can be at most 8MB. If it's larger:\n• take a screenshot of the receipt instead of a camera photo — much smaller;\n• or save it as PDF from your banking app;\n• or resize the image on your phone (Share → medium size).\n\nThe amount, date and transaction number must stay readable.`,
            { alt: ['entity_transfer_proof:3 entity_too_big:3'] }),
        S('billing_transfer_proof_rejected', 'billing/transfer_proof/rejected', 'subscription',
            'إثبات التحويل اترفض', 'My proof of transfer was rejected',
            'entity_transfer_proof:3 symptom_rejected:3',
            `غالبًا الإثبات اترفض لسبب من دول: الصورة مش واضحة، أو المبلغ مش مطابق للباقة، أو التاريخ/رقم العملية مش ظاهرين.\n\nافتح التذكرة اللي اتفتحت مع الطلب — السبب بيكون مكتوب هناك — وارفع إثبات أوضح أو اكتب رقم العملية كرد. لو السبب مش مكتوب، قولّي وأنا أسأل الفريق المالي.`,
            `A proof is usually rejected because the image is unclear, the amount doesn't match the plan, or the date/transaction number isn't visible.\n\nOpen the ticket created with the request — the reason is normally there — and send a clearer proof or the transaction number as a reply. If no reason is given, tell me and I'll ask the finance team.`),
        S('billing_request_rolled_back_upload_failed', 'billing/subscription_request/rolled_back', 'subscription',
            'طلب الاشتراك اتلغى لوحده', 'My subscription request cancelled itself',
            'atom_cancel:2 atom_by_itself:2 entity_subscription:2',
            `ده بيحصل لما رفع إثبات التحويل يفشل أثناء الإرسال: الطلب بيتلغى تلقائيًا بدل ما يفضل ناقص من غير إثبات. ماحدش اتخصم منه حاجة بسبب الإلغاء ده.\n\nابدأ الطلب تاني من «الباقات والاشتراك»، واتأكد إن ملف الإثبات صورة أو PDF أقل من ٨ ميجا والنت مستقر وقت الرفع.`,
            `This happens when uploading the proof of transfer fails during submission: the request is cancelled automatically rather than left incomplete without proof. Nothing is charged because of that cancellation.\n\nStart the request again from "Plans & subscription", and make sure the proof is an image or PDF under 8MB and your connection is stable while uploading.`),
        S('billing_subscribe_whatsapp_service', 'subscription/whatsapp_service/subscribe', 'subscription',
            'عايز أشترك في خدمة الواتساب', 'Subscribe to the WhatsApp service',
            'intent_subscribe:3 entity_whatsapp:3',
            `الاشتراك في واتساب بيتطلب من «الباقات والاشتراك»:\n١. اختار باقة واتساب (أو الباقة الشاملة لو محتاج الدعم الفني كمان).\n٢. اختار وسيلة الدفع، وارفع إثبات التحويل لو تحويل أو محفظة أو إنستاباي.\n٣. الطلب بيفتح تذكرة، وبعد المراجعة عنصر «واتساب» بيظهر في القائمة الجانبية.`,
            `WhatsApp is requested from "Plans & subscription":\n1. Choose a WhatsApp plan (or the all-in-one plan if you also need support tools).\n2. Choose a payment method, uploading proof for transfer, wallet or InstaPay.\n3. The request opens a ticket, and after review the "WhatsApp" item appears in your sidebar.`),
        S('billing_whatsapp_topup_how', 'wallet/whatsapp_balance/how_to_topup', 'subscription',
            'أشحن رصيد الواتساب إزاي', 'How to top up the WhatsApp balance',
            'atom_topup:3 atom_balance:1 entity_whatsapp:2',
            `شحن رصيد الواتساب بيتم عن طريق فريق الدعم — مفيش زرار شحن ذاتي في اللوحة، والرصيد هناك للعرض بس.\n\nقولّي المبلغ اللي عايز تشحنه ووسيلة الدفع، وأنا أفتحلك تذكرة شحن للفريق. ولو هتحوّل، جهّز إثبات التحويل.`,
            `WhatsApp balance top-ups go through the support team — there's no self top-up button; the balance in the dashboard is read-only.\n\nTell me the amount and payment method and I'll open a top-up ticket for the team. If you'll pay by transfer, have the proof ready.`),
        S('billing_whatsapp_low_balance_alert', 'wallet/whatsapp_balance/low_alert', 'subscription',
            'تنبيه «رصيد الواتساب منخفض»', '"WhatsApp balance low" alert',
            'entity_low_balance:4 entity_whatsapp:1',
            `التنبيه ده بيظهر في «حالة حسابك» لما الرصيد ينزل تحت الحد الأدنى المحدد لحسابك، ولو وصل صفر بيتحول لـ«نفد رصيد الواتساب».\n\nاطلب الشحن بدري عن طريق الدعم (الشحن مش ذاتي)، عشان الإرسال مايقفش في نص حملة.`,
            `This alert appears in your account-health panel when the balance drops below the minimum set for your account; at zero it becomes "WhatsApp balance used up".\n\nRequest a top-up early through support (top-ups aren't self-serve) so sending doesn't stop mid-campaign.`,
            { alt: ['atom_balance:3 entity_whatsapp:1 entity_notification:2'] }),
        S('billing_whatsapp_transactions', 'wallet/whatsapp_balance/transactions', 'inquiry',
            'أشوف حركات رصيد الواتساب فين', 'Where to see WhatsApp balance transactions',
            'entity_transactions:3 atom_balance:2 entity_whatsapp:1',
            `في «الاستهلاك والحدود» هتلاقي رصيد الواتساب الحالي وآخر ٥ حركات عليه (شحن أو خصم).\n\nلو محتاج كشف أطول من كده، أو فيه حركة مش مفهومة، قولّي تاريخها التقريبي وأنا أفتحلك تذكرة للفريق المالي.`,
            `Under "Usage & limits" you'll find the current WhatsApp balance and its last 5 transactions (top-ups or deductions).\n\nIf you need a longer statement, or a transaction isn't clear, give me its approximate date and I'll open a ticket for the finance team.`),
        S('billing_subscription_dates_notes', 'subscription/dates/inconsistent', 'subscription',
            'مكتوب «ملاحظات على التواريخ» في الاشتراك', '"Notes on the dates" on my subscription',
            'entity_date_notes:3 entity_subscription:2 symptom_wrong_data:1',
            `لوحة الشركة بتعرض «ملاحظات على التواريخ» لما تواريخ اشتراك مش متسقة — مثلًا تاريخ نهاية قبل البداية، أو اشتراك فعّال وتاريخه عدّى.\n\nده تنبيه عرض مش خصم ولا إيقاف. ابعتلي اسم الاشتراك والتاريخ اللي شايفه غلط وأنا أفتح تذكرة للفريق يصححه.`,
            `The company dashboard shows "Notes on the dates" when a subscription's dates are inconsistent — e.g. an end date before the start, or an active subscription whose date has passed.\n\nIt's a display warning, not a charge or a suspension. Send me the subscription name and the date that looks wrong and I'll open a ticket for the team to correct it.`),
        S('billing_available_services_missing', 'subscription/available_services/missing', 'subscription',
            'خدمة مش ظاهرة في «الخدمات المتاحة»', 'A service is missing from "Available services"',
            'entity_available_services:4 symptom_not_visible:1',
            `«الخدمات المتاحة» في لوحة الشركة بتتحسب من اشتراكاتك الفعّالة — الخدمة بتظهر لو فيه اشتراك فعّال بيشملها.\n\nلو خدمة ناقصة: راجع إن الاشتراك اللي بيشملها حالته فعّال ومش منتهي. لو فعّال وبرضه مش ظاهرة، قولّي اسم الخدمة وأنا أفتحلك تذكرة.`,
            `"Available services" in the company dashboard is derived from your active subscriptions — a service shows when an active subscription covers it.\n\nIf one is missing, check that the subscription covering it is active and not expired. If it is active and still missing, tell me the service name and I'll open a ticket.`),
        S('billing_renew_before_expiry', 'subscription/renewal/how_to', 'subscription',
            'أجدد اشتراكي إزاي', 'How to renew my subscription',
            'atom_renewal:3 entity_subscription:2 intent_how_to:1',
            `التجديد من «الباقات والاشتراك» ← تجديد:\n١. اختار الباقة (نفسها أو أكبر).\n٢. ادفع بتحويل بنكي أو محفظة كاش أو إنستاباي أو بوابة الدفع.\n٣. لو تحويل: ارفع إثبات التحويل مع الطلب.\n\nالطلب بيفتح تذكرة بهدف أول رد ساعة. جدّد قبل الانتهاء بكام يوم عشان المراجعة اليدوية ماتسيبش فجوة.`,
            `Renew from "Plans & subscription" → Renew:\n1. Choose the plan (the same or a larger one).\n2. Pay by bank transfer, cash wallet, InstaPay or the payment gateway.\n3. For a transfer, upload proof with the request.\n\nThe request opens a ticket with a one-hour first-reply target. Renew a few days before expiry so the manual review leaves no gap.`)
    ]
};
