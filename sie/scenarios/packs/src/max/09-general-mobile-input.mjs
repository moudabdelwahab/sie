/**
 * Max · عام — الموبايل والكيبورد والروابط. GENERAL (not Mad3oom-specific).
 *
 * How-to and fix answers about phones, keyboards and browsers, true for any
 * site. Egyptian in practice: typing Arabic on a computer, digits shown as
 * ١٢٣, and a site that opens on Wi-Fi but not on the phone's data bundle.
 *
 * Neighbours checked:
 *   Arabic keyboard       ≠ core convo_asks_arabic_reply (reply language), gen_arabic_digits_input
 *   copy & paste how      ≠ gen_mixed_direction_paste (pasted text flips)
 *   link won't open       ≠ gen_link_opens_in_mail_app (opens, in the wrong place)
 *   scan a QR code how    ≠ core howto_link_whatsapp, Pro security_2fa_qr_not_showing
 *   desktop site on phone ≠ core ui_mobile_layout_broken (the mobile layout is broken)
 *   home-screen shortcut  — nothing (no claim of an app)
 *   mic/camera in browser ≠ core app_permission_blocked (the mobile app)
 *   digits shown ١٢٣      ≠ gen_arabic_digits_input (a field refuses them)
 *   Wi-Fi only            ≠ gen_home_internet_blocking (the reverse: data only)
 *   private window how    — nothing (other answers only mention it)
 *
 * @no-legitimate-corpus
 */
import { S, T } from '../dsl.mjs';

