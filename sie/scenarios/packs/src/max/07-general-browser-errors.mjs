/**
 * Max · عام — رسائل خطأ المتصفح بنصّها. GENERAL (not Mad3oom-specific).
 *
 * Customers paste the browser's own words («This site can't be reached»,
 * «Aw, Snap!», «Cookie Too Large», «تأكيد إعادة إرسال النموذج»). Each names a
 * different cause with a different fix, true for any site. No platform
 * claim except that it needs JavaScript (it is a script-driven web app).
 *
 * Neighbours checked:
 *   site can't be reached   ≠ gen_home_internet_blocking (works elsewhere),
 *                             platform_blank_page (the page LOADS, blank)
 *   400 / cookie too large  ≠ gen_too_many_redirects (a loop)
 *   form resubmission       — nothing
 *   tab crashed             ≠ core app_crashes_on_open (the mobile app)
 *   JavaScript off          ≠ core ui_button_not_responding (a script failed)
 *   unstyled page           ≠ platform_blank_page (nothing shows)
 *   Arabic letters split    ≠ core ui_arabic_rtl_issue (direction), gen_mixed_direction_paste
 *   boxes for characters    ≠ gen_csv_garbled_in_excel (an encoding in Excel)
 * Rejected as not representable: 403 and 429 in the browser — «403» / «429»
 * alone belong to core api_403_forbidden / api_429_rate_limited, and every other word it could use (browser, «الموقع»
 * = dashboard) is capped by core readings: the audit found no feasible
 * signature. And "site images not loading" — «الصور» is the
 * core WhatsApp-media token (entity_wa_media), so it would compete with
 * wa_media_not_displaying on every mention of pictures.
 *
 * @no-legitimate-corpus
 */
import { S, T } from '../dsl.mjs';

