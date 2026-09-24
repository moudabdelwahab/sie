/**
 * Max · مشاكل على جهاز العميل أو شبكته — عامة، ومش ادعاءات عن المنصة.
 *
 * The Max pack is "general / common" support: problems that live on the
 * customer's side (browser, device, network, typing), answered with facts
 * about browsers and operating systems — never with a claim about a Mad3oom
 * feature that could not be verified.
 *
 * WHY ONLY EIGHT. The 635-scenario core already covers most of this ground:
 * unsupported browser, extensions, VPN, cache, updates, weak internet, a
 * borrowed device, spam folder, notification permission, time zone, mobile
 * layout, app crashes, screen reader, storage. Each case below was checked
 * against those (ids listed in docs/editions-engineering-report.md) and is a
 * different cause with a different fix. (A tenth, "how to record the
 * screen", was written and then removed: the audit found the Pro pack's
 * ticket_how_to_record_screen already answers it. A "mistyped my e-mail at
 * sign-up" case was removed on reading: the core's email_wrong_address is
 * the same case to a customer — which the audit's similarity pass did not
 * catch, because the labels differ and the core entry has no answer text.) Writing past what is genuinely
 * distinct would mean restating the core — the one thing the editions are
 * not allowed to do.
 *
 * Facts used (general, stable): Ctrl/Cmd+0 resets zoom; Help ▸ About shows the browser version; Ctrl+Shift+V pastes
 * plain text; captive portals block every site until accepted; a browser's
 * pop-up blocker shows an icon in the address bar. Platform fact: the site is
 * served from mad3oom.com and its subdomains (corrected 2026-09-24 — the
 * first version also named mad3oom.online, which is only the e-mail domain).
 *
 * @no-legitimate-corpus
 */
import { S, T } from '../dsl.mjs';

