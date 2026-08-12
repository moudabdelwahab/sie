/**
 * settings-schema.js
 * ------------------------------------------------------------
 * الوصف الكامل لكل إعداد في المحرك: نوعه، قيمته الافتراضية، اسمه
 * بالعربي، وشرح لتأثيره الحقيقي.
 *
 * ده المصدر الوحيد للحقيقة. لوحة الإعدادات بترسم من هنا، والمحرك
 * بيتحقق من القيم من هنا، فمستحيل يحصل إن اللوحة تقول لمفتاح حاجة
 * وهو بيعمل حاجة تانية — وده أهم شرط في اللوحة كلها.
 *
 * ------------------------------------------------------------
 * DESIGN NOTE (English, for whoever maintains the engine)
 *
 * Every entry here MUST correspond to a real branch in the pipeline.
 * A setting that renders but changes nothing is worse than a missing
 * setting: staff make decisions based on what the console claims. The
 * `effect` field names the module that reads it, so the claim stays
 * checkable — grep the key, find the branch.
 *
 * Defaults describe TODAY'S behaviour exactly. Seeding this schema into
 * a fresh database therefore changes nothing about how SIE answers; it
 * only gives staff something to turn.
 *
 * Types are deliberately few — boolean, number, enum — because each one
 * needs a control in the console, a validator here, and a coercion path
 * out of jsonb. Adding a fourth type is a real cost; reach for an enum
 * first.
 */

/** @typedef {'boolean'|'number'|'enum'} SettingType */

/**
 * المجموعات زي ما بتظهر في اللوحة، بالترتيب.
 */
export const SETTING_GROUPS = Object.freeze([
    { id: 'operation', title: 'التشغيل', desc: 'المفاتيح الأساسية اللي بتحدد إذا كان المحرك شغّال أصلاً وبيرد إزاي.' },
    { id: 'emotion', title: 'الذكاء العاطفي', desc: 'إزاي المحرك يقرا نبرة العميل ويرد بشكل يناسب حالته.' },
    { id: 'diagnosis', title: 'التشخيص', desc: 'قد إيه المحرك يتعمّق في فهم المشكلة قبل ما يرد.' },
    { id: 'knowledge', title: 'المعرفة', desc: 'المحرك بياخد إجاباته منين، وإيه الأولوية بين المصادر.' },
    { id: 'memory', title: 'الذاكرة', desc: 'قد إيه المحرك يفتكر من المحادثة ومن اللي قبلها.' },
    { id: 'support', title: 'إدارة الدعم', desc: 'إمتى يسلّم المشكلة لموظف بشري وإزاي.' },
    { id: 'behavior', title: 'الذكاء والسلوك', desc: 'قد إيه المحرك يبقى جريء في إجاباته ولا يفضل متحفّظ.' }
]);

/**
 * كل الإعدادات. الترتيب هنا هو ترتيب العرض جوه كل مجموعة.
 *
 * حقول كل إعداد:
 *   key      اسم المفتاح في قاعدة البيانات
 *   group    المجموعة اللي هيظهر فيها
 *   type     boolean | number | enum
 *   default  القيمة اللي بتوصف سلوك المحرك النهارده
 *   title    الاسم بالعربي
 *   desc     تأثيره بالعربي بلغة بسيطة
 *   warn     (اختياري) التحذير اللي يظهر لما يكون مقفول أو خارج المعتاد
 *   effect   (بالإنجليزي) الموديول اللي بيقرا الإعداد فعلاً
 *   min/max/step  لأرقام
 *   options  للقوائم — { value, label, desc }
 *   dependsOn  المفتاح اللي لو اتقفل، الإعداد ده مالوش لازمة
 */
