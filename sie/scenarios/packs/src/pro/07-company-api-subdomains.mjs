/**
 * Pro · لوحة الشركة، مفاتيح الـ API، والنطاقات الفرعية.
 *
 * Facts:
 *  - company-model.js: two roles ("مدير الشركة" / "عضو في الشركة");
 *    member management and company-profile edits require the admin role;
 *  - company-api.js: creating keys needs the api_tokens entitlement
 *    ("إنشاء المفاتيح متاح للباقات التي تمنح ميزة api_tokens"); key states
 *    active / disabled ("موقوف") / expired ("منتهٍ") / revoked ("مسحوب");
 *    stop/activate confirmation; "بلا صلاحيات محدَّدة", "بلا تاريخ انتهاء";
 *    the calls log is empty until a key is used; 60 calls/min (KB audit);
 *  - customer webhooks: no customer UI — admin/settings only (KB audit §3);
 *  - request-subdomain.html: name regex ^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$,
 *    availability check, statuses under review / approved / rejected with a
 *    note; renaming and deleting are admin actions.
 *
 * @no-legitimate-corpus
 */
import { S, T } from '../dsl.mjs';

export default {
    tokens: [
        T('entity_no_permission_msg', 'رسالة لا تملك صلاحية', '"you do not have permission" message', ['لا تملك صلاحية', 'مش مسموحلي', 'مش مسموح لي', 'مش من حقي', 'not allowed']),
        T('intent_create_key', 'إنشاء مفتاح', 'create a key', ['انشاء مفتاح', 'اعمل مفتاح', 'انشئ مفتاح', 'مفتاح جديد', 'create key']),
        T('entity_key_word', 'المفتاح', 'the key', ['المفتاح', 'مفتاح', 'مفاتيح', 'المفاتيح', 'key']),
        T('entity_key_state', 'حالة المفتاح', 'key state', ['موقوف', 'مسحوب', 'منتهٍ', 'revoked']),
        T('intent_toggle_key', 'إيقاف أو تفعيل المفتاح', 'stop or activate a key', ['اوقف المفتاح', 'افعل المفتاح', 'ايقاف المفتاح', 'تفعيل المفتاح', 'deactivate key', 'activate key']),
        T('entity_call_log', 'سجل النداءات', 'calls log', ['سجل النداءات', 'النداءات', 'calls log']),
        T('entity_key_no_scopes', 'مفتاح بلا صلاحيات', 'key without scopes', ['بلا صلاحيات', 'من غير صلاحيات', 'بلا تاريخ انتهاء', 'no scopes']),
        T('entity_calls_per_minute', 'نداءات في الدقيقة', 'calls per minute', ['نداء في الدقيقة', 'في الدقيقة', 'calls per minute', 'per minute']),
        T('entity_developers_word', 'المطورين', 'developers', ['المطورين', 'للمطورين', 'developers']),
        T('entity_subdomain_name_format', 'صيغة اسم النطاق', 'subdomain name format', ['صيغة الاسم', 'صيغه الاسم', 'الاسم غلط', 'حروف كابيتال', 'invalid name']),
        T('symptom_name_taken', 'الاسم متاخد', 'name taken', ['محجوز', 'متاخد', 'مش متاح', 'غير متاح', 'taken', 'unavailable'])
    ],
    scenarios: [
        S('company_member_cannot_manage_members', 'team/member_management/permission_denied', 'other',
            'مش قادر أضيف أو أشيل أعضاء — بيقولي مالكش صلاحية', "Can't add or remove members — no permission",
            'atom_member:2 entity_no_permission_msg:2 intent_add:2',
            `إدارة الأعضاء (إضافة وإزالة) متاحة لدور «مدير الشركة» بس. لو دورك «عضو في الشركة»، الزرار مش هيشتغل معاك.\n\nاطلب من مدير الشركة يضيف العضو، أو يغيّر دورك لو المفروض تدير الأعضاء. ولو مفيش مدير متاح للشركة خالص، قولّي وأفتحلك تذكرة.`,
            `Member management (adding and removing) is available to the "Company admin" role only. If your role is "Company member", it won't work for you.\n\nAsk a company admin to add the member, or to change your role if you should manage members. If no admin is available at all, tell me and I'll open a ticket.`,
            { alt: ['atom_member:2 symptom_permission_denied:2 intent_add:2'] }),
        S('company_profile_edit_admin_only', 'account/company_profile/edit_permission', 'other',
            'مش قادر أعدّل بيانات الشركة', "I can't edit the company details",
            'atom_company:2 atom_change:2 symptom_permission_denied:2',
            `تعديل بيانات الشركة في «لوحة الشركة» متاح لمدير الشركة بس، فلو دورك «عضو» الزرار مش هيظهرلك أو مش هيحفظ.\n\nاطلب من مدير الشركة يعدّلها. وخد بالك إن إيميل الدخول نفسه مابيتغيرش من هنا — تغييره بيتم عن طريق فريق الدعم.`,
            `Editing company details in the "Company dashboard" is available to the company admin only, so as a "member" you won't see the button or it won't save.\n\nAsk a company admin to update them. Note that the sign-in e-mail itself isn't changed here — that's done through the support team.`,
            { alt: ['atom_company:3 symptom_cannot_edit:3', 'atom_company:2 atom_change:2 entity_no_permission_msg:2'] }),
        S('api_create_key_unavailable', 'api/key/create_unavailable', 'api',
            'مش قادر أنشئ مفتاح API', "I can't create an API key",
            'intent_create_key:3 symptom_not_visible:2 entity_api:1',
            `إنشاء مفاتيح الـ API من «لوحة الشركة» ← الـ API متاح بس للباقات اللي فيها ميزة مفاتيح الـ API. لو باقتك مافيهاش، هتلاقي رسالة بكده وزرار «استعراض الباقات».\n\nلو باقتك فيها الميزة ولسه مش قادر، ممكن تكون المشكلة في دورك — إدارة المفاتيح بتحتاج صلاحية. قولّي وأشوف معاك.`,
            `Creating API keys from the "Company dashboard" → API is available only on plans that include the API keys feature. If yours doesn't, you'll see a message saying so and a "Browse plans" button.\n\nIf your plan includes it and you still can't, it may be your role — managing keys needs permission. Tell me and I'll check with you.`,
            { alt: ['entity_api_key:3 entity_cannot_make:3', 'intent_create_key:3 symptom_permission_denied:2 entity_api:1'] }),
        S('api_key_state_meaning', 'api/key/state_meaning', 'api',
            'حالة مفتاح الـ API (موقوف / منتهي / مسحوب)', 'API key state (stopped / expired / revoked)',
            'entity_key_state:3 entity_key_word:3',
            `حالات المفتاح في قسم الـ API:\n• فعّال: شغال.\n• موقوف: اتوقف يدويًا، وتقدر تفعّله تاني.\n• منتهٍ: عدّى تاريخ انتهائه — اعمل مفتاح جديد.\n• مسحوب: اتلغى نهائيًا ومابيرجعش.\n\nأي طلب بمفتاح مش فعّال بيترفض، فلو أنظمتك وقفت فجأة بص على حالة المفتاح الأول.`,
            `Key states in the API section:\n• Active: working.\n• Stopped: disabled manually; you can activate it again.\n• Expired: past its end date — create a new key.\n• Revoked: cancelled permanently; it can't come back.\n\nAny request with a non-active key is rejected, so if your systems stopped suddenly, check the key's state first.`,
            { alt: ['symptom_expired:3 entity_key_word:3'] }),
        S('api_key_stop_or_activate', 'api/key/toggle', 'api',
            'أوقف أو أفعّل مفتاح API', 'Stop or activate an API key',
            'intent_toggle_key:4 entity_api:1',
            `من «لوحة الشركة» ← الـ API، جنب كل مفتاح زرار «إيقاف» أو «تفعيل»، وبيطلب منك تأكيد.\n\nالمفتاح الموقوف بيترفض فورًا مع أي طلب، ولما تفعّله بيتقبل تاني. لو شاكك إن مفتاح اتسرّب، الإيقاف أسرع خطوة لحد ما تعمل مفتاح جديد.`,
            `From the "Company dashboard" → API, each key has a "Stop" or "Activate" button, with a confirmation.\n\nA stopped key is rejected immediately on any request, and accepted again once activated. If you suspect a key leaked, stopping it is the fastest step until you create a new one.`),
        S('api_calls_log_empty', 'api/usage_log/empty', 'api',
            'سجل النداءات فاضي', 'The API calls log is empty',
            'entity_call_log:4 entity_api:1',
            `سجل النداءات بيبدأ يتملّى أول ما أي مفتاح يتستخدم فعلًا — قبل كده بيظهر «لا توجد نداءات مسجّلة»، وجنب المفتاح «لم يُستخدم بعد».\n\nلو أنظمتك بتبعت طلبات والسجل لسه فاضي، يبقى الطلبات مش واصلة بالمفتاح ده: راجع إنك حاطط المفتاح الصح في هيدر Authorization وإنه «فعّال».`,
            `The calls log fills as soon as any key is actually used — before that it shows "No calls recorded" and the key shows "Not used yet".\n\nIf your systems are sending requests and the log is still empty, the requests aren't arriving with that key: check you're sending the right key in the Authorization header and that it's "Active".`),
        S('api_key_scopes_expiry_meaning', 'api/key/scopes_expiry_meaning', 'api',
            'مكتوب «بلا صلاحيات محددة» أو «بلا تاريخ انتهاء»', '"No specific permissions" or "No expiry" on a key',
            'entity_key_no_scopes:4 entity_key_word:1',
            `الوصفين دول بيظهروا تحت المفتاح:\n• «بلا صلاحيات محددة»: المفتاح مااتحددلوش صلاحيات بعينها.\n• «بلا تاريخ انتهاء»: المفتاح شغال لحد ما يتوقف أو يتسحب.\n\nللأمان، الأفضل مفتاح لكل نظام بأقل صلاحيات يحتاجها وبتاريخ انتهاء — ومراجعة المفاتيح القديمة وإيقاف اللي مش مستخدم.`,
            `These appear under a key:\n• "No specific permissions": no particular permissions were set for it.\n• "No expiry": the key works until it's stopped or revoked.\n\nFor security, prefer one key per system, with the least permissions it needs and an expiry date — and review old keys, stopping unused ones.`),
        S('api_calls_per_minute_limit', 'api/rate_limit/value', 'api',
            'حد نداءات الـ API كام في الدقيقة', "What is the API's per-minute limit",
            'entity_calls_per_minute:4 entity_api:1',
            `الحد لمفاتيح الـ API ٦٠ نداء في الدقيقة. لو عدّيته الطلبات بترجع 429 لحد ما الدقيقة تعدي.\n\nنصايح عشان ماتوصلش للحد: جمّع الطلبات بدل ما تبعتها واحد واحد، وخزّن النتايج اللي مش بتتغير كتير، ولما يرجع 429 استنى وزوّد مدة الانتظار تدريجيًا بدل ما تعيد فورًا.`,
            `The limit for API keys is 60 calls per minute. Beyond it, requests return 429 until the minute passes.\n\nTo stay under it: batch requests instead of sending them one by one, cache results that rarely change, and on a 429 wait and back off gradually rather than retrying immediately.`),
        S('api_register_webhook_how', 'webhook/registration/customer_path', 'api',
            'أسجّل Webhook لأحداث التذاكر إزاي', 'How to register a webhook for ticket events',
            'entity_webhook:3 intent_add:2 intent_how_to:1',
            `تسجيل الـ Webhooks مش متاح من حسابك — إعداده بيتم من فريق المنصة. قولّي «افتح تذكرة» مع رابط الـ endpoint بتاعك والأحداث اللي عايزها، وأنا أبعت الطلب.\n\nولحد ما يتظبط، تقدر تسحب البيانات بنفسك بمفتاح API من «لوحة الشركة» ← الـ API.`,
            `Registering webhooks isn't available from your account — the platform team sets it up. Say "open a ticket" with your endpoint URL and the events you need, and I'll send the request.\n\nUntil it's set up, you can pull the data yourself with an API key from the "Company dashboard" → API.`,
            { alt: ['entity_webhook:3 atom_register:2 entity_ticket:1'] }),
        S('api_mcp_what_is', 'integration/mcp/what_is', 'inquiry',
            'الـ MCP ده إيه وأستخدمه إزاي', 'What MCP is and how to use it',
            'entity_mcp:3 entity_developers_word:2 intent_how_to:1',
            `الـ MCP طريقة بتخلّي أدوات الذكاء الاصطناعي (زي المساعدين في محررات الكود أو تطبيقات الشات) تتصل ببيانات حسابك في مدعوم وتنفّذ عليها عمليات بإذنك.\n\nالإعداد والشرح في صفحة MCP الخاصة بالمطورين. لو الاتصال نفسه بيفشل، قولّي رسالة الخطأ.`,
            `MCP lets AI tools (such as assistants in code editors or chat apps) connect to your Mad3oom account data and perform actions with your permission.\n\nSetup and guidance are on the developers' MCP page. If the connection itself fails, tell me the error message.`,
            { alt: ['entity_mcp:3 entity_api_docs:2', 'entity_mcp:3 intent_how_to:3'] }),
        S('subdomain_name_format_rejected', 'domain/subdomain_request/name_format', 'other',
            'اسم النطاق الفرعي مش مقبول (صيغة غلط)', 'Subdomain name rejected (invalid format)',
            'entity_subdomain_name_format:3 entity_subdomain:3 symptom_rejected:1',
            `اسم النطاق الفرعي لازم:\n• يكون بالإنجليزي، حروف صغيرة وأرقام بس، وممكن شرطة (-) في النص.\n• مايبدأش ولا يخلص بشرطة.\n• لحد ٦٣ حرف.\n\nمثال مقبول: my-store أو shop2025. غير مقبول: My_Store أو -shop.`,
            `A subdomain name must:\n• be in English, lowercase letters and digits only, with hyphens (-) allowed in the middle;\n• not start or end with a hyphen;\n• be at most 63 characters.\n\nAccepted: my-store or shop2025. Not accepted: My_Store or -shop.`,
            { alt: ['entity_subdomain_name_format:3 entity_subdomain:3'] }),
        S('subdomain_name_taken', 'domain/subdomain_request/name_taken', 'other',
            'اسم النطاق الفرعي اللي عايزه مش متاح', 'The subdomain name I want is taken',
            'symptom_name_taken:3 entity_subdomain:3',
            `«التحقق من توافر الاسم» بيقول إن الاسم محجوز لو في نطاق تاني بيه أو طلب قبلك. جرّب:\n• تضيف كلمة تميّزك: اسمك-eg أو اسمك-shop.\n• تستخدم اختصار اسم شركتك.\n\nلو الاسم ده علامتك التجارية ومحجوز لحد تاني، قولّي وأفتحلك تذكرة للمراجعة.`,
            `"Check availability" says a name is taken when another subdomain or an earlier request already uses it. Try:\n• adding a distinguishing word: yourname-eg or yourname-shop;\n• your company's abbreviation.\n\nIf the name is your trademark and someone else holds it, tell me and I'll open a ticket for review.`),
        S('subdomain_request_rejected', 'domain/subdomain_request/rejected', 'other',
            'طلب النطاق الفرعي اترفض', 'My subdomain request was rejected',
            'entity_subdomain:3 symptom_rejected:3',
            `الطلب المرفوض بيظهر في «طلباتي» بحالة «مرفوض»، وغالبًا معاه ملاحظة بالسبب (زي اسم مش مناسب أو مكرر).\n\nاقرا الملاحظة وابعت طلب جديد باسم مختلف. ولو مفيش ملاحظة أو مش مقتنع بالسبب، قولّي وأفتحلك تذكرة.`,
            `A rejected request shows in "My requests" with status "Rejected", usually with a note giving the reason (an unsuitable or duplicate name, for example).\n\nRead the note and submit a new request with a different name. If there's no note or you disagree, tell me and I'll open a ticket.`),
        S('subdomain_rename_or_delete', 'domain/subdomain/rename_or_delete', 'other',
            'عايز أغيّر اسم النطاق الفرعي أو أمسحه', 'Rename or delete my subdomain',
            'entity_subdomain:3 atom_change:2 atom_remove:1',
            `تغيير اسم نطاق فرعي شغال أو حذفه بيتم من فريق المنصة، مش من حسابك. قولّي الاسم الحالي والجديد (أو إنك عايز تحذفه) وأنا أفتحلك تذكرة.\n\nخد بالك: بعد تغيير الاسم الرابط القديم بيوقف، فحدّث أي مكان كنت ناشره فيه.`,
            `Renaming or deleting a live subdomain is done by the platform team, not from your account. Tell me the current and new names (or that you want it deleted) and I'll open a ticket.\n\nNote: after a rename the old link stops working, so update anywhere you had shared it.`,
            { alt: ['entity_subdomain:3 intent_change:3', 'entity_subdomain:3 atom_remove:3'] })
    ]
};
