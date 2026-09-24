/**
 * Max · عام — المتصفح والروابط والملفات. GENERAL (not Mad3oom-specific).
 *
 * Facts are about browsers, mail apps and spreadsheets, true for any site.
 * Platform facts used, verified: the interface language is switched from the
 * sidebar «تغيير اللغة» (language-manager.js / customer-sidebar.js), and
 * reports export as CSV, XLSX or PDF (Pro report_export_formats, from the
 * company dashboard code).
 *
 * Neighbours checked:
 *   redirect loop   — nothing in Free/Pro/Max (ui_cache_causing_stale is stale data)
 *   page 404        ≠ api_endpoint_404 (an API endpoint)
 *   auto-translate  ≠ ui_language_wrong (the platform's own language setting)
 *   in-app browser  — nothing (gen_logged_out_on_browser_close is a setting, not a webview)
 *   CSV in Excel    ≠ data_import_encoding (importing), loc_rtl_reports (direction)
 * Considered and dropped as covered: server 500 (server_error_5xx), printing
 * (ui_print_layout_broken), Caps Lock / keyboard language (inside
 * login_wrong_credentials).
 *
 * @no-legitimate-corpus
 */
import { S, T } from '../dsl.mjs';

export default {
    tokens: [
        T('entity_redirect_loop', 'إعادة توجيه متكررة', 'redirect loop', ['اعاده توجيهك', 'تم اعاده توجيهك', 'اعادة توجيه', 'اعاده توجيه', 'بتلف وترجع', 'بيلف ويرجع', 'بيرجعني لنفس الصفحه', 'too many redirects', 'redirects', 'redirect loop']),
        // One specific phrase instead of two everyday words («الصفحة»، «مش موجود»):
        // the pair made a reading out of ordinary sentences.
        T('entity_page_not_found', 'الصفحة مش موجودة', 'page not found', ['الصفحه مش موجوده', 'الصفحة مش موجودة', 'الصفحه غير موجوده', 'الصفحة غير موجودة', 'صفحه مش موجوده', 'page not found', 'not found']),
        T('entity_auto_translate', 'الترجمة التلقائية', 'automatic translation', ['ترجم', 'ترجمت', 'الترجمه', 'الترجمه التلقاييه', 'ترجمه جوجل', 'جوجل ترجم', 'translate', 'google translate', 'translated']),
        T('entity_broke', 'باظ', 'broke', ['باظ', 'بوظت', 'بوظ', 'اتبوظ', 'اتبوظت']),
        T('entity_mail_app', 'تطبيق الإيميل', 'mail app', ['الجيميل', 'جيميل', 'gmail', 'اوتلوك', 'outlook']),
        T('entity_inside', 'جوّه', 'inside', ['جوه', 'جوا', 'inapp']),
        T('entity_garbled', 'رموز غريبة', 'garbled characters', ['رموز غريبه', 'حروف غريبه', 'رموز غريبة', 'حروف غريبة', 'علامات استفهام', 'gibberish', 'garbled', 'weird characters'])
    ],
    scenarios: [
        S('gen_too_many_redirects', 'device/browser/redirect_loop', 'technical',
            'الصفحة بتقول «تم إعادة توجيهك مرات كتير»', 'The page says "too many redirects"',
            'entity_redirect_loop:1',
            `«تم إعادة توجيهك مرات كتير» غالبًا سببها بيانات موقع قديمة محفوظة في المتصفح:\n• امسح بيانات موقعنا بس (الكوكيز وبيانات الموقع) من إعدادات المتصفح ← الخصوصية.\n• جرّب نافذة تصفح خفي — لو اشتغلت، يبقى السبب البيانات المحفوظة.\n• اقفل أي إضافة بتغيّر الروابط أو بتحجب محتوى.\n\nوبعدين سجّل دخولك من جديد.`,
            `"Too many redirects" is usually caused by old site data saved in the browser:\n• Clear our site's data only (cookies and site data) from the browser's settings ▸ Privacy.\n• Try a private window — if it works there, the saved data is the cause.\n• Turn off any extension that rewrites links or blocks content.\n\nThen sign in again.`),
        S('gen_page_not_found', 'device/browser/page_404', 'technical',
            'الصفحة بتقول «مش موجودة» (404)', 'The page says "not found" (404)',
            'entity_page_not_found:5 http_status_404:2',
            `«الصفحة مش موجودة» (404) معناها إن الرابط نفسه مش بيشاور على صفحة موجودة — غالبًا رابط قديم، أو حرف ناقص وانت بتكتبه أو بتنسخه.\n• افتح الموقع من الصفحة الرئيسية وادخل للمكان اللي عايزه من القائمة.\n• لو الرابط جالك في رسالة منّا أو من حد، ابعتهولي وأنا أشوف المفروض يوديك فين.`,
            `"Page not found" (404) means the link itself doesn't point to an existing page — usually an old link, or a character lost while typing or copying it.\n• Open the site from the home page and go where you need from the menu.\n• If the link came in a message from us or from someone, send it to me and I'll check where it should take you.`),
        S('gen_browser_auto_translate', 'device/browser/auto_translate', 'technical',
            'الترجمة التلقائية في المتصفح بوّظت الصفحة', 'The browser\'s automatic translation broke the page',
            'entity_auto_translate:860 entity_broke:139',
            `ميزة الترجمة التلقائية في المتصفح (زي ترجمة جوجل) بتغيّر نصوص الصفحة وهي شغالة، وده ممكن يلخبط الشكل ويخلّي أزرار ماتشتغلش.\n• اقفل الترجمة للموقع ده: من أيقونة الترجمة في شريط العنوان ← «عدم ترجمة هذا الموقع».\n• وحدّث الصفحة.\n\nولو محتاج الواجهة بلغة تانية، غيّرها من زرار «تغيير اللغة» في القائمة الجانبية بدل الترجمة.`,
            `The browser's automatic translation (such as Google Translate) rewrites the page's text while it runs, which can scramble the layout and stop buttons from working.\n• Turn translation off for this site: from the translate icon in the address bar ▸ "Never translate this site".\n• Then refresh the page.\n\nIf you need the interface in another language, switch it from the "Change language" button in the sidebar instead of translating.`,
            { alt: ['entity_auto_translate:5 entity_browser:1'] }),
        S('gen_link_opens_in_mail_app', 'device/mobile/in_app_browser', 'technical',
            'اللينك بيفتح جوّه تطبيق الإيميل ومش لاقي حسابي', 'The link opens inside the mail app and I am not signed in',
            'entity_mail_app:720 entity_inside:139 atom_open_action:139',
            `لما تفتح لينك من تطبيق إيميل (زي Gmail) على الموبايل، ساعات بيفتح في متصفح صغير جوّه التطبيق نفسه — ومش بيكون مسجّل دخولك فيه.\n• من القائمة (⋮ أو …) في المتصفح الصغير ده اختار «فتح في المتصفح» أو «Open in Chrome/Safari».\n• أو انسخ اللينك وافتحه في المتصفح اللي انت مسجّل دخولك عليه.`,
            `When you open a link from a mail app (such as Gmail) on your phone, it sometimes opens in a small browser inside the app itself — where you're not signed in.\n• From that small browser's menu (⋮ or …) choose "Open in browser" or "Open in Chrome/Safari".\n• Or copy the link and open it in the browser you're signed in on.`),
        S('gen_csv_garbled_in_excel', 'files/csv/arabic_garbled_excel', 'technical',
            'ملف CSV بالعربي بيطلع رموز غريبة في Excel', 'An Arabic CSV shows garbled characters in Excel',
            'entity_garbled:573 entity_spreadsheet:287 entity_arabic_word:139',
            `ملف CSV بالعربي لما يتفتح في Excel بالضغط عليه مرتين، Excel ساعات بيقراه بترميز غلط فالعربي يطلع رموز غريبة — الملف نفسه سليم.\n• بدل ما تفتحه مباشرة: من Excel ← «بيانات» ← «من نص/CSV»، واختار الترميز UTF-8.\n• ولو هتشتغل عليه في Excel والتصدير عندك فيه XLSX، اختار XLSX بدل CSV.`,
            `An Arabic CSV opened in Excel by double-clicking is sometimes read with the wrong encoding, so the Arabic shows as strange symbols — the file itself is fine.\n• Instead of opening it directly: in Excel ▸ Data ▸ From Text/CSV, and choose UTF-8 encoding.\n• If you'll work on it in Excel and the export offers XLSX, choose XLSX instead of CSV.`,
            { alt: ['entity_garbled:4 entity_spreadsheet:2'] })
    ]
};