export const SETTINGS = Object.freeze([
    // ── التشغيل ────────────────────────────────────────────────────
    {
        key: 'engine_enabled', group: 'operation', type: 'boolean', default: true,
        title: 'المحرك الذكي شغّال',
        desc: 'لما يكون مقفول، العملاء بيرجعوا للبوت العادي على طول ومحدش بيتأثر.',
        warn: 'المحرك متوقف دلوقتي — كل العملاء بيرد عليهم البوت العادي.',
        effect: 'sie-chat-bridge: returns null before the pipeline runs'
    },
    {
        key: 'answer_directly', group: 'operation', type: 'boolean', default: true,
        title: 'يبعت الحل للعميل بنفسه',
        desc: 'لما يتأكد من المشكلة ويكون عنده حل جاهز، يبعته للعميل على طول.',
        warn: 'مش هيبعت حلول بنفسه — هيفهم المشكلة ويجمع التفاصيل ويسلّمها لموظف يرد.',
        effect: 'decision-engine: policy.allowAutoResolution'
    },
    {
        key: 'reply_to_greetings', group: 'operation', type: 'boolean', default: true,
        title: 'يرد على التحيات والكلام العادي',
        desc: 'يرحّب ويرد على «إزيك» و«انت مين» بدل ما يعاملها كمشكلة فنية.',
        warn: 'التحيات مش هيتم الرد عليها، والعميل ممكن يحس إن محدش موجود.',
        effect: 'sie-chat-bridge: small-talk short circuit'
    },
    {
        key: 'use_published_scenarios', group: 'operation', type: 'boolean', default: false,
        title: 'استخدم الحالات اللي ضفتها',
        desc: 'يشتغل بالحالات المفعّلة من صفحة «الحالات اللي بيفهمها» بدل الحالات الأساسية.',
        warn: 'شغّال بالحالات الأساسية بس — اللي ضفته مش مستخدم.',
        effect: 'sie-chat-bridge: scenario provider selection'
    },

    // ── حد معدل الطلبات ────────────────────────────────────────────
    // These three are read by sie_rate_limit_hit() in the database, not by
    // JavaScript, which is what makes a change here take effect on the very
    // next API call with no deployment and no cache to wait out.
    {
        key: 'rate_limit_enabled', group: 'operation', type: 'boolean', default: true,
        title: 'حد لعدد الطلبات في الدقيقة',
        desc: 'يمنع أي عميل أو تكامل من إغراق الواجهة بطلبات كتير أوي في وقت قصير.',
        warn: 'الحد مقفول — أي عميل يقدر يبعت أي عدد طلبات، وده بيأثر على سرعة الخدمة للباقيين.',
        effect: 'sie_rate_limit_hit(): returns allowed without spending a token'
    },
    {
        key: 'rate_limit_requests_per_minute', group: 'operation', type: 'number', default: 100,
        min: 10, max: 5000, step: 10,
        title: 'عدد الطلبات المسموحة في الدقيقة',
        desc: 'المعدل المستمر لكل عميل. الافتراضي ١٠٠ طلب في الدقيقة، وتقدر تحدد رقم مختلف لعميل بعينه من مركز المراجعة.',
        warn: 'رقم منخفض جدًا ممكن يوقف استخدام عادي — كل فتحة شاشة بتعمل أكتر من طلب.',
        effect: 'sie_rate_limit_hit(): bucket refill rate',
        dependsOn: 'rate_limit_enabled'
    },
    {
        key: 'rate_limit_burst', group: 'operation', type: 'number', default: 20,
        min: 0, max: 500, step: 5,
        title: 'السماح بدفعة مفاجئة',
        desc: 'كام طلب زيادة مسموح فوق المعدل لو العميل كان ساكت شوية. ده اللي بيمنع الواجهة تحس إنها متضايقة من استخدام عادي — شاشة واحدة ممكن تعمل عشر طلبات مرة واحدة.',
        warn: 'صفر معناه إن أي دفعة سريعة هتترفض حتى لو العميل مستخدمش حاجة من ساعة.',
        effect: 'sie_rate_limit_hit(): bucket capacity above the sustained rate',
        dependsOn: 'rate_limit_enabled'
    },

    // ── الذكاء العاطفي ─────────────────────────────────────────────
    {
        key: 'emotion_detection', group: 'emotion', type: 'boolean', default: true,
        title: 'يقرا نبرة العميل',
        desc: 'يحاول يعرف العميل متضايق ولا مستعجل ولا مبسوط، ويبني رده على كده.',
        warn: 'المحرك هيرد بنفس النبرة لكل العملاء مهما كانت حالتهم.',
        effect: 'sie-chat-bridge: detectEmotion() gate'
    },
    {
        key: 'emotion_anger', group: 'emotion', type: 'boolean', default: true,
        dependsOn: 'emotion_detection',
        title: 'يكتشف الغضب',
        desc: 'الشتيمة والتهديد بإلغاء الاشتراك والكلام الحاد — أوضح إشارة إن العميل محتاج بني آدم.',
        effect: 'emotion-detector: anger category'
    },
    {
        key: 'emotion_frustration', group: 'emotion', type: 'boolean', default: true,
        dependsOn: 'emotion_detection',
        title: 'يكتشف الإحباط',
        desc: '«كل مرة نفس المشكلة» و«مفيش فايدة» — عميل تعبان مش بالضرورة غضبان.',
        effect: 'emotion-detector: frustration category'
    },
    {
        key: 'emotion_urgency', group: 'emotion', type: 'boolean', default: true,
        dependsOn: 'emotion_detection',
        title: 'يكتشف الاستعجال',
        desc: '«ضروري حالاً» و«الشغل واقف» — يخلّي المحرك يختصر الأسئلة ويروح للحل.',
        effect: 'emotion-detector: urgency category'
    },
    {
        key: 'emotion_sarcasm', group: 'emotion', type: 'boolean', default: true,
        dependsOn: 'emotion_detection',
        title: 'يكتشف السخرية',
        desc: '«شكرًا على الخدمة الممتازة» وهو غضبان. من غير ده المحرك بيفهمها مدح ويرد غلط.',
        effect: 'emotion-detector: sarcasm category'
    },
    {
        key: 'emotion_thanks', group: 'emotion', type: 'boolean', default: true,
        dependsOn: 'emotion_detection',
        title: 'يكتشف الشكر',
        desc: 'يفرّق بين «شكرًا» اللي معناها خلاص اتحلّت و«شكرًا» اللي في نص الكلام.',
        effect: 'emotion-detector: thanks category'
    },
    {
        key: 'emotion_satisfaction', group: 'emotion', type: 'boolean', default: true,
        dependsOn: 'emotion_detection',
        title: 'يكتشف الرضا',
        desc: '«تمام كده اشتغلت» — إشارة إن الحل نفع، فمايكملش أسئلة من غير لازمة.',
        effect: 'emotion-detector: satisfaction category'
    },
    {
        key: 'emotion_reply', group: 'emotion', type: 'boolean', default: true,
        dependsOn: 'emotion_detection',
        title: 'يرد ردًا مناسبًا للحالة',
        desc: 'يبدأ رده بجملة تناسب حالة العميل قبل ما يدخل في الحل.',
        warn: 'هيقرا النبرة ويستعملها في قراراته، بس رده هيفضل بنفس الصياغة دايمًا.',
        effect: 'sie-chat-bridge: emotion acknowledgement prefix'
    },

    // ── التشخيص ───────────────────────────────────────────────────
    {
        key: 'diagnosis_level', group: 'diagnosis', type: 'enum', default: 'balanced',
        title: 'مستوى التشخيص',
        desc: 'قد إيه المحرك يفتح احتمالات كتير للمشكلة الواحدة.',
        options: [
            { value: 'strict',   label: 'دقيق',   desc: 'ماياخدش في اعتباره غير الاحتمالات القوية. أقل أخطاء، وأكتر تحويل لموظف.' },
            { value: 'balanced', label: 'متوازن', desc: 'المستوى المعتاد، وهو المناسب لأغلب الحالات.' },
            { value: 'broad',    label: 'واسع',   desc: 'يفتح احتمالات أكتر ويسأل أكتر. بيحل حالات أكتر لكن ممكن يتوه.' }
        ],
        effect: 'diagnostic-engine + ranking-engine: activation threshold'
    },
    {
        key: 'auto_request_more_info', group: 'diagnosis', type: 'boolean', default: true,
        title: 'يطلب معلومات إضافية لوحده',
        desc: 'يطلب صورة أو رقم أو تفاصيل لما يحتاجها عشان يقدر يشخّص صح.',
        warn: 'مش هيطلب حاجة — هيتصرف باللي العميل قاله بس.',
        effect: 'decision-engine: policy.allowEvidenceRequests'
    },
    {
        key: 'explain_root_cause', group: 'diagnosis', type: 'boolean', default: true,
        title: 'يقول السبب المرجّح',
        desc: 'يشرح للعميل هو فاهم المشكلة إزاي قبل ما يدّيه الحل، عشان يطمّنه إنه فاهمه.',
        warn: 'هيدّي الحل على طول من غير ما يقول هو فهم إيه.',
        effect: 'dialogue-renderer: root-cause line'
    },
    {
        key: 'suggest_multiple_solutions', group: 'diagnosis', type: 'boolean', default: false,
        title: 'يقترح أكتر من حل',
        desc: 'لما يكون فيه أكتر من احتمال قريب، يعرضهم كلهم بدل ما يختار واحد.',
        warn: 'هيعرض أقرب حل بس.',
        effect: 'dialogue-renderer: alternative solutions block'
    },
    {
        key: 'max_suggested_solutions', group: 'diagnosis', type: 'number', default: 2,
        min: 1, max: 4, step: 1, dependsOn: 'suggest_multiple_solutions',
        title: 'أقصى عدد حلول يعرضها',
        desc: 'مرتّبين من الأرجح للأقل ترجيحًا. أكتر من كده بيلخبط العميل.',
        effect: 'dialogue-renderer: alternatives cap'
    },

    // ── المعرفة ───────────────────────────────────────────────────
    {
        key: 'knowledge_use_scenarios', group: 'knowledge', type: 'boolean', default: true,
        title: 'يستخدم الحالات المعروفة',
        desc: 'الحالات اللي المحرك متدرّب عليها — ده مصدره الأساسي للحلول.',
        warn: 'مش هيرد بحلول الحالات خالص، وهيعتمد على المقالات والتحويل لموظف بس.',
        effect: 'decision-engine: policy.allowScenarioAnswers'
    },
    {
        key: 'knowledge_use_articles', group: 'knowledge', type: 'boolean', default: true,
        title: 'يستخدم المقالات',
        desc: 'المحتوى الثابت زي شرح الأسعار وسياسة الاسترجاع.',
        warn: 'مش هيرجع للمقالات حتى لو فيها الإجابة.',
        effect: 'answer-composer: static knowledge provider'
    },
    {
        key: 'knowledge_use_live_data', group: 'knowledge', type: 'boolean', default: true,
        title: 'يستخدم بيانات حساب العميل',
        desc: 'حالة الاشتراك والتذاكر المفتوحة — بيانات لحظية بتخلي الرد دقيق.',
        warn: 'مش هيبص على بيانات الحساب، والردود هتبقى عامة.',
        effect: 'answer-composer: live knowledge provider'
    },
    {
        key: 'knowledge_priority', group: 'knowledge', type: 'enum', default: 'articles_first',
        title: 'مين الأول لما الاتنين عندهم إجابة',
        desc: 'لما المقال وبيانات الحساب يردّوا على نفس السؤال، مين يكسب.',
        options: [
            { value: 'articles_first', label: 'المقالات الأول', desc: 'أسرع وأرخص، والمحتوى مراجَع. ده المعتاد.' },
            { value: 'live_first',     label: 'بيانات الحساب الأول', desc: 'أدق للعميل نفسه، بس بتحمّل على قاعدة البيانات كل رسالة.' }
        ],
        effect: 'answer-composer: source resolution order'
    },
    {
        key: 'knowledge_empathy_replies', group: 'knowledge', type: 'boolean', default: true,
        title: 'يستخدم الردود التعاطفية',
        desc: 'جمل الاعتذار والتطمين اللي بتخلي الرد إنساني مش جاف.',
        warn: 'الردود هتبقى مباشرة وجافة شوية.',
        effect: 'sie-chat-bridge: emotion + small-talk empathy copy'
    },
    {
        key: 'articles_before_ticket', group: 'knowledge', type: 'boolean', default: true,
        title: 'يدوّر في المقالات قبل ما يفتح تذكرة',
        desc: 'قبل ما يشغّل موظف، يتأكد إن مفيش مقال بيرد على السؤال.',
        warn: 'هيفتح تذكرة على طول حتى لو الإجابة موجودة في مقال.',
        effect: 'sie-chat-bridge: pre-ticket article lookup'
    },

    // ── الذاكرة ───────────────────────────────────────────────────
    {
        key: 'memory_keep_context', group: 'memory', type: 'boolean', default: true,
        title: 'يفتكر سياق المحادثة',
        desc: 'يفضل فاكر اللي العميل قاله في الرسايل اللي فاتت في نفس المحادثة.',
        warn: 'كل رسالة هتتعامل كأنها أول رسالة — العميل هيعيد كلامه كل مرة.',
        effect: 'sie-chat-bridge: previous diagnostic state carry-over'
    },
    {
        key: 'memory_context_minutes', group: 'memory', type: 'number', default: 120,
        min: 5, max: 1440, step: 5, dependsOn: 'memory_keep_context',
        title: 'مدة الاحتفاظ بالسياق (بالدقايق)',
        desc: 'لو العميل رجع بعد المدة دي، المحرك يبدأ معاه من أول وجديد. مفيد عشان مشكلة قديمة ماتلخبطش مشكلة جديدة.',
        effect: 'sie-chat-bridge: context expiry check'
    },
    {
        key: 'memory_remember_name', group: 'memory', type: 'boolean', default: true,
        title: 'يفتكر اسم العميل',
        desc: 'ينادي العميل باسمه في الترحيب بدل «أهلاً بيك».',
        effect: 'sie-chat-bridge: profile name lookup'
    },
    {
        key: 'memory_remember_last_issue', group: 'memory', type: 'boolean', default: true,
        title: 'يفتكر آخر مشكلة',
        desc: 'لو العميل رجع بعد شوية، يسأله المشكلة اللي فاتت اتحلّت ولا لأ.',
        effect: 'sie-chat-bridge: lastScenarioId follow-up'
    },
    {
        key: 'memory_use_past_conversations', group: 'memory', type: 'boolean', default: false,
        title: 'يستفيد من المحادثات القديمة',
        desc: 'يبص على محادثات العميل السابقة عشان يفهم أسرع.',
        warn: 'مقفول — كل محادثة قائمة بذاتها. ده بيقلل الحمل على قاعدة البيانات.',
        effect: 'sie-chat-bridge: prior-session history read'
    },

    // ── إدارة الدعم ───────────────────────────────────────────────
    {
        key: 'auto_ticket_enabled', group: 'support', type: 'boolean', default: true,
        title: 'يقدر يفتح تذاكر دعم',
        desc: 'لما مايعرفش يحل، يفتح تذكرة فيها تفاصيل المحادثة كاملة.',
        warn: 'مش هيفتح تذاكر خالص — هيقول للعميل يتواصل مع الفريق بنفسه.',
        effect: 'sie-chat-bridge: CREATE_TICKET branch'
    },
    {
        key: 'ask_before_ticket', group: 'support', type: 'boolean', default: true,
        dependsOn: 'auto_ticket_enabled',
        title: 'يستأذن قبل ما يفتح تذكرة',
        desc: 'يسأل «تحب أفتحلك تذكرة؟» ويستنى موافقة العميل.',
        warn: 'هيفتح التذاكر من غير ما يسأل، وده بيزوّد عدد التذاكر.',
        effect: 'sie-chat-bridge: beginTicketConfirmation()'
    },
    {
        key: 'ticket_on_low_confidence', group: 'support', type: 'boolean', default: true,
        dependsOn: 'auto_ticket_enabled',
        title: 'يفتح تذكرة لما مايكونش متأكد',
        desc: 'لما الاحتمالات تفضل متقاربة ومفيش سؤال ينفع يفرق بينها، يسلّم لموظف.',
        warn: 'هيفضل يسأل لحد ما يخلص الأسئلة بدل ما يسلّم بدري.',
        effect: 'decision-engine: policy.ticketOnAmbiguity'
    },
    {
        key: 'ticket_on_anger', group: 'support', type: 'boolean', default: true,
        title: 'يفتح تذكرة فورًا لو العميل غضبان',
        desc: 'أول ما يحس بغضب واضح، يوقف التشخيص ويوصّله بحد من الفريق.',
        warn: 'العميل الغضبان هيفضل مع المحرك لحد ما يطلب موظف بنفسه.',
        effect: 'sie-chat-bridge: escalateImmediately on anger'
    },
    {
        key: 'ticket_after_turns', group: 'support', type: 'number', default: 6,
        min: 3, max: 15, step: 1, dependsOn: 'auto_ticket_enabled',
        title: 'يسلّم لموظف بعد كام رسالة',
        desc: 'أقصى عدد رسايل يفضل المحرك يحاول فيها قبل ما يسلّم لموظف مهما حصل.',
        effect: 'decision-engine: policy.maxTurnsBeforeEscalation'
    },
    {
        key: 'ticket_include_summary', group: 'support', type: 'boolean', default: true,
        dependsOn: 'auto_ticket_enabled',
        title: 'يحط ملخص المحادثة في التذكرة',
        desc: 'الموظف يلاقي قدامه المشكلة والاحتمالات اللي المحرك شافها، بدل ما يقرا المحادثة من الأول.',
        warn: 'الموظف هيفتح التذكرة ملقيش فيها غير كلام العميل الخام.',
        effect: 'decision-engine: ticketDraft summary'
    },
    {
        key: 'search_past_tickets', group: 'support', type: 'boolean', default: false,
        title: 'يدوّر في تذاكر العميل القديمة قبل ما يرد',
        desc: 'يشوف العميل فتح تذكرة في نفس الموضوع قبل كده، ويقوله بدل ما يفتح تذكرة مكررة.',
        warn: 'مقفول — ممكن يفتح تذكرة تانية في نفس المشكلة.',
        effect: 'sie-chat-bridge: open-ticket lookup before CREATE_TICKET'
    },

    // ── الذكاء والسلوك ────────────────────────────────────────────
    {
        key: 'behavior_profile', group: 'behavior', type: 'enum', default: 'balanced',
        title: 'أسلوب المحرك',
        desc: 'اختيار سريع بيظبط مستوى الثقة وعدد الأسئلة والتخمين مرة واحدة.',
        options: [
            { value: 'conservative', label: 'محافظ',  desc: 'مايردش غير لما يكون متأكد جدًا، ويسلّم لموظف بسرعة. أقل غلط وأكتر تذاكر.' },
            { value: 'balanced',     label: 'متوازن', desc: 'الوضع المعتاد.' },
            { value: 'bold',         label: 'مبتكر',  desc: 'يحاول يرد حتى لو مش متأكد قوي، ويوضّح إنه بيرجّح. تذاكر أقل وغلط أكتر.' },
            { value: 'custom',       label: 'مخصص',   desc: 'الأرقام اللي تحت متظبّطة بإيدك.' }
        ],
        effect: 'settings-schema: applyBehaviorProfile() presets'
    },
    {
        key: 'answer_confidence', group: 'behavior', type: 'number', default: 0.6,
        min: 0.3, max: 0.9, step: 0.05,
        title: 'مستوى التأكد قبل ما يرد',
        desc: 'قد إيه لازم يكون متأكد من المشكلة قبل ما يدّي حل. الرقم الأعلى معناه ردود أقل وأصح.',
        effect: 'decision-engine: policy.resolutionConfidenceThreshold'
    },
    {
        key: 'max_clarifying_questions', group: 'behavior', type: 'number', default: 3,
        min: 1, max: 6, step: 1,
        title: 'أقصى عدد أسئلة توضيح',
        desc: 'كام سؤال يسأله في المحادثة الواحدة قبل ما يسلّم لموظف.',
        effect: 'decision-engine: policy.maxClarifyingQuestions'
    },
    {
        key: 'allow_smart_guess', group: 'behavior', type: 'boolean', default: false,
        title: 'يسمح بالتخمين الذكي',
        desc: 'لو قرب من مستوى التأكد ومحصلش تقدّم، يقول أرجح حل ويوضّح إنه ترجيح مش تأكيد.',
        warn: 'مقفول — لو مش متأكد بالكامل، هيسلّم لموظف بدل ما يخمّن.',
        effect: 'decision-engine: policy.smartGuessMargin'
    },
    {
        key: 'inference_mode', group: 'behavior', type: 'enum', default: 'knowledge_and_inference',
        title: 'يعتمد على إيه في إجاباته',
        desc: 'يجاوب من المكتوب عنده بس، ولا يستنتج من مجموع الأدلة كمان.',
        options: [
            { value: 'knowledge_only',          label: 'المكتوب عنده بس', desc: 'مايردش غير بحل مكتوب حرفيًا لحالة اتعرّفت. أأمن وأقل تغطية.' },
            { value: 'knowledge_and_inference', label: 'يستنتج كمان',     desc: 'يجمع أدلة من رسايل مختلفة ويوصل لحالة محدش ذكرها صريح. ده المعتاد.' }
        ],
        effect: 'diagnostic-engine: cross-turn evidence accumulation'
    }
]);

