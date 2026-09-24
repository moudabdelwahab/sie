/**
 * Max · عام — الملفات والتنزيلات وExcel. GENERAL (not Mad3oom-specific).
 *
 * Facts about browsers, phones, Office and Excel that hold for any site.
 * Two are Egyptian in practice: Excel dropping the leading 0 of a mobile
 * number (01…), and Arabic file names turning into symbols.
 *
 * Neighbours checked:
 *   where did the download go ≠ core data_export_issue / export_empty (the export itself)
 *   downloaded file won't open ≠ gen_csv_garbled_in_excel (opens, garbled)
 *   download blocked warning   ≠ gen_antivirus_blocking (a program blocks the SITE)
 *   save a page as PDF         ≠ core ui_print_layout_broken (printing looks broken)
 *   zip file                   — nothing
 *   Arabic file name garbled   ≠ gen_csv_garbled_in_excel (the content)
 *   scan a document by phone   ≠ Pro ticket_how_to_take_screenshot (the screen)
 *   Word → PDF                 ≠ Pro billing_transfer_proof_too_large (shrink a proof)
 *   Excel drops leading zero   ≠ core data_import_encoding (Arabic in imports)
 *   long numbers become E+     — nothing
 *   CSV in one column          ≠ gen_csv_garbled_in_excel (encoding, not delimiter)
 *   upload stuck               ≠ Pro upload refused (it fails), core ticket_attachment_too_large
 * Rejected as not representable: Excel showing «####» (the tokenizer drops
 * the symbols, nothing is left to match); "file extension not showing"
 * (its words are Pro's file-type token plus a base symptom — no feasible
 * signature of its own).
 *
 * @no-legitimate-corpus
 */
import { S, T } from '../dsl.mjs';

