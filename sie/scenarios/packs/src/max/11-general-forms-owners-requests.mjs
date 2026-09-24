/**
 * Max · عام — النماذج والاستخدام، أصحاب المواقع، وطلبات للفريق.
 * GENERAL (not Mad3oom-specific).
 *
 * Forms and search: how web forms and search boxes behave anywhere. Site
 * owners: where builders put custom code (their own documentation), and
 * what a Content-Security-Policy refusal means. Requests for the team:
 * situations every SaaS gets that need a human decision and a record — the
 * scenario collects the request and opens a ticket; it claims nothing about
 * what the team will decide.
 *
 * Neighbours checked:
 *   save button greyed      ≠ core ui_button_not_responding (enabled, does nothing)
 *   field turns red         ≠ gen_arabic_digits_input (one specific cause)
 *   undo a change           ≠ core data_restore_deleted (something deleted)
 *   can't find a setting    — a clarifying answer; ≠ core ui_search_no_results
 *   Arabic search spelling  ≠ core ui_search_no_results / ticket_search_not_finding
 *                             (search broken — this is how Arabic is spelled)
 *   code on a site builder  ≠ core widget_not_loading_some_pages (installed, missing)
 *   CSP refusal             ≠ core chat_widget_not_working (no cause named)
 *   ownership transfer      ≠ core convo_previous_employee_left (who follows up)
 *   merge two accounts      ≠ gen_switch_between_accounts, core ticket_merge_request (tickets)
 *   security vulnerability  ≠ Pro email_phishing_suspected (a message to them)
 *   account owner died      ≠ core convo_condolence (a greeting, not an account)
 * «ليس لديك صلاحية» is vocabulary (a synonym for the base
 * symptom_permission_denied), not a scenario.
 *
 * @no-legitimate-corpus
 */
import { S, T } from '../dsl.mjs';