export default {
    tokens: [
        T('entity_site_unreachable', 'تعذّر الوصول للموقع', 'site can\'t be reached', ['this site cant be reached', 'site cant be reached', 'cant be reached', 'can t be reached', 'dns probe finished nxdomain', 'nxdomain', 'err name not resolved', 'err connection refused', 'تعذر الوصول', 'لا يمكن الوصول', 'مش قادر اوصل للموقع', 'مش قادر اوصل']),
        T('entity_cookie_too_large', 'الكوكي كبير', 'cookie too large', ['cookie too large', 'header or cookie too large', 'request header too large', 'header too large']),
        T('entity_form_resubmission', 'تأكيد إعادة إرسال النموذج', 'confirm form resubmission', ['تاكيد اعاده ارسال النموذج', 'اعاده ارسال النموذج', 'confirm form resubmission', 'form resubmission', 'resubmit the form', 'resubmission']),
        T('entity_tab_crashed', 'الصفحة وقعت', 'the tab crashed', ['aw snap', 'الصفحه وقعت', 'التاب وقع', 'التبويب وقع', 'page unresponsive', 'الصفحه مش مستجيبه', 'صفحه غير مستجيبه', 'out of memory', 'something went wrong while displaying']),
        T('entity_javascript', 'JavaScript', 'JavaScript', ['الجافاسكريبت', 'جافاسكريبت', 'جافا سكريبت', 'javascript', 'enable javascript', 'js disabled']),
        T('entity_unstyled', 'من غير تصميم', 'without styling', ['من غير شكل', 'من غير تصميم', 'من غير تنسيق', 'من غير الوان', 'كلام بس', 'نص بس', 'no styling', 'unstyled', 'plain text only', 'no css']),
        T('entity_letters_disconnected', 'حروف مقطّعة', 'disconnected letters', ['مقطعه', 'مقطعة', 'متقطعه', 'متقطعة', 'مش متوصله', 'مش متوصلة', 'منفصله', 'منفصلة', 'disconnected']),
        T('entity_boxes', 'مربعات', 'boxes', ['مربعات', 'مربعات فاضيه', 'boxes', 'squares', 'empty boxes'])
    ],
    scenarios: [
        S('gen_site_cant_be_reached', 'device/browser/site_unreachable', 'technical',
            'المتصفح بيقول «تعذّر الوصول إلى هذا الموقع»', 'The browser says "This site can\'t be reached"',
            'entity_site_unreachable:5 entity_browser:1',
            `الرسالة دي معناها إن جهازك مش قادر يوصل لعنوان الموقع أصلًا — المشكلة في الاتصال، مش في حسابك:\n• افتح أي موقع تاني: لو مفيش حاجة بتفتح، النت نفسه واقف.\n• لو المواقع التانية شغالة: جرّب نت الموبايل بدل الواي فاي (أو العكس)، واقفل أي VPN.\n• على أندرويد: لو مفعّل «DNS خاص» (Private DNS)، خليه «تلقائي».\n• اقفل الراوتر دقيقة وشغّله تاني.\n\nولو مش بيفتح على أي شبكة ولا أي جهاز، قولّي.`,
            `This message means your device can't reach the site's address at all — the problem is the connection, not your account:\n• Open any other site: if nothing opens, the internet itself is down.\n• If other sites work: try mobile data instead of Wi-Fi (or the reverse), and turn off any VPN.\n• On Android: if "Private DNS" is on, set it to "Automatic".\n• Turn the router off for a minute and back on.\n\nIf it won't open on any network or device, tell me.`),
        S('gen_http_400_cookie_too_large', 'device/browser/cookie_too_large', 'technical',
            'الصفحة بتقول 400 أو «Cookie Too Large»', 'The page says 400 Bad Request or "Cookie Too Large"',
            'entity_cookie_too_large:5 http_status_400:1',
            `دي غالبًا سببها بيانات موقع قديمة متراكمة في المتصفح:\n• امسح بيانات موقعنا بس (الكوكيز وبيانات الموقع) من إعدادات المتصفح ← الخصوصية.\n• أو جرّب نافذة تصفح خفي — لو اشتغلت، يبقى ده السبب.\n\nوبعدين سجّل دخولك من جديد.`,
            `This is usually caused by old site data piling up in the browser:\n• Clear our site's data only (cookies and site data) from the browser's settings ▸ Privacy.\n• Or try a private window — if it works there, that's the cause.\n\nThen sign in again.`,
            { alt: ['http_status_400:583 entity_browser:223 entity_cache:194'] }),
        S('gen_form_resubmission_prompt', 'device/browser/form_resubmission', 'technical',
            'المتصفح بيسألني «تأكيد إعادة إرسال النموذج»', 'The browser asks to "Confirm Form Resubmission"',
            'entity_form_resubmission:5',
            `الرسالة دي بتظهر لما تعمل تحديث أو ترجع لصفحة كانت بعتت بيانات (زي نموذج أو دفع):\n• متدوسش «متابعة» — ده ممكن يبعت نفس الطلب تاني، ويتكرر الدفع أو الرسالة.\n• افتح الصفحة من القائمة أو اكتب العنوان بدل التحديث.\n• ولو مش متأكد الطلب الأول اتبعت ولا لأ، افتح المكان اللي بيظهر فيه (الطلبات أو التذاكر أو الاشتراك) وشوف.`,
            `This appears when you refresh or go back to a page that had sent data (such as a form or a payment):\n• Don't press "Continue" — it can send the same request again and repeat the payment or message.\n• Open the page from the menu, or type the address, instead of refreshing.\n• If you're not sure the first request went through, open where it would show (requests, tickets or subscription) and check.`),
        S('gen_browser_tab_crashed', 'device/browser/tab_crashed', 'technical',
            'الصفحة وقعت («Aw, Snap!» أو «الصفحة مش مستجيبة»)', 'The tab crashed ("Aw, Snap!" or "Page unresponsive")',
            'entity_tab_crashed:5 entity_browser:1',
            `دي معناها إن تبويب المتصفح نفسه وقع — مش الموقع:\n• اعمل تحديث للصفحة.\n• اقفل التابات والبرامج اللي مش محتاجها — الغالب إن ذاكرة الجهاز خلصت.\n• حدّث المتصفح لآخر نسخة.\n• جرّب نافذة تصفح خفي؛ لو اشتغلت، إضافة من الإضافات هي السبب.\n\nولو بتقع في صفحة واحدة بالذات كل مرة، قولّي هي أنهي.`,
            `This means the browser tab itself crashed — not the site:\n• Reload the page.\n• Close tabs and programs you don't need — the device most likely ran out of memory.\n• Update the browser to the latest version.\n• Try a private window; if it works there, one of your extensions is the cause.\n\nIf it crashes on one particular page every time, tell me which.`),
        S('gen_javascript_disabled', 'device/browser/javascript_disabled', 'technical',
            'المتصفح بيقول فعّل JavaScript', 'The browser says to enable JavaScript',
            'entity_javascript:5 entity_browser:1',
            `المنصة محتاجة JavaScript يكون شغّال في المتصفح:\n• كروم: الإعدادات ← الخصوصية والأمان ← إعدادات المواقع ← JavaScript ← «يمكن للمواقع استخدام JavaScript».\n• سفاري (آيفون): الإعدادات ← سفاري ← متقدم ← JavaScript.\n• إضافات زي NoScript بتقفله — ضيف موقعنا للمسموح.\n\nوبعدين حدّث الصفحة.`,
            `The platform needs JavaScript enabled in the browser:\n• Chrome: Settings ▸ Privacy and security ▸ Site settings ▸ JavaScript ▸ "Sites can use JavaScript".\n• Safari (iPhone): Settings ▸ Safari ▸ Advanced ▸ JavaScript.\n• Extensions such as NoScript block it — add our site to the allowed list.\n\nThen refresh the page.`),
        S('gen_page_unstyled', 'device/browser/page_unstyled', 'technical',
            'الصفحة ظاهرة كلام بس من غير تصميم', 'The page shows as plain text without its design',
            'entity_unstyled:5 entity_dashboard:1',
            `لو الصفحة ظاهرة كلام وروابط بس من غير ألوان ولا ترتيب، يبقى ملفات التصميم ماتحمّلتش:\n• اعمل تحديث قسري (Ctrl+Shift+R).\n• اقفل مانع الإعلانات أو أي إضافة بتحجب محتوى.\n• لو على شبكة شغل أو فيها فلتر، ممكن تكون حاجبة ملفات من الموقع — جرّب نت تاني.\n• جرّب نافذة تصفح خفي.`,
            `If the page shows only text and links, with no colours or layout, its design files didn't load:\n• Do a hard refresh (Ctrl+Shift+R).\n• Turn off your ad blocker or any extension that blocks content.\n• A work or filtered network may be blocking files from the site — try another connection.\n• Try a private window.`),
        S('gen_arabic_letters_disconnected', 'device/display/arabic_letters_disconnected', 'technical',
            'الحروف العربي ظاهرة مقطّعة (مش متوصلة ببعض)', 'Arabic letters show disconnected',
            'entity_letters_disconnected:860 entity_arabic_word:139',
            `الحروف العربي بتظهر مقطّعة لما الخط أو المتصفح مش بيوصّل الحروف ببعض صح:\n• حدّث المتصفح.\n• لو مفعّل خط مخصّص، أو إضافة بتغيّر الخطوط، أو وضع القراءة — اقفلها.\n• لو الترجمة التلقائية شغالة، اقفلها للموقع.\n• على جهاز قديم جدًا، جرّب متصفح تاني زي كروم أو فايرفوكس.`,
            `Arabic letters show disconnected when the font or the browser doesn't join them properly:\n• Update the browser.\n• If a custom font, a font-changing extension or reading mode is on — turn it off.\n• If automatic translation is on, turn it off for the site.\n• On a very old device, try another browser such as Chrome or Firefox.`),
        S('gen_characters_show_as_boxes', 'device/display/characters_as_boxes', 'technical',
            'الإيموجي أو الحروف ظاهرة مربعات', 'Emoji or letters show as empty boxes',
            'entity_boxes:4 social_emoji_only:1',
            `المربعات الفاضية مكان الحروف أو الإيموجي معناها إن الجهاز مفيهوش خط بيعرض الرموز دي:\n• حدّث نظام التشغيل والمتصفح — التحديثات بتضيف خطوط الإيموجي الجديدة.\n• لو الحروف العربي نفسها مربعات، الجهاز محتاج إعدادات اللغة العربية أو خط عربي.\n\nالرسالة نفسها سليمة — اللي يفتحها على جهاز أحدث هيشوفها عادي.`,
            `Empty boxes in place of letters or emoji mean the device has no font that can show those characters:\n• Update the operating system and the browser — updates add fonts for newer emoji.\n• If the Arabic letters themselves are boxes, the device needs Arabic language settings or an Arabic font.\n\nThe message itself is fine — anyone opening it on a newer device will see it normally.`)
    ]
};
