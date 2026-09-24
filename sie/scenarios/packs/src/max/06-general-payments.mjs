/**
 * Max · عام — الدفع من ناحية البنك والكارت، والنت اللي بيفصل في النص.
 * GENERAL (not Mad3oom-specific); several are Egyptian in cause.
 *
 * Every answer is about the customer's bank, card or connection and holds
 * for any site. No claim about the platform's gateway, currency, refund
 * windows or fees — where the answer depends on those, it asks for the
 * transaction and routes to the finance team. The one platform fact used:
 * an activated subscription is visible in the account (core
 * subscription_status_inquiry).
 *
 * Neighbours checked:
 *   bank OTP not arriving   ≠ core login_otp_not_received (OUR code; the
 *                             platform sends no SMS — this one is the bank's)
 *   failed but money held   ≠ core subscription_payment_not_reflected (paid
 *                             and succeeded), subscription_double_charged
 *   connection cut midway   ≠ core convo_weak_internet (no "did it go through");
 *                             ONE scenario for paying and saving — a separate
 *                             "while paying" one was merged (duplicate gate)
 *   statement merchant name ≠ core billing_unexpected_charge (a charge they
 *                             don't recognise AT ALL — this one they do)
 *   name on the card        — nothing
 *   amount ≠ price (FX/fee) ≠ core billing_bill_higher (the invoice itself)
 *   cut mid-save / mid-send ≠ Pro ticket_draft_lost (the ticket form only)
 * Removed on reading the neighbour: "the bank must enable online purchases"
 * (core subscription_payment_rejected says it). Rejected as not
 * representable: the postal/ZIP-code field — «الرمز البريدي» resolves to
 * the e-mail token (بريد) and "zip" to the file-type token.
 *
 * @no-legitimate-corpus
 */
import { S, T } from '../dsl.mjs';