export default {
    tokens: [
        T('entity_save_word', 'الحفظ', 'save', ['الحفظ', 'زرار الحفظ', 'زر الحفظ', 'save button']),
        T('entity_greyed_out', 'رمادي', 'greyed out', ['رمادي', 'رماديه', 'باهت', 'مطفي', 'greyed out', 'grayed out', 'disabled button']),
        T('entity_red_field', 'بتحمر', 'turns red', ['بتحمر', 'بيحمر', 'احمر', 'حمرا', 'لونها احمر', 'باللون الاحمر', 'turns red', 'red border', 'highlighted in red']),
        T('entity_undo', 'أرجّعه زي ما كان', 'undo', ['ارجعه', 'ارجعها', 'ارجع التعديل', 'ارجعه زي ما كان', 'زي ما كان', 'undo', 'تراجع', 'revert']),
        T('entity_setting_word', 'الإعداد', 'the setting', ['الاعداد ده', 'الخاصيه دي', 'الخاصية دي', 'الاوبشن ده', 'this setting', 'this option']),
        T('entity_spelling', 'الإملاء', 'spelling', ['بالهمزه', 'الهمزه', 'همزه', 'بالتاء', 'التاء', 'الالف', 'ي ولا ى', 'ه ولا ة']),
        T('entity_not_finding', 'مش بيلاقي', 'not finding', ['مش بيلاقي', 'مابيلاقيش', 'مبيلاقيش', 'مش بيطلع', 'مش بيجيب', 'doesnt find', 'not finding']),
        T('entity_site_builder', 'ووردبريس / شوبيفاي / ويكس', 'site builder', ['ووردبريس', 'وورد بريس', 'wordpress', 'shopify', 'wix', 'ويكس', 'blogger', 'بلوجر', 'gtm', 'webflow']),
        T('entity_csp', 'سياسة أمان المحتوى', 'Content Security Policy', ['refused to load', 'refused to connect', 'refused to frame', 'violates', 'csp']),
        T('entity_ownership', 'ملكية الحساب', 'account ownership', ['ملكيه', 'ملكية', 'انقل الملكيه', 'نقل الملكيه', 'صاحب الحساب الجديد', 'transfer ownership', 'account owner']),
        T('entity_merge_word', 'أدمج', 'merge', ['ادمجهم', 'ندمج', 'دمجهم', 'merge them', 'merge accounts', 'combine accounts']),
        T('entity_vulnerability', 'ثغرة أمنية', 'security vulnerability', ['ثغره', 'ثغرة', 'ثغره امنيه', 'ثغرة أمنية', 'vulnerability', 'xss', 'sql injection', 'responsible disclosure']),
        T('entity_deceased', 'اتوفى', 'passed away', ['اتوفى', 'اتوفي', 'توفى', 'توفي', 'الله يرحمه', 'الله يرحمها', 'passed away', 'deceased'])
    ],
    scenarios: [
        S('gen_save_button_disabled', 'forms/save/button_greyed', 'technical',
            'زرار الحفظ رمادي ومش بيتداس', 'The save button is greyed out',
            'entity_greyed_out:430 entity_save_word:430 atom_button:139',
            `زرار الحفظ بيفضل رمادي لحد ما النموذج يبقى جاهز يتحفظ:\n• فيه خانة إجبارية فاضية — دوّر على علامة (*) أو خانة عليها تنبيه، وانزل لآخر الصفحة.\n• فيه خانة قيمتها مش مقبولة (بتبقى بلون أحمر أو تحتها رسالة صغيرة).\n• لو ماغيّرتش حاجة، الزرار بيفضل مقفول لأنه مفيش حاجة تتحفظ.\n\nولو كل ده مظبوط وبرضه رمادي، قولّي انت في أنهي صفحة.`,
            `A save button stays grey until the form is ready to save:\n• A required field is empty — look for an asterisk (*) or a field with a warning, and scroll to the bottom of the page.\n• A field has a value that isn't accepted (usually shown in red or with a small message under it).\n• If you haven't changed anything, the button stays disabled because there's nothing to save.\n\nIf all of that is fine and it's still grey, tell me which page you're on.`),
        S('gen_form_field_turns_red', 'forms/validation/field_red', 'technical',
            'الخانة بتحمر ومش راضية تقبل اللي بكتبه', 'A form field turns red and won\'t accept what I type',
            'entity_red_field:810 entity_form_field:190',
            `الخانة الحمرا معناها إن القيمة مش بالشكل المطلوب — اقرا الرسالة الصغيرة اللي تحتها أو جنبها. الأسباب الأشهر:\n• الإيميل: لازم يبقى فيه @ ونقطة، ومن غير مسافات.\n• رقم الموبايل: أرقام بس، بالأرقام الإنجليزي (123)، ومن غير مسافات أو شرط.\n• الخانة إجبارية واتسابت فاضية.\n• النص أقصر أو أطول من المسموح.\n\nلو مش واضح المطلوب، ابعتلي اسم الخانة واللي بتكتبه (من غير كلمات مرور).`,
            `A red field means the value isn't in the required form — read the small message under or next to it. The most common causes:\n• E-mail: it needs an @ and a dot, with no spaces.\n• Phone number: digits only, as Western digits (123), with no spaces or dashes.\n• The field is required and was left empty.\n• The text is shorter or longer than allowed.\n\nIf it's not clear what's needed, send me the field's name and what you're typing (no passwords).`),
        S('gen_undo_accidental_change', 'forms/edit/undo_change', 'technical',
            'عملت تعديل بالغلط وعايز أرجّعه', 'I changed something by mistake and want to undo it',
            'entity_undo:720 atom_by_mistake:139 atom_change:139',
            `• لو لسه ماحفظتش: اخرج من الصفحة من غير حفظ، أو اضغط Ctrl+Z (على ماك Cmd+Z) جوه الخانة.\n• لو حفظت: رجّع القيمة القديمة بإيدك لو فاكرها، واحفظ تاني.\n• لو التعديل مسح حاجة (رسالة، ملف، عنصر)، قولّي إيه اللي اتمسح وإمتى تقريبًا، وأنا أشوف إمكانية الاسترجاع مع الفريق.`,
            `• If you haven't saved yet: leave the page without saving, or press Ctrl+Z (Cmd+Z on a Mac) inside the field.\n• If you saved: put the old value back by hand if you remember it, and save again.\n• If the change deleted something (a message, a file, an item), tell me what was deleted and roughly when, and I'll check with the team whether it can be restored.`),
        S('gen_cannot_find_setting', 'forms/navigation/cannot_find_setting', 'technical',
            'مش لاقي الإعداد أو الاختيار اللي بيقولوا عليه', 'I can\'t find the setting or option I was told about',
            'entity_setting_word:570 symptom_disappeared:290 atom_where:139',
            `قولّي اسم اللي بتدوّر عليه، أو إنت عايز تعمل إيه بيه، وأنا أقولك مكانه بالظبط.\n\nولحد ما تقولّي: أغلب الإعدادات بتبقى في القائمة الجانبية أو من صورة حسابك فوق — وعلى الموبايل القائمة بتتفتح من زرار (☰). ولو الاختيار مش ظاهر خالص، ممكن يكون مرتبط بصلاحية حسابك أو بباقتك.`,
            `Tell me the name of what you're looking for, or what you want to do with it, and I'll tell you exactly where it is.\n\nMeanwhile: most settings live in the side menu or under your profile picture at the top — on a phone the menu opens from the (☰) button. If the option doesn't appear at all, it may depend on your account's permissions or your plan.`),
        S('gen_arabic_search_spelling', 'search/arabic/spelling_variants', 'technical',
            'البحث مش بيلاقي عشان الهمزة أو التاء المربوطة', 'Search misses results because of Arabic spelling (hamza, taa marbuta)',
            'entity_spelling:3 entity_not_finding:2 entity_search:2',
            `البحث في كتير من الأنظمة بيدوّر على الكتابة زي ما هي، فـ «أحمد» غير «احمد»، و«مدرسة» غير «مدرسه». جرّب:\n• من غير همزة: «احمد» بدل «أحمد».\n• التاء المربوطة والهاء: «مدرسه» و«مدرسة».\n• الياء والألف المقصورة: «مصطفي» و«مصطفى».\n• جزء من الكلمة بس، أو ابحث برقم الموبايل أو الإيميل بدل الاسم.`,
            `Search in many systems matches the spelling exactly, so «أحمد» differs from «احمد» and «مدرسة» from «مدرسه». Try:\n• Without the hamza: «احمد» instead of «أحمد».\n• Taa marbuta and haa: both «مدرسه» and «مدرسة».\n• Yaa and alif maqsura: both «مصطفي» and «مصطفى».\n• Only part of the word, or search by phone number or e-mail instead of the name.`),
        S('gen_install_code_site_builder', 'website/install/site_builder_code', 'technical',
            'أحط الكود في موقعي على ووردبريس أو شوبيفاي أو ويكس', 'Add the code to my WordPress, Shopify or Wix site',
            'entity_site_builder:860 atom_code:139',
            `كل منصة ليها مكان للكود الإضافي — الكود بيتحط في آخر الصفحة (قبل نهاية الـ body) في كل الصفحات:\n• ووردبريس: إضافة زي «WPCode» ← Footer، أو من القالب: المظهر ← محرر القالب ← footer.php.\n• شوبيفاي: المتجر الإلكتروني ← القوالب ← (…) ← تعديل الكود ← theme.liquid ← قبل نهاية الـ body.\n• ويكس: الإعدادات ← الكود المخصص ← إضافة كود ← «Body — end» ← كل الصفحات.\n• Google Tag Manager: وسم «HTML مخصص» على «كل الصفحات».\n\nبعد الحفظ افتح الموقع في نافذة تصفح خفي — إضافات الكاش ساعات بتأخر ظهوره.`,
            `Each platform has a place for extra code — it goes at the very end of the page (just before the body closes) on every page:\n• WordPress: a plugin such as "WPCode" ▸ Footer, or in the theme: Appearance ▸ Theme File Editor ▸ footer.php.\n• Shopify: Online Store ▸ Themes ▸ (…) ▸ Edit code ▸ theme.liquid ▸ just before the body closes.\n• Wix: Settings ▸ Custom Code ▸ Add Custom Code ▸ "Body — end" ▸ All pages.\n• Google Tag Manager: a "Custom HTML" tag on "All Pages".\n\nAfter saving, open your site in a private window — caching plugins sometimes delay it appearing.`),
        S('gen_csp_blocks_script', 'website/security/csp_refused', 'technical',
            'Console بيقول «Refused to load … Content Security Policy»', 'The console says "Refused to load … Content Security Policy"',
            'entity_csp:860 atom_security:139',
            `ده معناه إن موقعك نفسه عامل «سياسة أمان محتوى» (CSP) بتسمح بمصادر معيّنة بس، والسكربت جه من مصدر مش في القائمة:\n• في رسالة الخطأ هتلاقي الرابط اللي اترفض والتوجيه (زي script-src أو connect-src أو frame-src).\n• ضيف دومين الرابط ده للتوجيه نفسه في الـ CSP بتاع موقعك (من إعدادات السيرفر أو الـ headers أو إضافة الأمان).\n\nلو مش انت اللي بتدير الموقع، ابعت الرسالة دي للمطوّر.`,
            `This means your own site has a Content Security Policy (CSP) that only allows certain sources, and the script came from one not on the list:\n• The error names the refused URL and the directive (such as script-src, connect-src or frame-src).\n• Add that URL's domain to the same directive in your site's CSP (in the server config, the headers, or a security plugin).\n\nIf you don't manage the site yourself, send this message to your developer.`,
            { alt: ['entity_csp:688 atom_security:139 entity_policy_word:172'] }),
        S('gen_transfer_account_ownership', 'account/requests/transfer_ownership', 'account',
            'عايز أنقل ملكية الحساب لشخص تاني', 'I want to transfer the account\'s ownership to someone else',
            'entity_ownership:4 entity_account:1',
            null, null,
            { alt: ['entity_ownership:4 entity_colleague:1'] }),
        S('gen_merge_two_accounts', 'account/requests/merge_accounts', 'account',
            'عندي حسابين وعايز أدمجهم', 'I have two accounts and want to merge them',
            'entity_merge_word:3 entity_two_accounts:3',
            null, null),
        S('gen_report_security_vulnerability', 'security/requests/vulnerability_report', 'security',
            'لقيت ثغرة أمنية وعايز أبلّغ عنها', 'I found a security vulnerability and want to report it',
            'entity_vulnerability:5',
            null, null),
        S('gen_account_owner_deceased', 'account/requests/owner_deceased', 'account',
            'صاحب الحساب اتوفّى', 'The account holder has passed away',
            'entity_deceased:4 entity_account:2',
            null, null)
    ]
};