export default {
    tokens: [
        T('entity_keyboard', 'الكيبورد', 'keyboard', ['الكيبورد', 'كيبورد', 'لوحه المفاتيح', 'لوحة المفاتيح', 'اللغه العربيه للكيبورد', 'keyboard']),
        T('entity_copy', 'نسخ', 'copy', ['انسخ', 'نسخ', 'انسخه', 'انسخها', 'كوبي', 'كوبي بيست', 'copy', 'copy paste']),
        T('entity_tap_link', 'أدوس على الرابط', 'tapping the link', ['لما ادوس عليه', 'بدوس عليه', 'ادوس عليه', 'tap the link', 'click the link', 'link not clickable']),
        T('entity_desktop_site', 'نسخة الكمبيوتر', 'desktop site', ['نسخه الكمبيوتر', 'نسخة الكمبيوتر', 'عرض سطح المكتب', 'موقع سطح المكتب', 'النسخه الكامله', 'النسخة الكاملة', 'desktop site', 'desktop version', 'request desktop site']),
        T('entity_home_screen', 'الشاشة الرئيسية', 'home screen', ['الشاشه الرييسيه', 'الشاشة الرئيسية', 'الهوم سكرين', 'اختصار للموقع', 'ايقونه للموقع', 'home screen', 'add to home screen']),
        T('entity_microphone', 'الميكروفون', 'microphone', ['الميكروفون', 'الميك', 'المايك', 'مايك', 'microphone', 'mic']),
        T('entity_numbers_shown', 'الأرقام ظاهرة', 'numbers are shown', ['الارقام ظاهره', 'الارقام بتظهر', 'الارقام بقت', 'الارقام طالعه', 'numbers show', 'numbers appear']),
        T('entity_mobile_data', 'الداتا', 'mobile data', ['الداتا', 'داتا', 'باقه النت', 'باقة النت', 'mobile data', 'cellular data', 'cellular']),
        T('entity_wifi', 'الواي فاي', 'Wi-Fi', ['الواي فاي', 'واي فاي', 'الوايفاي', 'wifi']),
        T('entity_private_window', 'نافذة تصفح خفي', 'private window', ['نافذه تصفح خفي', 'نافذة تصفح خفي', 'تصفح خفي', 'التصفح الخفي', 'incognito', 'private window', 'private browsing', 'inprivate'])
    ],
    scenarios: [
        S('gen_arabic_keyboard_computer', 'device/keyboard/add_arabic', 'technical',
            'مش عارف أكتب عربي على الكمبيوتر', 'I can\'t type Arabic on my computer',
            'entity_keyboard:860 entity_arabic_word:139',
            `لازم تضيف العربي للكيبورد مرة واحدة:\n• ويندوز: الإعدادات ← الوقت واللغة ← اللغة والمنطقة ← إضافة لغة ← العربية. وبعدها تبدّل بـ Alt+Shift أو Windows+Space.\n• ماك: إعدادات النظام ← لوحة المفاتيح ← مصادر الإدخال ← (+) ← العربية. والتبديل بـ Control+Space.\n\nولو الحروف مش مطبوعة على الكيبورد، ترتيبها زي أي كيبورد عربي — وفيه ملصقات حروف رخيصة.`,
            `You need to add Arabic to the keyboard once:\n• Windows: Settings ▸ Time & language ▸ Language & region ▸ Add a language ▸ Arabic. Then switch with Alt+Shift or Windows+Space.\n• Mac: System Settings ▸ Keyboard ▸ Input Sources ▸ (+) ▸ Arabic. Switch with Control+Space.\n\nIf the letters aren't printed on the keys, the layout is the standard Arabic one — cheap letter stickers are available.`,
            { alt: ['entity_computer:161 social_asks_arabic:419 entity_keyboard:419'] }),
        S('gen_copy_paste_how', 'device/input/copy_paste_how', 'technical',
            'أنسخ وألصق إزاي', 'How do I copy and paste',
            'entity_copy:4 entity_paste:2 intent_how_to:1',
            `• على الكمبيوتر: حدّد الكلام بالماوس، واضغط Ctrl+C للنسخ، وروح للمكان اللي عايزه واضغط Ctrl+V للصق (على ماك: Cmd بدل Ctrl).\n• على الموبايل: اضغط ضغطة طويلة على الكلمة، وحرّك العلامات لحد ما تحدد الكلام كله ← «نسخ». وفي الخانة اللي عايز تلصق فيها: ضغطة طويلة ← «لصق».`,
            `• On a computer: select the text with the mouse, press Ctrl+C to copy, go where you want it and press Ctrl+V to paste (on a Mac: Cmd instead of Ctrl).\n• On a phone: long-press a word, drag the handles until all the text is selected ▸ "Copy". In the field where you want it: long-press ▸ "Paste".`),
        S('gen_link_not_opening_on_tap', 'device/links/not_clickable', 'technical',
            'الرابط مش بيفتح لما أدوس عليه', 'The link does not open when I tap it',
            'entity_tap_link:4 symptom_blank_page:1 entity_reset_link:1',
            `جرّب تفتحه بنفسك بدل الضغط:\n• اضغط ضغطة طويلة على الرابط ← «نسخ الرابط»، والصقه في شريط العنوان في المتصفح.\n• لو الرابط متقسّم على سطرين في الرسالة، انسخ الجزءين والزقهم من غير مسافة.\n• لو في تطبيق (زي واتساب أو الإيميل) مابيحصلش حاجة، افتح الرسالة من المتصفح أو من تطبيق تاني.\n\nولو الرابط نفسه فتح وقالك منتهي أو غلط، ابعتهولي.`,
            `Try opening it yourself instead of tapping:\n• Long-press the link ▸ "Copy link", and paste it into the browser's address bar.\n• If the link is split over two lines in the message, copy both parts and join them without a space.\n• If nothing happens inside an app (such as WhatsApp or e-mail), open the message from a browser or another app.\n\nIf the link opens but says it has expired or is invalid, send it to me.`),
        S('gen_scan_qr_code_how', 'device/camera/scan_qr_how', 'technical',
            'أعمل مسح لكود QR إزاي', 'How do I scan a QR code',
            'entity_qr_code:3 entity_scan_document:2 intent_how_to:1',
            `• آيفون: افتح الكاميرا ووجّهها على الكود — هيظهر رابط فوق، دوس عليه.\n• أندرويد: افتح الكاميرا أو «عدسة جوجل» ووجّهها على الكود.\n• لو الكود على شاشة الكمبيوتر، قرّب الموبايل لحد ما الكود يملى إطار الكاميرا، وكبّر سطوع الشاشة.\n\nلو الكود ده لربط حاجة أو لتفعيل حماية، افتحه من التطبيق المطلوب نفسه (زي تطبيق المصادقة) مش من الكاميرا.`,
            `• iPhone: open the camera and point it at the code — a link appears at the top; tap it.\n• Android: open the camera or "Google Lens" and point it at the code.\n• If the code is on a computer screen, bring the phone closer until the code fills the camera frame, and raise the screen's brightness.\n\nIf the code is for linking something or enabling protection, scan it from inside the app that asks for it (such as the authenticator app), not the camera.`),
        S('gen_desktop_site_on_phone', 'device/mobile/desktop_site', 'technical',
            'عايز أفتح نسخة الكمبيوتر من الموبايل', 'I want the desktop version on my phone',
            'entity_desktop_site:5 qualifier_mobile:1',
            `من قائمة المتصفح على الموبايل:\n• كروم: القائمة (⋮) ← فعّل «موقع سطح المكتب».\n• سفاري: زرار «aA» في شريط العنوان ← «طلب موقع سطح المكتب».\n\nالشكل هيبقى أصغر — كبّر بإصبعين. ولو في حاجة ناقصة أو مكسورة في شكل الموبايل، قولّي هي أنهي.`,
            `From the browser's menu on your phone:\n• Chrome: the menu (⋮) ▸ turn on "Desktop site".\n• Safari: the "aA" button in the address bar ▸ "Request Desktop Website".\n\nEverything will be smaller — pinch to zoom. If something is missing or broken in the mobile layout, tell me what.`),
        S('gen_add_site_to_home_screen', 'device/mobile/home_screen_shortcut', 'technical',
            'أحط الموقع على الشاشة الرئيسية للموبايل', 'Add the site to my phone\'s home screen',
            'entity_home_screen:4 intent_how_to:1 entity_dashboard:1',
            `تقدر تعمل له أيقونة زي التطبيق:\n• آيفون (سفاري): زرار المشاركة ← «إضافة إلى الشاشة الرئيسية».\n• أندرويد (كروم): القائمة (⋮) ← «إضافة إلى الشاشة الرئيسية».\n\nالأيقونة بتفتح الموقع على طول، وبتفضل مسجّل دخولك طول ما ماسجلتش خروج.`,
            `You can give it an icon like an app:\n• iPhone (Safari): the Share button ▸ "Add to Home Screen".\n• Android (Chrome): the menu (⋮) ▸ "Add to Home screen".\n\nThe icon opens the site directly, and you stay signed in until you sign out.`,
            { alt: ['entity_home_screen:4 qualifier_mobile:1'] }),
        S('gen_browser_mic_camera_blocked', 'device/browser/mic_camera_permission', 'technical',
            'المتصفح مانع الميكروفون أو الكاميرا', 'The browser is blocking the microphone or camera',
            'entity_device_permission:356 entity_microphone:420 entity_browser:223',
            `الإذن ده بيتدّي للموقع من المتصفح نفسه:\n• كروم على الكمبيوتر: دوس على القفل جنب العنوان ← الميكروفون/الكاميرا ← «السماح»، وحدّث الصفحة.\n• كروم على أندرويد: القفل ← الأذونات.\n• سفاري على آيفون: «aA» ← إعدادات موقع الويب ← الميكروفون/الكاميرا ← «سماح».\n\nولو الإذن مسموح ومفيش صوت أو صورة، اتأكد إن مفيش برنامج تاني (زي زوم) ماسك الميكروفون أو الكاميرا.`,
            `The permission is given to the site by the browser itself:\n• Chrome on a computer: click the lock next to the address ▸ Microphone/Camera ▸ "Allow", then refresh.\n• Chrome on Android: the lock ▸ Permissions.\n• Safari on iPhone: "aA" ▸ Website Settings ▸ Microphone/Camera ▸ "Allow".\n\nIf it's allowed but there's no sound or picture, make sure no other program (such as Zoom) is holding the microphone or camera.`,
            { alt: ['entity_microphone:583 entity_browser:223 entity_device_permission:194'] }),
        S('gen_digits_shown_as_arabic_indic', 'device/locale/digits_display', 'technical',
            'الأرقام ظاهرة ١٢٣ بدل 123', 'Numbers show as Arabic-Indic digits (١٢٣)',
            'entity_numbers_shown:3 entity_arabic_digits:3',
            `شكل الأرقام بيتحدد من إعدادات اللغة في جهازك، مش من الموقع:\n• أندرويد: الإعدادات ← النظام ← اللغة ← (حسب الجهاز) «الأرقام» ← الأرقام الغربية 123.\n• آيفون: الإعدادات ← عام ← اللغة والمنطقة ← «الأرقام».\n• ويندوز: الإعدادات ← الوقت واللغة ← المنطقة ← التنسيقات.\n\nالرقم نفسه واحد في الحالتين — ده شكل عرضه بس.`,
            `How digits look is set by your device's language settings, not the site:\n• Android: Settings ▸ System ▸ Language ▸ (depending on the device) "Numbers" ▸ Western digits 123.\n• iPhone: Settings ▸ General ▸ Language & Region ▸ "Numbers".\n• Windows: Settings ▸ Time & language ▸ Region ▸ Formats.\n\nThe number is the same either way — only its display differs.`),
        S('gen_site_works_on_wifi_only', 'device/network/wifi_only', 'technical',
            'الموقع بيفتح على الواي فاي بس، ومش بيفتح على الداتا', 'The site opens on Wi-Fi but not on mobile data',
            'entity_mobile_data:3 entity_wifi:2 symptom_blank_page:1',
            `لو بيفتح على الواي فاي ومش بيفتح على الداتا، المشكلة في الداتا نفسها:\n• اتأكد إن باقة النت لسه فيها رصيد (افتح أي موقع تاني على الداتا).\n• آيفون: الإعدادات ← البيانات الخلوية ← انزل للمتصفح (سفاري أو كروم) واتأكد إنه مسموح له.\n• لو مفعّل «توفير البيانات» في المتصفح أو الموبايل، اقفله مؤقتًا.\n• اقفل الداتا وافتحها، أو اعمل وضع الطيران وشيله.\n\nولو فضلت، ده غالبًا من شبكة الموبايل — جرّب خط تاني لو معاك.`,
            `If it opens on Wi-Fi but not on mobile data, the problem is the data connection itself:\n• Make sure your data bundle still has balance (open any other site on data).\n• iPhone: Settings ▸ Mobile Data ▸ scroll to the browser (Safari or Chrome) and make sure it's allowed.\n• If "Data Saver" is on in the browser or phone, turn it off for now.\n• Turn data off and on, or toggle Airplane mode.\n\nIf it continues, it's most likely the mobile network — try another SIM if you have one.`),
        S('gen_private_window_how', 'device/browser/private_window_how', 'technical',
            'أفتح نافذة تصفح خفي إزاي', 'How do I open a private window',
            'entity_private_window:688 intent_how_to:172 atom_open_action:139',
            `• كروم أو إيدج على الكمبيوتر: Ctrl+Shift+N (على ماك: Cmd+Shift+N).\n• فايرفوكس: Ctrl+Shift+P.\n• سفاري على ماك: Cmd+Shift+N.\n• على الموبايل: من قائمة المتصفح ← «علامة تبويب جديدة للتصفح المتخفي» (كروم)، أو زرار التابات ← «خاص» (سفاري).\n\nفيها لازم تسجّل دخولك من جديد، وكل حاجة بتتمسح أول ما تقفلها.`,
            `• Chrome or Edge on a computer: Ctrl+Shift+N (Mac: Cmd+Shift+N).\n• Firefox: Ctrl+Shift+P.\n• Safari on a Mac: Cmd+Shift+N.\n• On a phone: the browser menu ▸ "New Incognito tab" (Chrome), or the tabs button ▸ "Private" (Safari).\n\nYou'll need to sign in again there, and everything is cleared when you close it.`)
    ]
};
