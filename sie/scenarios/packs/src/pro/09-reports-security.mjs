/**
 * Pro · التقارير والأمان.
 *
 * Facts: Mad3oom company-reports.js / report-model.js (KB audit): metrics,
 * filters, export to CSV / XLSX / PDF, "average first response" and
 * "average close time"; company-account.js password rules (8 characters,
 * upper, lower, digit — the core covers the policy itself). Two-step codes
 * from an authenticator app are time-based (TOTP), so a phone clock that is
 * off rejects correct codes — general, verifiable behaviour of TOTP.
 *
 * @no-legitimate-corpus
 */
import { S, T } from '../dsl.mjs';

export default {
    tokens: [
        T('entity_avg_first_response', 'متوسط أول استجابة', 'average first response', ['متوسط اول استجابة', 'اول استجابة', 'اول استجابه', 'first response']),
        T('entity_avg_close_time', 'متوسط زمن الإغلاق', 'average close time', ['متوسط زمن الاغلاق', 'زمن الاغلاق', 'وقت الاغلاق', 'close time']),
        T('entity_pdf', 'ملف PDF', 'PDF file', ['pdf', 'بي دي اف']),
        T('entity_report_filter', 'فلتر التقرير', 'report filter', ['فلتر التاريخ', 'الفترة الزمنية', 'الفتره الزمنيه']),
        T('entity_device_clock', 'ساعة الموبايل', 'device clock', ['ساعة الموبايل', 'ساعه الموبايل', 'الوقت في الموبايل', 'توقيت الموبايل', 'phone clock']),
        T('entity_reset_link', 'لينك تغيير كلمة المرور', 'password reset link', ['لينك', 'اللينك', 'الرابط بتاع', 'reset link']),
        T('entity_email_changed_by_other', 'حد غيّر إيميلي', 'someone changed my e-mail', ['حد غير ايميلي', 'ايميلي اتغير', 'من غيري'])
    ],
    scenarios: [
        S('report_first_response_meaning', 'report/metric/avg_first_response', 'inquiry',
            'معنى «متوسط أول استجابة» في التقارير', 'What "average first response" means',
            'entity_avg_first_response:4 entity_report:1',
            `«متوسط أول استجابة» = متوسط الوقت من فتح التذكرة لحد أول رد عليها، على التذاكر اللي في الفترة والفلاتر المختارة.\n\nهو مقياس لسرعة الرد مش لسرعة الحل — تذكرة ممكن يكون ليها أول رد سريع وتفضل مفتوحة أيام. للحل بص على «متوسط زمن الإغلاق».`,
            `"Average first response" = the average time from a ticket being opened to its first reply, over the tickets in the selected period and filters.\n\nIt measures how fast you reply, not how fast you solve — a ticket can get a quick first reply and stay open for days. For solving, look at "average close time".`),
        S('report_close_time_meaning', 'report/metric/avg_close_time', 'inquiry',
            'معنى «متوسط زمن الإغلاق»', 'What "average close time" means',
            'entity_avg_close_time:4 entity_report:1',
            `«متوسط زمن الإغلاق» = متوسط الوقت من فتح التذكرة لحد ما اتقفلت، للتذاكر اللي اتقفلت في الفترة المختارة.\n\nالتذاكر المفتوحة لسه مابتدخلش في الحساب، فلو عندك تذاكر قديمة مفتوحة الرقم ممكن يبان أحسن من الواقع — راجعها من عرض التذاكر المفتوحة.`,
            `"Average close time" = the average time from opening to closing, for tickets closed in the selected period.\n\nTickets still open aren't counted, so if you have old open tickets the number can look better than reality — check them in the open-tickets view.`),
        S('report_export_formats', 'report/export/formats', 'inquiry',
            'أصدّر التقرير PDF أو Excel', 'Export a report as PDF or Excel',
            'entity_pdf:510 entity_report:490',
            `تقارير «لوحة الشركة» بتتصدّر بتلات صيغ: CSV وXLSX وPDF. ظبّط الفترة والفلاتر الأول، وبعدين اختار الصيغة من زرار التصدير.\n\n• PDF: للعرض والإرسال للإدارة.\n• XLSX: لو هتحلل الأرقام في Excel.\n• CSV: لو هتدخلها في نظام تاني.`,
            `Company-dashboard reports export in three formats: CSV, XLSX and PDF. Set the period and filters first, then choose the format from the export button.\n\n• PDF: for presenting and sending to management.\n• XLSX: if you'll analyse the numbers in Excel.\n• CSV: if you'll import them into another system.`,
            { alt: ['entity_spreadsheet:3 entity_report:3 intent_how_to:1'] }),
        S('report_date_filter_usage', 'report/filter/date_range', 'inquiry',
            'أغيّر الفترة الزمنية للتقرير', 'Change the report date range',
            'entity_report_filter:4 entity_report:1',
            `فلاتر التقرير في أعلى الصفحة: اختار الفترة (من - إلى) وأي فلتر تاني، والأرقام والرسوم بتتحدث عليها، والتصدير بياخد نفس الفلاتر.\n\nلو قارنت فترتين، خلّي باقي الفلاتر زي ما هي — تغيير فلتر تاني مع الفترة بيخلي المقارنة مش عادلة.`,
            `Report filters are at the top: choose the period (from – to) and any other filter; figures and charts update, and exports use the same filters.\n\nWhen comparing two periods, keep the other filters unchanged — changing another filter along with the period makes the comparison unfair.`),
        S('security_2fa_code_rejected_clock', 'security/2fa/code_rejected_time_sync', 'login',
            'كود التحقق من تطبيق المصادقة بيترفض', 'Authenticator app code is rejected',
            'entity_2fa:390 symptom_rejected:356 entity_device_clock:253',
            `أكواد تطبيقات المصادقة مبنية على الوقت، فلو ساعة الموبايل مش مظبوطة ولو بدقيقة، الكود الصح بيترفض.\n\nالحل: من إعدادات الموبايل خلّي الوقت والتاريخ «تلقائي»، وبعدين جرّب كود جديد (مش القديم). ولو لسه، قولّي وأفتحلك تذكرة استرجاع وصول.`,
            `Authenticator-app codes are time-based, so if your phone's clock is off, even by a minute, a correct code is rejected.\n\nFix: set date & time to "automatic" in your phone settings, then try a fresh code (not the old one). If it still fails, tell me and I'll open an access-recovery ticket.`,
            { alt: ['entity_device_clock:610 entity_2fa:390'] }),
        S('login_reset_link_expired_or_used', 'login/password_reset/link_invalid', 'login',
            'لينك تغيير كلمة المرور منتهي أو مستخدم', 'Password reset link expired or already used',
            'entity_reset_link:553 entity_password:256 symptom_expired:190',
            `لينك تغيير كلمة المرور بيشتغل مرة واحدة ولمدة محدودة. لو فتحته وقالك منتهي أو مستخدم:\n١. ارجع لصفحة الدخول واطلب «نسيت كلمة المرور» من جديد.\n٢. افتح أحدث إيميل بس — أي لينك أقدم بيبطل أول ما تطلب واحد جديد.\n\nولو كل لينك بيطلع منتهي على طول، جرّب تفتحه من نفس الجهاز والمتصفح.`,
            `A password reset link works once and for a limited time. If it says expired or used:\n1. Go back to the sign-in page and request "Forgot password" again.\n2. Open only the newest e-mail — older links stop working once you request a new one.\n\nIf every link shows as expired immediately, open it on the same device and browser.`,
            { alt: ['entity_reset_link:557 entity_password:256 symptom_already_registered:186'] }),
        S('security_email_changed_without_me', 'security/account_email/changed_by_other', 'login',
            'حد غيّر الإيميل بتاع حسابي', 'Someone changed my account e-mail',
            'entity_email_changed_by_other:4 entity_account:1',
            `ده موضوع أمان عاجل. بالترتيب:\n١. لو لسه قادر تدخل: غيّر كلمة المرور فورًا وفعّل التحقق بخطوتين.\n٢. راجع «نشاط الحساب» وشوف إمتى حصل التغيير.\n٣. قولّي دلوقتي «افتح تذكرة أمان» — تغيير الإيميل بيرجع عن طريق فريق الدعم بعد التحقق من إنك صاحب الحساب.\n\nمتبعتش كلمة المرور لحد، ولا في التذكرة.`,
            `This is an urgent security matter. In order:\n1. If you can still sign in: change your password now and turn on two-step verification.\n2. Check "Account activity" to see when the change happened.\n3. Tell me now "open a security ticket" — the e-mail is restored through the support team after verifying you own the account.\n\nDon't send your password to anyone, not even in the ticket.`)
    ]
};