/** خريطة سريعة بالمفتاح. */
export const SETTINGS_BY_KEY = Object.freeze(
    Object.fromEntries(SETTINGS.map((s) => [s.key, s]))
);

/** القيم الافتراضية — بتوصف سلوك المحرك النهارده بالظبط. */
export const SIE_DEFAULT_SETTINGS = Object.freeze(
    Object.fromEntries(SETTINGS.map((s) => [s.key, s.default]))
);

/**
 * الأرقام اللي كل أسلوب بيظبطها. «مخصص» مش هنا لأنه معناه بالظبط
 * "ماتلمسش الأرقام".
 */
export const BEHAVIOR_PROFILES = Object.freeze({
    conservative: { answer_confidence: 0.75, max_clarifying_questions: 4, allow_smart_guess: false, inference_mode: 'knowledge_only' },
    balanced:     { answer_confidence: 0.60, max_clarifying_questions: 3, allow_smart_guess: false, inference_mode: 'knowledge_and_inference' },
    bold:         { answer_confidence: 0.45, max_clarifying_questions: 2, allow_smart_guess: true,  inference_mode: 'knowledge_and_inference' }
});

/**
 * The values a profile implies, or null for 'custom'. Returned rather than
 * applied so the caller decides whether it is previewing or saving.
 *
 * @param {string} profile
 * @returns {Object|null}
 */