export default {
    tokens: [
        T('entity_downloaded', 'نزّلته', 'downloaded', ['نزلت', 'نزلته', 'نزلتها', 'نزلتهم', 'downloaded']),
        T('entity_downloads_folder', 'التنزيلات', 'the downloads folder', ['التنزيلات', 'التحميلات', 'مجلد التنزيلات', 'فولدر التنزيلات', 'downloads', 'download folder']),
        T('entity_file_open_fail', 'مش راضي يتفتح', 'will not open', ['مابيفتحش', 'مبيفتحش', 'مش بيتفتح', 'مش راضي يتفتح', 'cant open the file', 'wont open', 'cannot open']),
        T('entity_download_blocked', 'التنزيل اتمنع', 'download blocked', ['ممكن يكون ضار', 'ممكن يكون خطر', 'حظر التنزيل', 'التنزيل اتمنع', 'اتمنع التحميل', 'download blocked', 'blocked download', 'may be harmful', 'dangerous file', 'virus scan failed']),
        T('entity_save_as_pdf', 'أحفظ الصفحة PDF', 'save the page as PDF', ['احفظ الصفحه', 'احفظ الصفحة', 'اطبع الصفحه', 'اطبع الصفحة', 'اطبعها', 'save as pdf', 'print to pdf', 'save page as pdf']),
        T('entity_zip', 'ملف مضغوط', 'compressed file', ['مضغوط', 'ملف مضغوط', 'فك الضغط', 'افك الضغط', 'فك ضغط', 'unzip', 'extract', 'compressed']),
        T('entity_filename', 'اسم الملف', 'file name', ['اسم الملف', 'اسماء الملفات', 'أسماء الملفات', 'file name', 'filename']),
        T('entity_scan_document', 'تصوير مستند', 'scanning a document', ['اصور مستند', 'اصور ورقه', 'اصور ورقة', 'اصور الورق', 'اسكان', 'سكان', 'اسكانر', 'scan a document', 'scanner', 'scan it']),
        T('entity_convert_word', 'أحوّل', 'convert', ['احول', 'احوله', 'احولها', 'تحويل', 'convert', 'converting']),
        T('entity_word_doc', 'ملف وورد', 'Word document', ['الوورد', 'وورد', 'ملف الوورد', 'word document', 'ms word']),
        T('entity_leading_zero', 'الصفر اللي في الأول', 'the leading zero', ['شال الصفر', 'بيشيل الصفر', 'مسح الصفر', 'الصفر اللي في الاول', 'الصفر من الاول', 'الصفر اللي علي الشمال', 'leading zero', 'drops the zero', 'removes the zero']),
        T('entity_long_numbers', 'الأرقام الطويلة', 'long numbers', ['الارقام الطويله', 'الارقام الطويلة', 'ارقام طويله', 'scientific notation', 'long numbers']),
        T('entity_one_column', 'كله في عمود واحد', 'all in one column', ['عمود واحد', 'في عمود واحد', 'كله في عمود', 'one column', 'single column']),
        T('entity_uploading', 'الرفع', 'uploading', ['الرفع', 'بيرفع', 'يرفع', 'بترفع', 'uploading']),
        T('entity_stuck_word', 'واقف', 'stuck', ['واقف', 'ومش بيخلص', 'مش بيخلص', 'stuck', 'hanging'])
    ],
    scenarios: [
        S('gen_downloaded_file_where', 'files/download/where_is_it', 'technical',
            'نزّلت الملف ومش لاقيه', 'I downloaded the file and can\'t find it',
            'entity_downloaded:3 entity_downloads_folder:2 symptom_disappeared:1',
            `الملفات اللي بتنزل من المتصفح بتروح لمجلد «التنزيلات» (Downloads) غالبًا:\n• على الكمبيوتر: اضغط Ctrl+J (أو Cmd+Shift+J على ماك) — بتفتح قائمة التنزيلات، ودوس «عرض في المجلد».\n• على أندرويد: تطبيق «الملفات» ← التنزيلات.\n• على آيفون: تطبيق «الملفات» ← التنزيلات.\n\nولو القائمة فاضية، يبقى التنزيل ماكملش — نزّله تاني.`,
            `Files downloaded from the browser usually go to the "Downloads" folder:\n• On a computer: press Ctrl+J (or Cmd+Shift+J on a Mac) to open the downloads list, then "Show in folder".\n• On Android: the "Files" app ▸ Downloads.\n• On iPhone: the "Files" app ▸ Downloads.\n\nIf the list is empty, the download didn't finish — download it again.`),
        S('gen_downloaded_file_wont_open', 'files/download/wont_open', 'technical',
            'الملف اللي نزّلته مش بيفتح', 'The file I downloaded will not open',
            'entity_file_open_fail:4 entity_downloaded:1',
            `لو الملف نزل بس مش بيفتح:\n• اتأكد إن عندك برنامج بيفتح النوع ده: PDF محتاج قارئ PDF، وXLSX محتاج Excel أو Google Sheets.\n• على الموبايل: افتحه من تطبيق «الملفات» واختار «فتح باستخدام».\n• لو حجمه صفر أو صغير بشكل غريب، التنزيل ماكملش — نزّله تاني.\n\nولو بيفتح عند زميلك ومش عندك، قولّي نوعه وأنا أقولك تفتحه بإيه.`,
            `If the file downloaded but won't open:\n• Make sure you have an app for that type: a PDF needs a PDF reader, an XLSX needs Excel or Google Sheets.\n• On a phone: open it from the "Files" app and choose "Open with".\n• If its size is zero or oddly small, the download didn't finish — download it again.\n\nIf it opens for a colleague but not for you, tell me its type and I'll tell you what to open it with.`),
        S('gen_download_blocked_warning', 'files/download/blocked_warning', 'technical',
            'المتصفح بيقول الملف ممكن يكون ضار ومنع التنزيل', 'The browser says the file may be harmful and blocked the download',
            'entity_download_blocked:5 entity_browser:1',
            `المتصفح بيعمل كده مع أنواع ملفات معيّنة أو مع ملف نزل من رابط ماتعرفوش:\n• لو الملف جالك منّا (زي تقرير أو فاتورة من حسابك)، من قائمة التنزيلات (Ctrl+J) دوس «الاحتفاظ» أو «Keep».\n• لو جالك من حد مش معروف أو في رسالة غريبة، متفتحوش — ابعتلي من فين جالك.`,
            `Browsers do this for some file types, or for a file from a link they don't know:\n• If the file came from us (such as a report or an invoice from your account), open the downloads list (Ctrl+J) and choose "Keep".\n• If it came from someone unknown or in a strange message, don't open it — tell me where it came from.`),
        S('gen_save_page_as_pdf', 'files/pdf/save_page', 'technical',
            'أحفظ الصفحة PDF إزاي', 'How do I save a page as a PDF',
            'entity_save_as_pdf:4 entity_pdf:2',
            `من أي متصفح:\n• اضغط Ctrl+P (أو Cmd+P على ماك)، وفي «الوجهة» اختار «حفظ بتنسيق PDF»، وبعدين «حفظ».\n• على آيفون: زرار المشاركة ← «طباعة»، وافتح المعاينة بإصبعين ← مشاركة ← «حفظ في الملفات».\n• على أندرويد: القائمة (⋮) ← مشاركة ← «طباعة» ← «حفظ بتنسيق PDF».`,
            `From any browser:\n• Press Ctrl+P (or Cmd+P on a Mac), set "Destination" to "Save as PDF", then "Save".\n• On iPhone: the Share button ▸ "Print", pinch out on the preview ▸ Share ▸ "Save to Files".\n• On Android: the menu (⋮) ▸ Share ▸ "Print" ▸ "Save as PDF".`),
        S('gen_zip_file_open', 'files/zip/open', 'technical',
            'ملف مضغوط (zip) ومش عارف أفتحه', 'A compressed (zip) file I can\'t open',
            'entity_zip:5',
            `الملف المضغوط لازم «يتفك» الأول:\n• ويندوز: كليك يمين عليه ← «استخراج الكل».\n• ماك: دبل كليك عليه.\n• أندرويد: افتحه من تطبيق «الملفات» ← «استخراج».\n• آيفون: دوس عليه في تطبيق «الملفات» — بيتفك لوحده في نفس المكان.\n\nالملفات اللي جوه بتظهر في فولدر بنفس الاسم.`,
            `A compressed file has to be extracted first:\n• Windows: right-click it ▸ "Extract All".\n• Mac: double-click it.\n• Android: open it in the "Files" app ▸ "Extract".\n• iPhone: tap it in the "Files" app — it extracts in the same place.\n\nThe files inside appear in a folder with the same name.`),
        S('gen_arabic_filename_garbled', 'files/name/arabic_garbled', 'technical',
            'اسم الملف العربي بقى رموز غريبة', 'The Arabic file name turned into strange symbols',
            'entity_filename:688 entity_arabic_word:139 entity_codes_word:172',
            `بعض البرامج (وخصوصًا الملفات المضغوطة وبعض الإيميلات) مابتحفظش الأسماء العربي صح، فبتطلع رموز. الملف نفسه غالبًا سليم:\n• غيّر اسمه وافتحه عادي.\n• لو هتبعت ملف لحد أو ترفعه، سمّيه بالإنجليزي قبلها — ده بيمنع المشكلة من الأول.`,
            `Some programs (especially compressed files and some e-mail) don't keep Arabic names correctly, so they turn into symbols. The file itself is usually fine:\n• Rename it and open it normally.\n• When sending or uploading a file, give it an English name first — that avoids the problem entirely.`,
            { alt: ['entity_filename:4 entity_garbled:2'] }),
        S('gen_scan_document_phone', 'files/scan/phone_document', 'technical',
            'أصوّر مستند بالموبايل وأبعته واضح إزاي', 'How do I scan a document clearly with my phone',
            'entity_scan_document:5 qualifier_mobile:1',
            `بدل صورة الكاميرا العادية، استخدم «مسح المستندات» — بيقصّ الورقة ويخليها واضحة وحجمها صغير:\n• آيفون: تطبيق «الملاحظات» ← الكاميرا ← «مسح المستندات».\n• أندرويد: تطبيق Google Drive ← (+) ← «مسح ضوئي».\n• حط الورقة على سطح غامق في نور كويس، وخلّي أطرافها الأربعة باينة.\n\nبيطلع ملف PDF تقدر ترفعه أو تبعته.`,
            `Instead of a normal camera photo, use document scanning — it crops the page, makes it clear and keeps it small:\n• iPhone: the "Notes" app ▸ camera ▸ "Scan Documents".\n• Android: the Google Drive app ▸ (+) ▸ "Scan".\n• Put the page on a dark surface in good light, with all four corners visible.\n\nYou get a PDF you can upload or send.`),
        S('gen_convert_word_to_pdf', 'files/pdf/convert_word', 'technical',
            'أحوّل ملف وورد لـ PDF إزاي', 'How do I convert a Word file to PDF',
            'entity_convert_word:2 entity_word_doc:3 entity_pdf:2',
            `• من Word: ملف ← «حفظ باسم»، واختار النوع PDF.\n• من غير Word: ارفعه على Google Drive، افتحه بـ Google Docs ← ملف ← تنزيل ← PDF.\n• على الموبايل: افتحه ← مشاركة ← «طباعة» ← «حفظ بتنسيق PDF».`,
            `• In Word: File ▸ "Save As", and choose PDF as the type.\n• Without Word: upload it to Google Drive, open it with Google Docs ▸ File ▸ Download ▸ PDF.\n• On a phone: open it ▸ Share ▸ "Print" ▸ "Save as PDF".`),
        S('gen_excel_drops_leading_zero', 'files/excel/leading_zero', 'technical',
            'Excel شال الصفر من أول رقم الموبايل', 'Excel removed the leading zero from phone numbers',
            'entity_leading_zero:4 entity_spreadsheet:2 entity_whatsapp_number:1',
            `Excel بيعتبر الرقم «عدد» فبيشيل الصفر اللي على الشمال — البيانات في الملف نفسه سليمة:\n• عشان تشوفها صح: بدل ما تفتح الملف بدبل كليك، من Excel ← «بيانات» ← «من نص/CSV»، واختار عمود الأرقام ← «نص».\n• أو حدّد العمود ← تنسيق الخلايا ← «نص» قبل ما تلصق الأرقام.\n\nولو هتستورد الأرقام في مكان تاني، اتأكد إنها رجعت بالصفر (01…) أو بالصيغة الدولية (2010…).`,
            `Excel treats the value as a number, so it drops the zero on the left — the data in the file itself is fine:\n• To see it correctly: instead of double-clicking the file, in Excel ▸ Data ▸ From Text/CSV, set the phone column to "Text".\n• Or select the column ▸ Format Cells ▸ "Text" before pasting the numbers.\n\nIf you'll import the numbers elsewhere, make sure they're back with the zero (01…) or in international form (2010…).`),
        S('gen_excel_long_numbers_scientific', 'files/excel/scientific_notation', 'technical',
            'الأرقام الطويلة في Excel بقت شكلها غريب (E+)', 'Long numbers in Excel turned into E+ notation',
            'entity_long_numbers:4 entity_spreadsheet:2',
            `Excel بيعرض أي رقم طويل (زي الموبايل أو رقم العملية) بالصيغة العلمية (2.01E+11)، ولو اتحفظ كده ممكن آخر أرقامه تضيع:\n• حدّد العمود ← تنسيق الخلايا ← «نص» (قبل الإدخال أو الاستيراد).\n• ولو بتفتح CSV: من «بيانات» ← «من نص/CSV» واختار العمود «نص».\n\nمتحفظش الملف من Excel بعد ما الأرقام اتحولت، وإلا هتفضل متغيرة.`,
            `Excel shows any long number (such as a phone or transaction number) in scientific form (2.01E+11), and if saved that way the last digits can be lost:\n• Select the column ▸ Format Cells ▸ "Text" (before entering or importing).\n• If you're opening a CSV: Data ▸ From Text/CSV, and set the column to "Text".\n\nDon't save the file from Excel after the numbers were converted, or they'll stay changed.`),
        S('gen_csv_opens_in_one_column', 'files/csv/one_column', 'technical',
            'ملف CSV بيفتح في Excel كله في عمود واحد', 'A CSV opens in Excel all in one column',
            'entity_one_column:4 entity_spreadsheet:2',
            `ده سببه إن Excel على جهازك متوقّع فاصل غير الفاصلة (بيحصل مع إعدادات المنطقة العربي أو الأوروبي):\n• بدل الدبل كليك: من Excel ← «بيانات» ← «من نص/CSV»، واختار الفاصل «فاصلة» (Comma).\n• أو حدّد العمود ← «بيانات» ← «نص إلى أعمدة» ← «محدد» ← «فاصلة».\n\nولو عندك اختيار XLSX في التصدير، اختاره وهيفتح مترتب على طول.`,
            `This happens because Excel on your device expects a separator other than the comma (common with Arabic or European regional settings):\n• Instead of double-clicking: in Excel ▸ Data ▸ From Text/CSV, and choose "Comma" as the delimiter.\n• Or select the column ▸ Data ▸ "Text to Columns" ▸ "Delimited" ▸ "Comma".\n\nIf the export offers XLSX, choose it and it opens already arranged.`),
        S('gen_upload_stuck', 'files/upload/stuck', 'technical',
            'الرفع واقف ومش بيخلص', 'The upload is stuck and never finishes',
            'entity_uploading:4 entity_stuck_word:3',
            `الرفع اللي بيقف في النص سببه غالبًا الشبكة أو حجم الملف:\n• جرّب ملف أصغر (صورة screenshot بدل صورة الكاميرا، أو PDF بدل صورة كبيرة).\n• اتأكد إن النت ثابت — على الموبايل جرّب واي فاي بدل الداتا أو العكس.\n• متقفلش الصفحة ولا تبدّل التطبيق وهو بيرفع.\n• جرّب متصفح تاني.\n\nولو ملف صغير بيقف برضه، قولّي بترفعه فين بالظبط.`,
            `An upload that stops midway is usually the network or the file's size:\n• Try a smaller file (a screenshot instead of a camera photo, or a PDF instead of a large image).\n• Make sure the connection is stable — on a phone, try Wi-Fi instead of mobile data or the reverse.\n• Don't close the page or switch apps while it uploads.\n• Try another browser.\n\nIf even a small file gets stuck, tell me exactly where you're uploading it.`,
            { alt: ['entity_file_upload:3 entity_stuck_word:3'] })
    ]
};