export default {
    tokens: [
        T('entity_autofill', 'الملء التلقائي', 'autofill', ['بيملى', 'بيملي', 'بيملا', 'الملء التلقائي', 'autofill']),
        T('entity_zoom', 'تكبير الصفحة', 'page zoom', ['الزوم', 'زوم', 'zoom', 'التكبير', 'صغيرة اوي', 'صغيره اوي', 'صغير اوي', 'كبيرة اوي', 'كبيره اوي', 'كبير اوي']),
        T('entity_browser_version', 'إصدار', 'version', ['نسخه', 'نسخة', 'اصدار', 'الاصدار', 'version']),
        T('entity_paste', 'لصق', 'paste', ['الصق', 'لزق', 'بلزق', 'الزق', 'paste', 'نسخ ولصق']),
        T('entity_text_direction', 'اتجاه النص', 'text direction', ['اتجاه الكلام', 'اتجاه النص', 'بيتقلب', 'من الشمال لليمين', 'من اليمين للشمال', 'rtl', 'ltr']),
        T('entity_arabic_digits', 'الأرقام العربية', 'Arabic-Indic digits', ['بالارقام العربي', 'الارقام العربي', 'ارقام عربي', 'بالارقام العربيه', 'الارقام الهندي', 'arabic numerals']),
        T('entity_work_network', 'شبكة الشغل', 'work network', ['نت الشغل', 'شبكة الشغل', 'شبكه الشغل', 'شبكة الشركة', 'شبكه الشركه', 'الفايروول', 'فايروول', 'firewall']),
        T('entity_public_wifi', 'واي فاي عام', 'public Wi-Fi', ['واي فاي الفندق', 'واي فاي عام', 'واي فاي الكافيه', 'شبكة عامة', 'شبكه عامه', 'public wifi', 'hotel wifi']),
        T('entity_popup', 'نافذة منبثقة', 'pop-up', ['النوافذ المنبثقة', 'النوافذ المنبثقه', 'نافذة منبثقة', 'نافذه منبثقه', 'popup', 'بوب اب', 'تاب جديدة', 'تاب جديده', 'التاب الجديدة', 'التاب الجديده', 'الصفحة الجديدة', 'الصفحه الجديده'])
    ],
    scenarios: [
        S('gen_password_autofill_wrong', 'device/browser/autofill_wrong_password', 'login',
            'المتصفح بيملى كلمة مرور قديمة', 'The browser fills in an old password',
            'entity_autofill:5 entity_password:2 entity_browser:1',
            `المتصفح بيملى كلمة المرور اللي كان حافظها — ولو غيّرتها، القديمة لسه متسجلة عنده.\n• امسح الخانة واكتب الجديدة بإيدك، ولما المتصفح يسألك «تحديث كلمة المرور؟» اختار تحديث.\n• أو من إعدادات المتصفح ← كلمات المرور: دوّر على موقعنا وعدّل المحفوظة أو امسحها.\n\nولو كلمة المرور نفسها مش فاكرها، استخدم «نسيت كلمة المرور» من صفحة الدخول.`,
            `The browser fills in the password it saved — and if you changed it, the old one is still stored there.\n• Clear the field and type the new one yourself; when the browser asks "Update password?", choose update.\n• Or in your browser's settings ▸ Passwords, find our site and edit or delete the saved one.\n\nIf you don't remember the password itself, use "Forgot password" on the sign-in page.`),
        S('gen_browser_zoom_layout', 'device/browser/zoom_level', 'technical',
            'الصفحة ظاهرة صغيرة أو كبيرة أوي', 'The page looks too small or too large',
            'entity_zoom:1',
            `غالبًا مستوى التكبير في المتصفح اتغيّر:\n• رجّعه للطبيعي: Ctrl+0 على ويندوز، أو Cmd+0 على ماك.\n• للتكبير أو التصغير: Ctrl (أو Cmd) مع + أو −.\n• على الموبايل: قرّب أو بعّد بصباعين، أو من قائمة المتصفح ← حجم النص.\n\nلو رجع للطبيعي والشكل لسه متلخبط، ابعتلي صورة للشاشة.`,
            `Your browser's zoom level has most likely changed:\n• Reset it: Ctrl+0 on Windows, or Cmd+0 on a Mac.\n• To zoom in or out: Ctrl (or Cmd) with + or −.\n• On a phone: pinch with two fingers, or browser menu ▸ Text size.\n\nIf it's back to normal and the layout still looks wrong, send me a screenshot.`),
        S('gen_browser_version_how', 'device/browser/version_how', 'inquiry',
            'أعرف إصدار المتصفح منين', 'How to find my browser version',
            'entity_browser_version:583 entity_browser:223 intent_how_to:194',
            `من قائمة المتصفح:\n• كروم أو إيدج: القائمة (⋮ أو …) ← مساعدة ← «حول» — والصفحة دي بتحدّث المتصفح لو فيه تحديث.\n• فايرفوكس: القائمة ← مساعدة ← «حول فايرفوكس».\n• سفاري: من قائمة Safari فوق ← «حول سفاري».\n\nابعتلي الرقم اللي ظاهر مع اسم المتصفح.`,
            `From the browser's menu:\n• Chrome or Edge: menu (⋮ or …) ▸ Help ▸ "About" — that page also installs any pending update.\n• Firefox: menu ▸ Help ▸ "About Firefox".\n• Safari: the Safari menu at the top ▸ "About Safari".\n\nSend me the number shown with the browser's name.`),
        S('gen_mixed_direction_paste', 'device/typing/mixed_direction', 'technical',
            'الكلام العربي مع الإنجليزي بيتقلب لما ألصقه', 'Mixed Arabic and English text flips when pasted',
            'entity_text_direction:4 entity_paste:3',
            `لما سطر فيه عربي وإنجليزي (أو أرقام) مع بعض، ترتيب العرض ممكن يبان مقلوب رغم إن الكلام نفسه مكتوب صح.\n• ابدأ السطر بكلمة عربي.\n• حط الجزء الإنجليزي في سطر لوحده.\n• ألصق كنص عادي من غير تنسيق: Ctrl+Shift+V (على ماك Cmd+Shift+Option+V).`,
            `When a line mixes Arabic with English (or numbers), the display order can look flipped even though the text itself is right.\n• Start the line with an Arabic word.\n• Put the English part on its own line.\n• Paste as plain text without formatting: Ctrl+Shift+V (on a Mac, Cmd+Shift+Option+V).`,
            { alt: ['entity_paste:516 entity_text_direction:344 entity_arabic_word:139'] }),
        S('gen_arabic_digits_input', 'device/typing/arabic_digits', 'technical',
            'الخانة مش بتقبل الأرقام العربي', 'A field rejects Arabic-Indic digits',
            'entity_arabic_digits:1',
            `لو خانة رافضة رقم مكتوب بالأرقام العربية (٠١٢٣)، اكتبه بالأرقام الإنجليزية (0123) — مواقع كتير بتفهم دي بس في خانات الأرقام والتليفون.\n\nعلى الموبايل: غيّر لوحة المفاتيح للإنجليزي وقت كتابة الرقم، أو من إعدادات لوحة المفاتيح اختار الأرقام الغربية.`,
            `If a field rejects a number typed in Arabic-Indic digits (٠١٢٣), type it with Western digits (0123) — many sites only understand those in number and phone fields.\n\nOn a phone: switch the keyboard to English while typing the number, or pick Western digits in the keyboard's settings.`),
        S('gen_work_network_blocking', 'device/network/work_firewall', 'technical',
            'الموقع مش بيفتح من شبكة الشغل', 'The site does not open on my work network',
            'entity_work_network:5 symptom_blank_page:1 entity_dashboard:1',
            `شبكات الشركات أحيانًا بتمنع مواقع جديدة عليها (فايروول أو بروكسي).\n• جرّب من نت الموبايل: لو فتح، يبقى المنع من شبكة الشغل.\n• اطلب من قسم الـ IT يسمحوا بنطاقات المنصة: mad3oom.com ونطاقاته الفرعية (*.mad3oom.com).\n\nلو مافتحش من الموبايل كمان، قولّي إيه اللي بيظهرلك بالظبط.`,
            `Company networks sometimes block sites that are new to them (a firewall or proxy).\n• Try on your phone's mobile data: if it opens, the block is on the work network.\n• Ask your IT team to allow the platform's domain: mad3oom.com and its subdomains (*.mad3oom.com).\n\nIf it doesn't open on mobile data either, tell me exactly what you see.`,
            { alt: ['entity_work_network:5 symptom_not_working:1'] }),
        S('gen_public_wifi_login_page', 'device/network/captive_portal', 'technical',
            'واي فاي عام (فندق أو كافيه) والموقع مش بيفتح', 'Public Wi-Fi (hotel or café) and the site does not open',
            'entity_public_wifi:5 symptom_blank_page:1',
            `شبكات الفنادق والكافيهات غالبًا بتطلب تسجيل دخول للشبكة الأول، وبتمنع أي موقع لحد ما تقبل شروطها.\n• افتح أي موقع تاني الأول — المفروض تظهرلك صفحة دخول الشبكة.\n• اقبل الشروط أو اكتب بيانات الغرفة، وبعدين ارجع للمنصة.\n\nلو صفحة الشبكة ماظهرتش، جرّب تفصل الواي فاي وتوصله تاني.`,
            `Hotel and café networks usually require you to sign in to the network first, and block every site until you accept their terms.\n• Open any other site first — the network's sign-in page should appear.\n• Accept the terms or enter your room details, then come back to the platform.\n\nIf the network page doesn't appear, disconnect from the Wi-Fi and connect again.`),
        S('gen_popup_blocked', 'device/browser/popup_blocked', 'technical',
            'الزرار مش بيفتح الصفحة الجديدة (نافذة منبثقة)', 'A button does not open the new page (pop-up)',
            'entity_popup:5 symptom_blank_page:1',
            `لو دوست على زرار المفروض يفتح صفحة أو تاب جديدة ومحصلش حاجة، غالبًا المتصفح مانع النوافذ المنبثقة:\n• بصّ في آخر شريط العنوان — هتلاقي أيقونة إن نافذة اتمنعت؛ دوس عليها واختار السماح دايمًا للموقع ده.\n• وبعدين دوس على الزرار تاني.`,
            `If you pressed a button that should open a new page or tab and nothing happened, your browser is probably blocking pop-ups:\n• Look at the end of the address bar — there's an icon saying a window was blocked; click it and choose to always allow this site.\n• Then press the button again.`,
            { alt: ['entity_popup:5 symptom_not_working:1'] })
    ]
};