export function behaviorProfileValues(profile) {
    return BEHAVIOR_PROFILES[profile] ? { ...BEHAVIOR_PROFILES[profile] } : null;
}

/**
 * Which profile a set of values corresponds to, or 'custom' if none.
 * Lets the console show the right selection after someone has nudged an
 * individual number, instead of claiming a profile that no longer holds.
 *
 * @param {Object} settings
 * @returns {string}
 */
export function detectBehaviorProfile(settings) {
    for (const [name, values] of Object.entries(BEHAVIOR_PROFILES)) {
        if (Object.entries(values).every(([k, v]) => settings[k] === v)) return name;
    }
    return 'custom';
}

/**
 * Coerces and range-checks one value against its definition.
 *
 * jsonb round-trips booleans and numbers faithfully, so this is not about
 * parsing — it is about refusing a value the engine would then have to
 * defend against on every turn. An out-of-range number is rejected here,
 * once, rather than silently clamped somewhere in the pipeline where
 * nobody would find it.
 *
 * @param {string} key
 * @param {*} value
 * @returns {{ok: true, value: *} | {ok: false, error: string}}
 */
export function validateSetting(key, value) {
    const def = SETTINGS_BY_KEY[key];
    if (!def) return { ok: false, error: `إعداد غير معروف: ${key}` };

    if (def.type === 'boolean') {
        if (typeof value !== 'boolean') return { ok: false, error: `«${def.title}» لازم يكون مفتوح أو مقفول.` };
        return { ok: true, value };
    }

    if (def.type === 'number') {
        const n = typeof value === 'number' ? value : Number(value);
        if (!Number.isFinite(n)) return { ok: false, error: `«${def.title}» لازم يكون رقم.` };
        if (n < def.min || n > def.max) {
            return { ok: false, error: `«${def.title}» لازم يكون بين ${def.min} و${def.max}.` };
        }
        return { ok: true, value: n };
    }

    if (def.type === 'enum') {
        const allowed = def.options.map((o) => o.value);
        if (!allowed.includes(value)) return { ok: false, error: `«${def.title}» مالهاش الاختيار ده.` };
        return { ok: true, value };
    }

    return { ok: false, error: `نوع إعداد غير معروف: ${def.type}` };
}