export default {
    tokens: [
        T('entity_bank', 'البنك', 'the bank', ['البنك', 'بنك', 'بنكي', 'البنك بتاعي', 'the bank', 'my bank']),
        T('entity_bank_message', 'رسالة البنك', 'the bank\'s message', ['رسالة البنك', 'رساله البنك', 'رسايل البنك', 'كود البنك', 'رمز البنك', 'bank sms']),
        T('entity_money_deducted', 'اتخصم', 'charged', ['اتخصمت', 'اتخصم', 'اتسحبت', 'اتسحب', 'charged', 'deducted']),
        T('entity_money_held', 'اتحجز', 'held', ['اتحجزت', 'اتحجز', 'محجوزة', 'محجوزه', 'on hold', 'held']),
        // Not the bare «فشل»: it matched developer text («فشل الـ RPC», «الفشل»).
        T('entity_failed_word', 'فشلت', 'did not go through', ['فشلت', 'ماتمش', 'متمش', 'ماكملتش', 'مكملتش', 'did not go through']),
        T('entity_connection_cut', 'النت أو الكهربا قطعت', 'the connection or power cut', ['النت فصل', 'النت قطع', 'النت وقع', 'النت فصل مني', 'الشبكة فصلت', 'الشبكه فصلت', 'الانترنت فصل', 'الانترنت قطع', 'الكهربا قطعت', 'الكهربا فصلت', 'النور قطع', 'النور قاطع', 'connection dropped', 'internet cut', 'lost connection', 'power cut']),
        T('entity_paying_now', 'وأنا بدفع', 'while paying', ['بدفع', 'وانا بدفع', 'while paying']),
        T('entity_did_it_go_through', 'اتحفظ ولا لأ', 'did it go through', ['اتحفظ ولا لا', 'اتبعت ولا لا', 'اتدفع ولا لا', 'اتسجل ولا لا', 'اتحفظت ولا لا', 'did it go through', 'was it saved', 'was it sent']),
        T('entity_mid_action', 'وأنا بعمل حاجة', 'in the middle of an action', ['وانا بحفظ', 'وانا ببعت', 'وانا بكتب', 'وانا بعدل', 'وانا برفع', 'in the middle', 'while saving', 'while sending']),
        T('entity_bank_statement', 'كشف الحساب', 'bank statement', ['كشف الحساب', 'كشف حساب', 'كشف البنك', 'كشف حساب البنك', 'statement', 'bank statement']),
        T('entity_other_name', 'باسم تاني', 'under another name', ['باسم', 'باسم تاني', 'اسم تاني', 'اسم غريب', 'different name', 'another name', 'unknown name']),
        T('entity_cardholder_name', 'اسم صاحب الكارت', 'cardholder name', ['اسم صاحب', 'الاسم اللي علي', 'الاسم المكتوب علي', 'cardholder', 'name on card', 'name on the card']),
        T('entity_amount_differs', 'المبلغ مختلف', 'the amount differs', ['فرق في المبلغ', 'المبلغ مختلف', 'زياده عن', 'زيادة عن', 'مني زياده', 'different amount', 'charged more']),
        T('entity_bank_fees', 'رسوم البنك', 'bank fees', ['رسوم البنك', 'عمولة البنك', 'عموله البنك', 'رسوم تحويل', 'سعر الصرف', 'bank fees', 'exchange rate'])
    ],
    scenarios: [
        S('gen_bank_otp_not_received', 'billing/card/bank_otp_missing', 'billing',
            'رسالة البنك (الكود) مابتوصلش وأنا بدفع', 'The bank\'s verification message does not arrive when I pay',
            'entity_bank:259 entity_paying_now:161 entity_otp:190 symptom_otp_not_received:259 entity_card:130',
            `الرسالة دي بيبعتها البنك بتاعك نفسه (مش احنا) عشان يأكّد عملية الدفع:\n• اتأكد إن رقم موبايلك مسجّل صح في البنك، وإن الخط شغال ومعاك.\n• استنى دقيقة قبل ما تطلبها تاني، ومتقفلش صفحة الدفع.\n• بعض البنوك بتبعتها في تطبيق البنك بدل رسالة، وبعضها محتاج تفعيل الشراء أونلاين الأول.\n\nلو مابتوصلش خالص، كلّم خدمة عملاء البنك — دي من عندهم — وبعدها جرّب الدفع تاني.`,
            `That message is sent by your own bank (not us) to confirm the payment:\n• Make sure your phone number is registered correctly at the bank, and that the line works and is with you.\n• Wait a minute before requesting it again, and don't close the payment page.\n• Some banks send it in their app instead of a text message, and some need online purchases enabled first.\n\nIf it never arrives, call your bank's customer service — it comes from them — then try the payment again.`,
            { alt: ['entity_bank_message:710 symptom_not_received:290', 'entity_bank:519 entity_otp:190 symptom_not_received:290'] }),
        S('gen_payment_failed_money_held', 'billing/card/failed_but_held', 'billing',
            'الدفع فشل بس المبلغ اتخصم أو اتحجز', 'The payment failed but the amount was charged or held',
            'entity_money_deducted:2 entity_failed_word:2 entity_payment:1',
            `لو الدفع قال إنه فشل والمبلغ ظاهر مخصوم، غالبًا ده «حجز» مؤقت من البنك مش خصم نهائي — البنك بيرجّعه لوحده لما العملية ماتكملش، والمدة من عنده.\n• متدفعش تاني قبل ما تشوف اشتراكك: لو اتفعّل، يبقى الدفع نجح فعلًا.\n• لو ماتفعّلش والمبلغ مارجعش خلال كام يوم عمل، ابعتلي تاريخ العملية والمبلغ وآخر ٤ أرقام من الكارت (مش الرقم كامل) وأنا أفتح طلب للفريق المالي.`,
            `If the payment said it failed but the amount shows as charged, it's usually a temporary bank "hold", not a final charge — the bank releases it on its own when the payment doesn't complete, on its own timeline.\n• Don't pay again before checking your subscription: if it's active, the payment did succeed.\n• If it isn't active and the amount hasn't come back within a few business days, send me the date, the amount and the last 4 digits of the card (not the full number) and I'll open a request for the finance team.`,
            { alt: ['entity_money_held:4 entity_payment:1'] }),
        // One situation with two branches (paying / saving or sending). A
        // separate "while paying" scenario was written and merged: the
        // duplicate gate found it (same primary token, similar label).
        S('gen_connection_cut_mid_action', 'device/network/cut_mid_action', 'technical',
            'النت أو الكهربا قطعت في النص — اتحفظ أو اتدفع؟', 'The connection cut midway — did it save or go through?',
            'entity_connection_cut:3 entity_mid_action:2 entity_did_it_go_through:2',
            `لو النت أو الكهربا قطعت في النص:\n• لو كنت بتدفع: متدفعش تاني قبل ما تتأكد. ادخل حسابك وشوف الاشتراك — لو اتفعّل، الدفع تم. ولو مفيش خصم في رسايل البنك أو تطبيقه، ادفع من جديد. ولو فيه خصم والاشتراك ماتفعّلش، ابعتلي وقت العملية والمبلغ وأنا أتابعها مع الفريق المالي.\n• لو كنت بتحفظ أو بتبعت: افتح الصفحة تاني — لو التعديل أو الرسالة ظاهرين، يبقوا اتحفظوا؛ لو لأ، اعملها تاني.\n\nولو بتكتب كلام طويل، اكتبه في ملاحظة الأول وانسخه، عشان مايضيعش لو القطع اتكرر.`,
            `If the internet or power cut midway:\n• If you were paying: don't pay again before checking. Sign in and look at your subscription — if it's active, the payment went through. If your bank's messages or app show no charge, pay again. If you were charged but the subscription isn't active, send me the time and the amount and I'll follow it up with the finance team.\n• If you were saving or sending: open the page again — if the change or message is there, it was saved; if not, do it again.\n\nIf you're writing something long, draft it in a note first and paste it, so it isn't lost if the cut happens again.`,
            { alt: ['entity_connection_cut:4 entity_paying_now:2 entity_payment:1', 'entity_connection_cut:3 entity_did_it_go_through:3'] }),
        S('gen_statement_other_merchant_name', 'billing/card/statement_name', 'billing',
            'الخصم ظاهر في كشف الحساب باسم تاني', 'The charge shows under a different name on my statement',
            'entity_bank_statement:3 entity_other_name:3 entity_bank:1 entity_money_deducted:1',
            `الاسم اللي بيظهر في كشف الحساب ساعات بيكون اسم شركة الدفع الوسيطة أو اسم قانوني مختصر، مش اسم الموقع اللي دفعت فيه.\n• قارن التاريخ والمبلغ بعملية دفعتها عندنا.\n• لو مش متأكد إن الخصم ده بتاعنا، ابعتلي التاريخ والمبلغ (من غير رقم الكارت كامل) وأنا أراجعه.`,
            `The name on a bank statement is sometimes the payment processor's, or a shortened legal name — not the name of the site you paid on.\n• Compare the date and amount with a payment you made with us.\n• If you're not sure the charge is ours, send me the date and the amount (without the full card number) and I'll check it.`),
        S('gen_card_name_field', 'billing/card/name_on_card', 'billing',
            'اسم صاحب الكارت أكتبه عربي ولا إنجليزي؟', 'Should I write the cardholder name in Arabic or English?',
            'entity_cardholder_name:4 entity_card:2',
            `اكتب الاسم زي ما هو مطبوع على الكارت بالظبط — وده غالبًا بالإنجليزي.\n• لو الكارت مفيهوش اسم مطبوع، اكتب اسمك بالإنجليزي زي ما هو مسجّل في البنك.\n• اختلاف بسيط في الاسم غالبًا مابيرفضش العملية، لكن رقم الكارت وتاريخ الانتهاء والرمز اللي ورا (CVV) لازم يبقوا مظبوطين بالظبط.`,
            `Write the name exactly as it's printed on the card — usually in English.\n• If there's no name printed on the card, write your name in English as registered at the bank.\n• A small difference in the name usually doesn't fail the payment, but the card number, expiry date and the code on the back (CVV) must be exactly right.`),
        S('gen_charged_amount_differs', 'billing/card/amount_differs_fx', 'billing',
            'المبلغ اللي اتخصم مختلف عن السعر', 'The amount charged differs from the price',
            'entity_money_deducted:256 entity_amount_differs:557 intent_pricing:186',
            `لو المبلغ اللي اتخصم أكبر شوية من سعر الباقة، الغالب إن الفرق من البنك مش مننا:\n• لو الكارت بعملة غير عملة الدفع، البنك بيحوّل بسعر الصرف بتاعه.\n• بعض البنوك بتضيف رسوم على المشتريات من مواقع بعملة أجنبية أو من برّه البلد.\n\nتطبيق البنك أو كشف الحساب بيوضّح سعر الصرف والرسوم. ولو الفرق كبير أو مش مفهوم، ابعتلي التاريخ والمبلغين وأنا أراجع مع الفريق المالي.`,
            `If the amount charged is slightly more than the plan's price, the difference usually comes from the bank, not us:\n• If your card is in a different currency from the payment's, the bank converts at its own exchange rate.\n• Some banks add fees on purchases in a foreign currency or from sites abroad.\n\nYour bank's app or statement shows the exchange rate and fees. If the difference is large or unclear, send me the date and both amounts and I'll check with the finance team.`,
            { alt: ['entity_bank_fees:743 entity_money_deducted:256'] })
    ]
};