/**
 * Merges stored rows over the defaults, dropping anything unknown or
 * invalid.
 *
 * Silently ignoring a bad row is deliberate: settings are read on every
 * customer turn, and one malformed row left over from an older version
 * must never take the engine down. The warning makes it findable.
 *
 * @param {Array<{key: string, value: *}>} rows
 * @returns {Object}
 */
export function mergeStoredSettings(rows) {
    const merged = { ...SIE_DEFAULT_SETTINGS };
    for (const row of rows || []) {
        const result = validateSetting(row.key, row.value);
        if (result.ok) {
            merged[row.key] = result.value;
        } else {
            console.warn('[sie] تجاهلنا إعداد مخزّن مش مظبوط:', row.key, result.error);
        }
    }
    return merged;
}

/**
 * A setting is inert when the switch it depends on is off. The console
 * greys those out, and the engine ignores them, so a number nobody can
 * reach never looks like it is doing something.
 *
 * @param {Object} def
 * @param {Object} settings
 * @returns {boolean}
 */
export function isSettingActive(def, settings) {
    if (!def.dependsOn) return true;
    return settings[def.dependsOn] !== false;
}

/**
 * The whole schema arranged as the console renders it.
 *
 * @returns {Array<{id: string, title: string, desc: string, settings: Array}>}
 */
export function groupedSettings() {
    return SETTING_GROUPS.map((group) => ({
        ...group,
        settings: SETTINGS.filter((s) => s.group === group.id)
    }));
}
