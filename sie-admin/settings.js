/**
 * settings.js — SIE control console
 * ------------------------------------------------------------
 * كل اللي مسؤول التشغيل محتاجه في مكان واحد: المحرك بيعرف إيه
 * (السيناريوهات والمعرفة)، بيقرر إزاي (الإعدادات)، ومين مسموح له
 * يستخدمه (المستخدمون والاستهلاك).
 *
 * ── ARCHITECTURE ────────────────────────────────────────────
 * Every call into SIE goes through `/sie-integration/sie-runtime.js` and
 * nothing else. This page never imports an engine module directly, so
 * the nine modules stay free to change shape behind the runtime. The
 * only non-SIE import is the standalone Supabase client (./supabase-client.js),
 * which points at the same Supabase project — these pages are served from
 * their own origin, so the platform's /api-config.js is not reachable.
 *
 * The 2026 redesign changed the surface, not the wiring: the shell,
 * the components and the styling live in ./ui/* and ./design-system.css,
 * while every read, write and authorization path below is the same one
 * the console has always used.
 *
 * ── AUTHORIZATION ───────────────────────────────────────────
 * Both gates are answered by the database, never by inspecting a role in
 * JavaScript. The UI hides what a user cannot do purely as a courtesy;
 * the actual refusal happens in RLS and inside the RPCs, so removing an
 * attribute in devtools gains nothing.
 *
 *   is_chat_engine_staff()  -> may read and edit the scenario catalog
 *   is_sie_admin()          -> may grant or revoke customer access
 *
 * These are deliberately different: catalog editing is a team role,
 * while entitlement is a single accountable address.
 */
import { supabase } from './supabase-client.js';
// نفس دوال الحساب اللي صفحتَي الكوتة كانت بتستخدمها. مستوردة مش
// متكررة: لو اللوحة حسبت «قرّب من الحد» بطريقة مختلفة عن اللي بيتحسب
// في مكان تاني، الرقمين هيختلفوا ومحدش هيعرف مين الصح.
import { quotaMetrics, quotaStatus } from '../sie/quota-ui/quota-metrics.js';
import { sieQuotaService } from '../sie/quota-ui/sie-quota-service.js';
import {
    listActiveScenarios,
    validateScenarioDraft,
    saveScenarioDraft,
    listStoredScenarioVersions,
    listStoredKnowledgeVersions,
    publishKnowledgeVersion,
    isCurrentUserEngineStaff,
    isCurrentUserSieAdmin,
    getSieAccessStatus,
    evaluateSieAccessRow,
    adminSetAccess,
    adminResetUsage,
    getRateLimitStatus,
    adminSetRateLimit,
    adminResetRateLimit,
    describeRateLimitPressure,
    getSieSettings,
    saveSieSetting,
    publishScenarioVersion,
    saveKnowledgeDraft,
    parseContentDocument,
    getTokenLabels,
    SIE_DEFAULT_SETTINGS,
    SETTINGS_BY_KEY,
    behaviorProfileValues,
    detectBehaviorProfile,
    isSettingActive,
    groupedSettings
} from '../sie-integration/sie-runtime.js';

import { icon } from './ui/icons.js';
import { createAppShell } from './ui/app-shell.js';
import {
    esc, toast, confirmAction, openDialog, closeDialog, guardUnsaved, closeOnBackdrop,
    renderPager, emptyState, errorState, skeletonRows, skeletonCards, badge, meter, avatar,
    fmtNumber, fmtDate, fmtRelative, withBusy, debounce
} from './ui/components.js';

const LOGIN_PAGE = './login.html';

/**
 * كل عنصر في اللوحة بيتقرا من sie/config/settings-schema.js — مش مكتوب
 * هنا تاني.
 *
 * That is the point, not a convenience: when the label lived here and the
 * behaviour lived in the engine, nothing stopped the two from describing
 * different things. Now a control cannot claim an effect the engine does
 * not have, because there is only one description of each setting and both
 * sides read it.
 */
const state = {
    settings: { ...SIE_DEFAULT_SETTINGS },
    scenarios: [],
    drafts: [],
    knowledge: [],
    knowledgeError: null,
    users: [],
    isStaff: false,
    isSieAdmin: false,
    editingUserId: null,
    scenarioPage: 1,
    userPage: 1,
    usagePage: 1,
    /** قسم الإعدادات المفتوح دلوقتي. */
    settingsGroup: null,
    /** آخر ملف اتقرا، جاهز للحفظ. */
    importParsed: null,
    /** لقطة من نموذج مفتوح، عشان نعرف لو فيه تغيير مش متحفوظ. */
    dirtySnapshot: null
};

/**
 * A catalog runs to hundreds of scenarios, and a table that renders all of
 * them at once is a page an operator scrolls past rather than reads. 25 is
 * about a screen and a half — enough to scan, short enough to reach the
 * end of.
 */
const SCENARIOS_PER_PAGE = 25;
const USERS_PER_PAGE = 20;

/** Stored category codes are English because tickets.category is; never show them raw. */
const CATEGORY_AR = {
    whatsapp: 'واتساب',
    subscription: 'الاشتراكات والفلوس',
    login: 'الدخول والحساب',
    api: 'الربط البرمجي',
    inquiry: 'استفسارات',
    other: 'أخرى'
};
const catAr = (c) => CATEGORY_AR[c] || c;

const ACCESS_MODE_AR = { unlimited: 'من غير حدود', quota: 'عدد رسائل', expiration: 'لحد تاريخ' };

/**
 * أسماء الأدلة بالعربي، من قاموس المحرك نفسه.
 *
 * Filled once on load. Until it is, tokenAr() returns the raw token rather
 * than blocking the table on a lookup nobody is waiting for.
 */
let TOKEN_LABELS = {};

async function loadTokenLabels() {
    TOKEN_LABELS = await getTokenLabels();
}

const tokenAr = (token) => TOKEN_LABELS[token] || token;

const DRAFT_STATUS_AR = {
    draft: 'مسودة', validated: 'اتراجعت', published: 'مفعّلة',
    rejected: 'مرفوضة', archived: 'قديمة'
};
const DRAFT_STATUS_TONE = {
    draft: 'warning', validated: 'info', published: 'success',
    rejected: 'danger', archived: 'neutral'
};

const $ = (id) => document.getElementById(id);

/** أقسام اللوحة زي ما بتظهر في القائمة الجانبية. */
const VIEWS = [
    {
        id: 'dashboard', label: 'لوحة التحكم', iconName: 'dashboard', group: 'نظرة عامة',
        title: 'لوحة التحكم', desc: 'حالة المحرك والكتالوج والعملاء في شاشة واحدة.'
    },
    {
        id: 'scenarios', label: 'السيناريوهات', iconName: 'scenarios', group: 'المعرفة',
        title: 'السيناريوهات', desc: 'الحالات اللي المحرك بيشخّصها، والمسودات المستنية تفعيل.',
        searchId: 'scenarioSearch'
    },
    {
        id: 'knowledge', label: 'المعرفة', iconName: 'knowledge', group: 'المعرفة',
        title: 'مداخل المعرفة', desc: 'الإجابات الجاهزة اللي المحرك بيرد منها.',
        searchId: 'knowledgeSearch'
    },
    {
        id: 'diagnostics', label: 'التشخيص', iconName: 'diagnostics', group: 'المعرفة',
        title: 'التشخيص', desc: 'جرّب رسالة وشوف المحرك هيفهمها إزاي — من غير أي أثر على العملاء.'
    },
    {
        id: 'users', label: 'المستخدمون', iconName: 'users', group: 'العملاء',
        title: 'المستخدمون والصلاحيات', desc: 'مين مسموح له يستخدم المحرك، وبأي شروط.',
        searchId: 'userSearch'
    },
    {
        id: 'usage', label: 'الاستهلاك والحدود', iconName: 'usage', group: 'العملاء',
        title: 'الاستهلاك والحدود', desc: 'الرصيد المستهلك وحد معدل الطلبات لكل عميل.',
        searchId: 'usageSearch'
    },
    {
        id: 'settings', label: 'الإعدادات', iconName: 'settings', group: 'المحرك',
        title: 'إعدادات المحرك', desc: 'أي تغيير هنا بيتحفظ فورًا وبيسري على المحادثات الجديدة على طول.',
        searchId: 'settingSearch'
    }
];

/** @type {ReturnType<typeof createAppShell>} */
let shell;

// ═════════════════════════════════════════════════════════════
// Boot
// ═════════════════════════════════════════════════════════════
(async function boot() {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) {
        window.location.replace(LOGIN_PAGE);
        return;
    }

    [state.isStaff, state.isSieAdmin] = await Promise.all([
        isCurrentUserEngineStaff(supabase),
        isCurrentUserSieAdmin(supabase)
    ]);

    const root = $('appRoot');
    root.classList.remove('app-loading');
    root.innerHTML = '';

    if (!state.isStaff && !state.isSieAdmin) {
        root.appendChild($('deniedTemplate').content.cloneNode(true));
        return;
    }

    root.appendChild($('pageTemplate').content.cloneNode(true));

    const email = session.user.email || '';
    $('whoAmI').textContent = email;
    $('accountMenuEmail').textContent = email;
    $('accountAvatar').textContent = email.slice(0, 2).toUpperCase();
    $('accountRole').textContent = state.isSieAdmin ? 'مسؤول المحرك' : 'فريق العمل';

    shell = createAppShell({ views: VIEWS, onNavigate: onNavigate });

    wireChrome();
    wireScenarioEditor();
    wireImportDialog();
    wireAccessEditor();
    wireDiagnostics();
    wireKnowledge();
    paintLoadingStates();

    shell.start();

    // الأقسام التلاتة بتتحمّل مع بعض: كل واحد بيرسم نفسه أول ما يوصل،
    // فالصفحة مابتستناش أبطأ طلب عشان تبان.
    await Promise.all([loadSettings(), loadScenarios(), loadUsers()]);
    renderDashboard();
    // المعرفة بتتأخر شوية عن الباقي، والبطاقة بتاعتها بتتحدّث لما توصل.
    loadKnowledge().then(renderDashboard);
})();

/** هياكل عظمية بدل شاشة فاضية أثناء أول تحميل. */
function paintLoadingStates() {
    $('dashboardStats').innerHTML = skeletonCards(4);
    $('scenarioStats').innerHTML = skeletonCards(4);
    $('userStats').innerHTML = skeletonCards(4);
    $('usageStats').innerHTML = skeletonCards(4);
    $('scenarioRows').innerHTML = skeletonRows(6, 7);
    $('userRows').innerHTML = skeletonRows(5, 7);
    $('usageRows').innerHTML = skeletonRows(5, 7);
    $('knowledgeRows').innerHTML = skeletonRows(4, 6);
    $('draftRows').innerHTML = skeletonRows(3, 6);
    $('healthList').innerHTML = '<div class="skeleton skeleton-line" style="width:80%"></div>'
        + '<div class="skeleton skeleton-line" style="width:60%"></div>'
        + '<div class="skeleton skeleton-line" style="width:70%"></div>';
}

function onNavigate(view) {
    // الجداول الكبيرة بتترسم عند فتح قسمها بس — القسم اللي محدش فتحه
    // مش محتاج يستهلك رسم.
    if (view.id === 'usage' && state.users.length) renderUsage();
    if (view.id === 'dashboard') renderDashboard();
}

function wireChrome() {
    $('signOutBtn').addEventListener('click', async () => {
        await supabase.auth.signOut();
        window.location.replace(LOGIN_PAGE);
    });
}

// ═════════════════════════════════════════════════════════════
// لوحة التحكم — كلها مبنية من بيانات موجودة فعلاً
// ═════════════════════════════════════════════════════════════
function statCard({ label, value, meta = '', iconName = 'sparkles', tone = 'primary', href = '' }) {
    const body = `
        <div class="stat-card-top">
          <span class="stat-label">${esc(label)}</span>
          <span class="stat-icon stat-icon--${esc(tone)}">${icon(iconName)}</span>
        </div>
        <span class="stat-value">${esc(value)}</span>
        ${meta ? `<span class="stat-meta">${meta}</span>` : ''}`;
    return href
        ? `<a class="stat-card" href="${esc(href)}">${body}</a>`
        : `<div class="stat-card">${body}</div>`;
}

/** مجموع رقم من كل صفوف الوصول/المعدل، مع تجاهل الناقص بدل تصفيره. */
const sumBy = (rows, pick) => rows.reduce((total, row) => total + (Number(pick(row)) || 0), 0);

function renderDashboard() {
    const auto = state.scenarios.filter((s) => s.resolution.hasAutoResolution).length;
    const pendingDrafts = state.drafts.filter((d) => d.status !== 'published').length;
    const enabled = state.users.filter((u) => evaluateSieAccessRow(u.access).available).length;
    const attention = state.users.filter((u) => ['warning', 'almost', 'exhausted'].includes(u.quota?.status));
    const messagesUsed = sumBy(state.users, (u) => u.access?.messages_used);
    const requests = sumBy(state.users, (u) => u.rateLimit?.total_requests);
    const rejected = sumBy(state.users, (u) => u.rateLimit?.total_rejected);
    const quotaUsers = state.users.filter((u) => u.access?.access_mode === 'quota');
    const remaining = sumBy(quotaUsers, (u) => u.quota?.remaining);
    const engineOn = state.settings.engine_enabled !== false;
    const changed = changedSettingsCount();

    $('dashboardStats').innerHTML = [
        statCard({
            label: 'حالة المحرك',
            value: engineOn ? 'شغّال' : 'متوقف',
            meta: engineOn
                ? (changed ? `${changed} إعداد متغيّر عن المعتاد` : 'كل الإعدادات على المعتاد')
                : 'العملاء بيرد عليهم البوت العادي',
            iconName: 'power',
            tone: engineOn ? 'success' : 'danger',
            href: '#/settings'
        }),
        statCard({
            label: 'سيناريوهات شغّالة',
            value: fmtNumber(state.scenarios.length),
            meta: `<b class="num">${fmtNumber(auto)}</b> بيردوا بحل جاهز`,
            iconName: 'scenarios',
            href: '#/scenarios'
        }),
        statCard({
            label: 'مستنية تفعيل',
            value: fmtNumber(pendingDrafts),
            meta: pendingDrafts ? 'مسودات المحرك لسه مابيستخدمهاش' : 'مفيش مسودات معلّقة',
            iconName: 'inbox',
            tone: pendingDrafts ? 'warning' : 'neutral',
            href: '#/scenarios'
        }),
        statCard({
            label: 'المستخدمون',
            value: fmtNumber(state.users.length),
            meta: `<b class="num">${fmtNumber(enabled)}</b> مسموح لهم يستخدموا المحرك`,
            iconName: 'users',
            href: '#/users'
        }),
        statCard({
            label: 'رسائل مستهلكة',
            value: fmtNumber(messagesUsed),
            meta: quotaUsers.length
                ? `<b class="num">${fmtNumber(remaining)}</b> متبقية على ${fmtNumber(quotaUsers.length)} حساب برصيد`
                : 'مفيش حسابات برصيد محدد',
            iconName: 'message',
            href: '#/usage'
        }),
        statCard({
            label: 'طلبات على الواجهة',
            value: fmtNumber(requests),
            meta: rejected
                ? `<b class="num">${fmtNumber(rejected)}</b> اترفضوا لتجاوز الحد`
                : 'مفيش طلبات مرفوضة',
            iconName: 'gauge',
            tone: rejected ? 'warning' : 'neutral',
            href: '#/usage'
        }),
        statCard({
            label: 'محتاجين متابعة',
            value: fmtNumber(attention.length),
            meta: attention.length ? 'قرّبوا من الحد أو استنفدوه' : 'مفيش حد قرّب من حدّه',
            iconName: 'alert',
            tone: attention.length ? 'warning' : 'success',
            href: '#/usage'
        }),
        statCard({
            label: 'مداخل معرفة',
            value: state.knowledgeError ? '—' : fmtNumber(state.knowledge.length),
            meta: state.knowledgeError
                ? 'مقدرناش نقراها'
                : `<b class="num">${fmtNumber(state.knowledge.filter((k) => k.status !== 'published').length)}</b> مستنية تفعيل`,
            iconName: 'knowledge',
            tone: 'neutral',
            href: '#/knowledge'
        })
    ].join('');

    renderHealth();
    renderDraftsPreview(pendingDrafts);
    renderAttention(attention);
    renderSystemAlerts({ pendingDrafts, attention, rejected });
}

/** المفاتيح اللي بتغيّر سلوك المحرك جذريًا، بحالتها الحالية. */
const HEALTH_KEYS = [
    'engine_enabled', 'answer_directly', 'use_published_scenarios',
    'knowledge_use_articles', 'auto_ticket_enabled', 'rate_limit_enabled'
];

function renderHealth() {
    $('healthList').innerHTML = HEALTH_KEYS
        .filter((key) => SETTINGS_BY_KEY[key])
        .map((key) => {
            const def = SETTINGS_BY_KEY[key];
            const on = state.settings[key] !== false;
            return `
              <div class="health-row">
                <span class="health-dot health-dot--${on ? 'on' : 'off'}"></span>
                <span class="health-text">
                  <b>${esc(def.title)}</b>
                  <span class="sub">${esc(def.desc)}</span>
                </span>
                ${badge(on ? 'مفتوح' : 'مقفول', on ? 'success' : 'neutral')}
              </div>`;
        }).join('');
}

function renderDraftsPreview(pendingDrafts) {
    const pending = state.drafts.filter((d) => d.status !== 'published').slice(0, 5);
    $('draftsPreview').innerHTML = pending.length === 0
        ? emptyState({
            iconName: 'checkCircle',
            title: 'مفيش حاجة مستنية',
            text: pendingDrafts === 0 && state.drafts.length === 0
                ? 'لسه مضفتش أي سيناريو من اللوحة.'
                : 'كل المسودات اتفعّلت.'
        })
        : `<ul class="mini-list">${pending.map((draft) => `
            <li class="mini-row">
              <span class="mini-main">
                <b class="ltr">${esc(draft.scenario_key)}</b>
                <span class="sub">نسخة ${draft.version} · ${esc(fmtRelative(draft.created_at))}</span>
              </span>
              ${badge(DRAFT_STATUS_AR[draft.status] || draft.status, DRAFT_STATUS_TONE[draft.status] || 'neutral')}
            </li>`).join('')}</ul>`;
}

function renderAttention(attention) {
    const rows = [...attention]
        .sort((a, b) => (b.quota?.percentage || 0) - (a.quota?.percentage || 0))
        .slice(0, 5);

    $('attentionList').innerHTML = rows.length === 0
        ? emptyState({ iconName: 'checkCircle', title: 'كله تمام', text: 'مفيش عميل قرّب من حدّه دلوقتي.' })
        : `<ul class="mini-list">${rows.map((user) => `
            <li class="mini-row">
              ${avatar(user.name, user.email, { size: 'sm' })}
              <span class="mini-main">
                <b>${esc(user.name)}</b>
                <span class="sub ltr">${esc(user.email)}</span>
              </span>
              <span class="mini-meter">
                ${meter(user.quota.percentage, quotaTone(user.quota.status))}
                <span class="sub num">${fmtNumber(user.quota.used)} / ${fmtNumber(user.quota.total ?? 0)}</span>
              </span>
              <button type="button" class="btn btn--secondary btn--sm" data-open-user="${esc(user.id)}">افتح</button>
            </li>`).join('')}</ul>`;

    $('attentionList').querySelectorAll('[data-open-user]').forEach((button) =>
        button.addEventListener('click', () => openAccessDialog(button.dataset.openUser)));
}

/**
 * التنبيهات في الشريط العلوي مشتقة من الحالة الحقيقية بس: محرك متوقف،
 * عملاء استنفدوا رصيدهم، مسودات مستنية، طلبات اترفضت. مفيش إشعار
 * بيتخلق من فراغ.
 */
function renderSystemAlerts({ pendingDrafts, attention, rejected }) {
    const alerts = [];

    if (state.settings.engine_enabled === false) {
        alerts.push({
            tone: 'danger', title: 'المحرك الذكي متوقف',
            body: 'كل العملاء بيرد عليهم البوت العادي دلوقتي.', viewId: 'settings'
        });
    }
    const exhausted = attention.filter((u) => u.quota?.status === 'exhausted').length;
    if (exhausted) {
        alerts.push({
            tone: 'danger', title: `${exhausted} عميل استنفد رصيده`,
            body: 'مش قادرين يبعتوا لحد ما تزوّد الرصيد أو تصفّر العدّاد.', viewId: 'usage'
        });
    }
    const near = attention.length - exhausted;
    if (near > 0) {
        alerts.push({
            tone: 'warning', title: `${near} عميل قرّب من حدّه`,
            body: 'راجع رصيدهم قبل ما يتقفل عليهم.', viewId: 'usage'
        });
    }
    if (pendingDrafts) {
        alerts.push({
            tone: 'warning', title: `${pendingDrafts} مسودة مستنية تفعيل`,
            body: 'المحرك لسه مابيستخدمهاش مع العملاء.', viewId: 'scenarios'
        });
    }
    if (pendingDrafts && state.settings.use_published_scenarios === false) {
        alerts.push({
            tone: 'warning', title: 'خيار «استخدم الحالات اللي ضفتها» مقفول',
            body: 'حتى لو فعّلت مسودة، المحرك مش هيستعملها وهي مقفولة.', viewId: 'settings'
        });
    }
    if (rejected) {
        alerts.push({
            tone: 'warning', title: `${fmtNumber(rejected)} طلب اترفض لتجاوز حد المعدل`,
            body: 'راجع الحدود لو ده متكرر مع عميل بعينه.', viewId: 'usage'
        });
    }

    shell.setAlerts(alerts);
    shell.setBadge('scenarios', pendingDrafts, 'warning');
    shell.setBadge('usage', attention.length, attention.length ? 'danger' : 'neutral');

    const banner = alerts.find((a) => a.tone === 'danger') || alerts[0];
    $('dashboardAlerts').innerHTML = !banner ? '' : `
        <div class="alert alert--${banner.tone === 'danger' ? 'danger' : 'warning'}">
          ${icon('alert')}
          <div class="alert-body">
            <span class="alert-title">${esc(banner.title)}</span>
            ${esc(banner.body || '')}
          </div>
          ${banner.viewId ? `<a class="btn btn--secondary btn--sm" href="#/${esc(banner.viewId)}">افتح</a>` : ''}
        </div>`;
}

// ═════════════════════════════════════════════════════════════
// Scenarios
// ═════════════════════════════════════════════════════════════
async function loadScenarios() {
    await loadTokenLabels();
    state.scenarios = await listActiveScenarios();
    state.drafts = state.isStaff ? await listStoredScenarioVersions(supabase) : [];

    const categories = [...new Set(state.scenarios.map((s) => s.category))].sort();
    $('scenarioCategory').innerHTML = '<option value="">كل الأقسام</option>'
        + categories.map((c) => `<option value="${esc(c)}">${esc(catAr(c))}</option>`).join('');

    const auto = state.scenarios.filter((s) => s.resolution.hasAutoResolution).length;
    const withQ = state.scenarios.filter((s) => s.discriminatingQuestions?.length).length;
    $('scenarioStats').innerHTML = [
        statCard({ label: 'سيناريو بيفهمه', value: fmtNumber(state.scenarios.length), iconName: 'scenarios' }),
        statCard({ label: 'بيرد عليه بحل', value: fmtNumber(auto), iconName: 'zap', tone: 'success' }),
        statCard({ label: 'بيجمع معلومات ويسلّم', value: fmtNumber(state.scenarios.length - auto), iconName: 'inbox', tone: 'neutral' }),
        statCard({ label: 'بيسأل فيه سؤال توضيحي', value: fmtNumber(withQ), iconName: 'message', tone: 'neutral' })
    ].join('');

    $('draftCount').textContent = state.drafts.length;
    renderDrafts();
    renderScenarios();
    wireScenarioToolbar();

    $('newScenarioBtn').addEventListener('click', () => openScenarioDialog(null));
    if (!state.isStaff) {
        for (const id of ['newScenarioBtn', 'importScenarioBtn', 'importKnowledgeBtn']) {
            $(id).disabled = true;
            $(id).title = 'إضافة السيناريوهات متاحة لفريق العمل بس';
        }
    }
}

/**
 * Any filter change resets to page one. Staying on page 7 of a result set
 * that now has two pages shows an empty table and reads as "the search
 * found nothing", which is the opposite of what happened.
 */
function wireScenarioToolbar() {
    const rerender = () => { state.scenarioPage = 1; renderScenarios(); };
    $('scenarioSearch').addEventListener('input', debounce(rerender));
    for (const id of ['scenarioCategory', 'scenarioResolution', 'scenarioSort']) {
        $(id).addEventListener('input', rerender);
    }
    $('scenarioSearchClear').addEventListener('click', () => {
        $('scenarioSearch').value = '';
        state.scenarioPage = 1;
        renderScenarios();
        $('scenarioSearch').focus();
    });
    $('scenarioResetFilters').addEventListener('click', () => {
        $('scenarioSearch').value = '';
        $('scenarioCategory').value = '';
        $('scenarioResolution').value = '';
        state.scenarioPage = 1;
        renderScenarios();
    });
}

const COLLATOR = new Intl.Collator('ar');

function filteredScenarios() {
    const q = $('scenarioSearch').value.trim().toLowerCase();
    const cat = $('scenarioCategory').value;
    const res = $('scenarioResolution').value;
    const sort = $('scenarioSort').value;

    const rows = state.scenarios.filter((s) => {
        if (cat && s.category !== cat) return false;
        if (res === 'auto' && !s.resolution.hasAutoResolution) return false;
        if (res === 'manual' && s.resolution.hasAutoResolution) return false;
        if (!q) return true;
        // The Arabic evidence LABELS are searched too, not just the tokens:
        // an agent looking for the WhatsApp cases types «واتساب», not
        // `entity_whatsapp`.
        const hay = [
            s.id, s.label.ar, s.label.en, catAr(s.category),
            ...s.evidenceSignature.flatMap((e) => [e.token, tokenAr(e.token)])
        ].join(' ').toLowerCase();
        return hay.includes(q);
    });

    if (sort === 'category') {
        rows.sort((a, b) => COLLATOR.compare(catAr(a.category), catAr(b.category))
            || COLLATOR.compare(a.label.ar, b.label.ar));
    } else if (sort === 'evidence') {
        rows.sort((a, b) => b.evidenceSignature.length - a.evidenceSignature.length);
    } else {
        rows.sort((a, b) => COLLATOR.compare(a.label.ar, b.label.ar));
    }

    return rows;
}

/**
 * آخر نسخة مخزّنة لكل سيناريو.
 *
 * The live catalog has no timestamp of its own — it is a file the engine
 * loads. The stored versions do, so a scenario that someone has since
 * drafted against can honestly show both "there is a newer draft" and
 * when it landed. A scenario with no stored version shows neither rather
 * than an invented date.
 */
function latestVersionByKey() {
    const map = new Map();
    for (const row of state.drafts) {
        const seen = map.get(row.scenario_key);
        if (!seen || new Date(row.created_at) > new Date(seen.created_at)) map.set(row.scenario_key, row);
    }
    return map;
}

/** حالة السيناريو الشغّال: نشط، ولا فيه مسودة أحدث مستنية مراجعة. */
function scenarioStatusBadge(latest) {
    if (!latest) return badge('نشط', 'success');
    if (latest.status === 'published') return badge('نشط', 'success');
    if (latest.status === 'rejected') return badge('مسودة مرفوضة', 'danger');
    if (latest.status === 'archived') return badge('نشط', 'success');
    return badge('فيه مسودة جديدة', 'warning');
}

function renderScenarios() {
    const rows = filteredScenarios();
    const total = rows.length;
    const pageCount = Math.max(1, Math.ceil(total / SCENARIOS_PER_PAGE));

    // Deleting a filter can shrink the result set under the current page.
    state.scenarioPage = Math.min(Math.max(1, state.scenarioPage), pageCount);
    const start = (state.scenarioPage - 1) * SCENARIOS_PER_PAGE;
    const page = rows.slice(start, start + SCENARIOS_PER_PAGE);

    const filtering = Boolean($('scenarioSearch').value.trim()
        || $('scenarioCategory').value || $('scenarioResolution').value);
    $('scenarioSearchClear').hidden = !$('scenarioSearch').value;
    $('scenarioResetFilters').hidden = !filtering;
    $('scenarioCount').textContent = total === 0
        ? ''
        : total <= SCENARIOS_PER_PAGE
            ? `${total} سيناريو`
            : `${start + 1}–${start + page.length} من ${total} سيناريو`;

    const latest = latestVersionByKey();

    $('scenarioEmpty').hidden = total > 0;
    $('scenarioEmpty').innerHTML = total > 0 ? '' : emptyState({
        iconName: 'search',
        title: 'مفيش سيناريو مطابق',
        text: 'جرّب كلمة أقل، أو امسح الفلاتر وابدأ من الأول.',
        action: '<button type="button" class="btn btn--secondary btn--sm" data-clear-filters>امسح الفلاتر</button>'
    });
    $('scenarioEmpty').querySelector('[data-clear-filters]')
        ?.addEventListener('click', () => $('scenarioResetFilters').click());

    $('scenarioRows').innerHTML = page.map((s) => {
        const stored = latest.get(s.id);
        return `
        <tr>
          <td>
            <span class="cell-title">${esc(s.label.ar)}</span>
            <span class="cell-sub">${esc(s.id)}</span>
          </td>
          <td data-label="القسم">${badge(catAr(s.category), 'neutral', { plain: true })}</td>
          <td data-label="بيعرفه من" class="cell-evidence">${s.evidenceSignature.slice(0, 3).map((e) =>
              `<span class="chip">${esc(tokenAr(e.token))}</span>`).join('')}
            ${s.evidenceSignature.length > 3 ? `<span class="chip chip--more">+${s.evidenceSignature.length - 3}</span>` : ''}</td>
          <td data-label="بيعمل إيه">${s.resolution.hasAutoResolution
              ? badge('بيرد بحل', 'success')
              : badge('بيسلّم لفريق', 'info')}</td>
          <td data-label="الحالة">${scenarioStatusBadge(stored)}</td>
          <td data-label="آخر تحديث" class="sub">${stored ? esc(fmtDate(stored.created_at)) : '—'}</td>
          <td class="cell-actions">
            <button class="btn btn--ghost btn--sm" data-view="${esc(s.id)}">
              ${icon('eye')} افتح
            </button>
          </td>
        </tr>`;
    }).join('');

    $('scenarioRows').querySelectorAll('[data-view]').forEach((b) =>
        b.addEventListener('click', () => openScenarioDialog(
            state.scenarios.find((s) => s.id === b.dataset.view))));

    renderPager($('scenarioPager'), {
        page: state.scenarioPage,
        pageCount,
        onSelect: (target) => {
            state.scenarioPage = target;
            renderScenarios();
            // Paging without this leaves the reader at the bottom of the
            // page they just left, looking at row 25 of the new one.
            $('pageScroll').scrollTo({ top: 0, behavior: 'smooth' });
        }
    });
}

function renderDrafts() {
    $('draftRows').innerHTML = state.drafts.length
        ? state.drafts.map((d) => `
            <tr>
              <td><span class="cell-title ltr">${esc(d.scenario_key)}</span></td>
              <td data-label="النسخة" class="num">${d.version}</td>
              <td data-label="الحالة">${badge(DRAFT_STATUS_AR[d.status] || d.status, DRAFT_STATUS_TONE[d.status] || 'neutral')}</td>
              <td data-label="ملاحظة" class="sub">${esc(d.notes || '—')}</td>
              <td data-label="اتضاف" class="sub" title="${esc(fmtDate(d.created_at, { withTime: true }))}">${esc(fmtRelative(d.created_at))}</td>
              <td class="cell-actions">${d.status === 'published'
                  ? '<span class="sub">شغّالة</span>'
                  : `<button class="btn btn--secondary btn--sm" data-publish="${esc(d.scenario_key)}" data-version="${d.version}">فعّلها</button>`}</td>
            </tr>`).join('')
        : `<tr><td colspan="6">${emptyState({
            iconName: 'file', title: 'لسه مضفتش أي سيناريو',
            text: 'ابدأ من «سيناريو جديد» أو ارفع ملف فيه سيناريوهاتك.'
        })}</td></tr>`;

    $('draftRows').querySelectorAll('[data-publish]').forEach((b) =>
        b.addEventListener('click', async () => {
            const ok = await confirmAction({
                title: 'تفعيل السيناريو ده؟',
                body: 'معناها إن المحرك يبدأ يستخدمه مع العملاء في المحادثات الجديدة.',
                confirmLabel: 'فعّلها'
            });
            if (!ok) return;

            const result = await withBusy(b, () => publishScenarioVersion(supabase, {
                key: b.dataset.publish,
                version: Number(b.dataset.version)
            }));
            if (!result.success) { toast(`مااتفعلتش: ${result.error}`, 'err'); return; }

            toast(state.settings.use_published_scenarios
                ? 'اتفعّلت، والمحرك هيستخدمها في المحادثات الجديدة.'
                : 'اتفعّلت. عشان تشتغل فعلًا، افتح خيار «استخدم الحالات اللي ضفتها» من الإعدادات.');
            state.drafts = await listStoredScenarioVersions(supabase);
            $('draftCount').textContent = state.drafts.length;
            renderDrafts();
            renderScenarios();
            renderDashboard();
        }));
}

// ═════════════════════════════════════════════════════════════
// المعرفة — نفس دورة المسودة/التفعيل بتاعة السيناريوهات
// ═════════════════════════════════════════════════════════════
function wireKnowledge() {
    $('knowledgeSearch').addEventListener('input', debounce(renderKnowledge));
    $('knowledgeFilter').addEventListener('input', renderKnowledge);
    $('knowledgeRefreshBtn').addEventListener('click', (event) =>
        withBusy(event.currentTarget, loadKnowledge));
    $('importKnowledgeBtn').addEventListener('click', () => {
        resetImportDialog();
        openDialog($('importDialog'));
    });
}

async function loadKnowledge() {
    if (!state.isStaff) {
        state.knowledge = [];
        renderKnowledge();
        return;
    }
    try {
        state.knowledge = await listStoredKnowledgeVersions(supabase);
        state.knowledgeError = null;
    } catch (err) {
        state.knowledgeError = err?.message || String(err);
        state.knowledge = [];
    }
    renderKnowledge();
}

function renderKnowledge() {
    const query = $('knowledgeSearch').value.trim().toLowerCase();
    const filter = $('knowledgeFilter').value;

    const rows = state.knowledge.filter((entry) => {
        if (filter === 'published' && entry.status !== 'published') return false;
        if (filter === 'pending' && entry.status === 'published') return false;
        if (!query) return true;
        return `${entry.knowledge_key} ${entry.notes || ''}`.toLowerCase().includes(query);
    });

    $('knowledgeCount').textContent = rows.length ? `${rows.length} مدخل` : '';
    $('knowledgeEmpty').hidden = rows.length > 0;
    $('knowledgeEmpty').innerHTML = rows.length > 0 ? '' : (state.knowledgeError
        ? errorState(state.knowledgeError)
        : emptyState({
            iconName: 'knowledge',
            title: state.knowledge.length ? 'مفيش مدخل مطابق' : 'مفيش مداخل معرفة لسه',
            text: state.knowledge.length
                ? 'جرّب كلمة تانية أو غيّر الفلتر.'
                : 'ارفع ملف فيه أسئلة وإجاباتها، وهتتحفظ كمسودات مستنية تفعيلك.'
        }));

    $('knowledgeRows').innerHTML = rows.map((entry) => `
        <tr>
          <td><span class="cell-title ltr">${esc(entry.knowledge_key)}</span></td>
          <td data-label="النسخة" class="num">${entry.version}</td>
          <td data-label="الحالة">${badge(DRAFT_STATUS_AR[entry.status] || entry.status, DRAFT_STATUS_TONE[entry.status] || 'neutral')}</td>
          <td data-label="ملاحظة" class="sub">${esc(entry.notes || '—')}</td>
          <td data-label="اتضاف" class="sub" title="${esc(fmtDate(entry.created_at, { withTime: true }))}">${esc(fmtRelative(entry.created_at))}</td>
          <td class="cell-actions">${entry.status === 'published'
              ? '<span class="sub">شغّالة</span>'
              : `<button class="btn btn--secondary btn--sm" data-publish-knowledge="${esc(entry.knowledge_key)}" data-version="${entry.version}">فعّلها</button>`}</td>
        </tr>`).join('');

    $('knowledgeRows').querySelectorAll('[data-publish-knowledge]').forEach((button) =>
        button.addEventListener('click', async () => {
            const ok = await confirmAction({
                title: 'تفعيل مدخل المعرفة ده؟',
                body: 'المحرك هيبدأ يرد منه في المحادثات الجديدة.',
                confirmLabel: 'فعّله'
            });
            if (!ok) return;

            const result = await withBusy(button, () => publishKnowledgeVersion(supabase, {
                key: button.dataset.publishKnowledge,
                version: Number(button.dataset.version)
            }));
            if (!result.success) { toast(`مااتفعلش: ${result.error}`, 'err'); return; }
            toast('اتفعّل، والمحرك هيرد منه في المحادثات الجديدة.');
            await loadKnowledge();
            renderDashboard();
        }));
}

// ── Scenario editor ──────────────────────────────────────────
function evidenceRow(token = '', weight = 3) {
    const el = document.createElement('div');
    el.className = 'evidence-row';
    el.innerHTML = `
        <input type="text" class="input ev-token ltr" placeholder="entity_whatsapp" value="${esc(token)}" aria-label="الكلمة الدالة">
        <input type="number" class="input ev-weight" min="1" max="10" value="${weight}" aria-label="الوزن">
        <button type="button" class="icon-btn ev-del" aria-label="احذف الكلمة">${icon('trash')}</button>`;
    el.querySelector('.ev-del').addEventListener('click', () => { el.remove(); previewConfidence(); });
    el.querySelectorAll('input').forEach((i) => i.addEventListener('input', previewConfidence));
    return el;
}

/**
 * Shows what the signature can actually score before it is saved.
 *
 * Confidence is a weighted average, so a signature can be perfectly valid
 * and still be unable to reach the 0.6 resolution threshold — the editor
 * would have no way to know without this. Presence figures come from the
 * evidence extractor: a glossary hit is 1.00, an Arabic word 0.80 and
 * Arabizi 0.75, which is why an Arabic-only match needs a larger share of
 * the weight than an English one to resolve.
 */
function previewConfidence() {
    const rows = [...document.querySelectorAll('.evidence-row')];
    const weights = rows.map((r) => Number(r.querySelector('.ev-weight').value) || 0)
                        .filter((w) => w > 0)
                        .sort((a, b) => b - a);
    const box = $('confidencePreview');
    if (weights.length === 0) { box.innerHTML = ''; return; }

    const total = weights.reduce((a, b) => a + b, 0);
    const share = (n) => weights.slice(0, n).reduce((a, b) => a + b, 0) / total;
    const verdict = (v) => v >= 0.6
        ? badge('يحسم', 'success')
        : badge('يسأل سؤال توضيحي', 'warning');

    box.innerHTML = `
      <p class="confidence-title">${icon('gauge')} السيناريو ده هيحسم امتى؟</p>
      <div class="confidence-row"><span>الدليل الأول لوحده — لو اتطابق من مصطلح إنجليزي</span>
        <b class="num">${share(1).toFixed(2)}</b> ${verdict(share(1))}</div>
      <div class="confidence-row"><span>نفسه لو اتطابق من كلمة عربية (×0.80)</span>
        <b class="num">${(share(1) * 0.8).toFixed(2)}</b> ${verdict(share(1) * 0.8)}</div>
      <div class="confidence-row"><span>أول دليلين مع بعض</span>
        <b class="num">${share(2).toFixed(2)}</b> ${verdict(share(2))}</div>`;
}

function wireScenarioEditor() {
    const dlg = $('scenarioDialog');
    $('addEvidenceBtn').addEventListener('click', () => {
        $('evidenceList').appendChild(evidenceRow());
        previewConfidence();
        $('evidenceList').lastElementChild.querySelector('.ev-token').focus();
    });
    $('fHasAuto').addEventListener('change', (e) => {
        $('autoTextWrap').hidden = !e.target.checked;
    });

    const isDirty = () => state.dirtySnapshot !== null && snapshotOf(dlg) !== state.dirtySnapshot;
    for (const id of ['cancelScenarioBtn', 'closeScenarioBtn']) {
        $(id).addEventListener('click', () => tryClose(dlg, isDirty));
    }
    guardUnsaved(dlg, isDirty);
    closeOnBackdrop(dlg, { guardDirty: isDirty });
    $('saveScenarioBtn').addEventListener('click', submitScenario);
}

/** كل قيم النموذج في نص واحد — أرخص طريقة نعرف بيها إن فيه تغيير. */
function snapshotOf(root) {
    return [...root.querySelectorAll('input, select, textarea')]
        .map((el) => (el.type === 'checkbox' ? String(el.checked) : el.value))
        .join('');
}

async function tryClose(dialog, isDirty) {
    if (!isDirty()) { closeDialog(dialog); return; }
    const leave = await confirmAction({
        title: 'تسيب التغييرات؟',
        body: 'فيه تعديلات مااتحفظتش. لو قفلت دلوقتي هتضيع.',
        confirmLabel: 'اقفل من غير حفظ',
        tone: 'danger'
    });
    if (leave) closeDialog(dialog);
}

function openScenarioDialog(scenario) {
    const editing = Boolean(scenario);
    $('scenarioDialogTitle').textContent = editing ? scenario.label.ar : 'سيناريو جديد';
    $('scenarioErrors').hidden = true;

    $('fId').value = scenario?.id || '';
    $('fLabelAr').value = scenario?.label.ar || '';
    $('fLabelEn').value = scenario?.label.en || '';
    $('fCategory').value = scenario?.category || 'other';
    $('fHasAuto').checked = Boolean(scenario?.resolution.hasAutoResolution);
    $('autoTextWrap').hidden = !$('fHasAuto').checked;
    $('fTextAr').value = scenario?.resolution.text?.ar || '';
    $('fTextEn').value = scenario?.resolution.text?.en || '';
    $('fRequiresTicket').checked = scenario ? scenario.requiresTicketIfUnresolved : true;
    $('fNote').value = '';

    const list = $('evidenceList');
    list.innerHTML = '';
    (scenario?.evidenceSignature || [{ token: '', weight: 3 }])
        .forEach((e) => list.appendChild(evidenceRow(e.token, e.weight)));
    previewConfidence();

    // An existing scenario opens read-only: the live catalog is a file the
    // engine loads, so editing it here would create a copy that silently
    // disagrees with what is actually answering customers. Saving always
    // creates a NEW draft, which is the reviewable path.
    $('saveScenarioBtn').textContent = editing ? 'حفظ كنسخة جديدة (مسودة)' : 'حفظ كمسودة';
    $('saveScenarioBtn').disabled = !state.isStaff;

    openDialog($('scenarioDialog'));
    state.dirtySnapshot = snapshotOf($('scenarioDialog'));
}

function collectScenario() {
    const evidence = [...document.querySelectorAll('.evidence-row')]
        .map((r) => ({
            token: r.querySelector('.ev-token').value.trim(),
            weight: Number(r.querySelector('.ev-weight').value) || 0,
            source: 'text'
        }))
        .filter((e) => e.token);

    // The schema requires a non-empty English label and answer. This
    // console is deliberately Arabic-only, so an Arabic-first team would
    // otherwise be unable to save anything at all. The Arabic falls in,
    // and the field itself says so — an English-writing customer gets
    // Arabic, which is a degradation the author chose and can see, not a
    // silent one.
    const labelAr = $('fLabelAr').value.trim();
    const textAr = $('fTextAr').value.trim();

    const scenario = {
        id: $('fId').value.trim(),
        label: { ar: labelAr, en: $('fLabelEn').value.trim() || labelAr },
        category: $('fCategory').value,
        evidenceSignature: evidence,
        discriminatingQuestions: [],
        resolution: $('fHasAuto').checked
            ? { hasAutoResolution: true, text: { ar: textAr, en: $('fTextEn').value.trim() || textAr } }
            : { hasAutoResolution: false },
        requiresTicketIfUnresolved: $('fRequiresTicket').checked
    };
    return scenario;
}

function showFormError(boxId, html) {
    const box = $(boxId);
    box.innerHTML = `${icon('alert')}<div class="alert-body">${html}</div>`;
    box.hidden = false;
    box.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

async function submitScenario() {
    const scenario = collectScenario();

    // Validated against the engine's own schema, so the editor sees exactly
    // the errors the catalog provider would raise rather than saving
    // something the engine will silently skip.
    const { valid, errors } = await validateScenarioDraft(scenario);
    if (!valid) {
        showFormError('scenarioErrors',
            '<span class="alert-title">السيناريو مش صالح</span>' + errors.map(esc).join('<br>'));
        return;
    }

    const weights = scenario.evidenceSignature.map((e) => e.weight).sort((a, b) => b - a);
    const topTwo = weights.slice(0, 2).reduce((a, b) => a + b, 0) / weights.reduce((a, b) => a + b, 0);
    if (topTwo < 0.6) {
        showFormError('scenarioErrors',
            '<span class="alert-title">التوقيع ده مش هيحسم أبدًا</span>'
            + `أقوى دليلين مع بعض بيوصلوا ${topTwo.toFixed(2)} بس، والحد المطلوب 0.60. `
            + 'قلّل عدد الأدلة أو زوّد وزن الدليل المميِّز.');
        return;
    }

    const result = await withBusy($('saveScenarioBtn'), () => saveScenarioDraft(supabase, {
        key: scenario.id,
        definition: scenario,
        authorNote: $('fNote').value.trim() || null
    }));

    if (!result.success) {
        showFormError('scenarioErrors', `<span class="alert-title">تعذّر الحفظ</span>${esc(result.error)}`);
        return;
    }

    state.dirtySnapshot = null;
    closeDialog($('scenarioDialog'));
    toast(`اتحفظت كمسودة (إصدار ${result.draftVersion}). المحرك لسه بيستخدم النسخة المنشورة.`);
    state.drafts = await listStoredScenarioVersions(supabase);
    $('draftCount').textContent = state.drafts.length;
    renderDrafts();
    renderScenarios();
    renderDashboard();
}

// ═════════════════════════════════════════════════════════════
// رفع ملف سيناريوهات
// ═════════════════════════════════════════════════════════════
/**
 * ── WHY A FILE AT ALL ───────────────────────────────────────
 * The dialog above is the right shape for editing one scenario and the
 * wrong shape for the way support knowledge actually arrives: already
 * written down, forty at a time, in a doc or a PDF from whoever ran
 * support before. Retyping that into a modal is how a catalog stays
 * half-finished.
 *
 * ── WHY IT IS STILL SAFE ────────────────────────────────────
 * Nothing imported goes live. Every entry is saved as a DRAFT through
 * the same saveScenarioDraft() the dialog uses, so the running engine
 * keeps answering from the published catalog until someone presses
 * «فعّلها» on a specific version. A bad file costs a review, not an
 * incident.
 *
 * Parsing is done by the engine-side parser (sie-content-import.js) and
 * validated by the engine's own validators, so this file decides nothing
 * about what a valid scenario is — it only shows the verdict.
 */
const TEMPLATE_PATH = '../docs/نموذج-إضافة-سيناريو.md';

/** jsDelivr, pinned. Loaded only when a PDF is actually picked. */
const PDFJS_VERSION = '4.10.38';
const PDFJS_BASE = `https://cdn.jsdelivr.net/npm/pdfjs-dist@${PDFJS_VERSION}/build`;

function wireImportDialog() {
    const dlg = $('importDialog');

    // `method="dialog"` means an Enter keypress in the token search would
    // close the dialog and throw away a parsed file.
    $('importForm').addEventListener('submit', (e) => e.preventDefault());

    $('importScenarioBtn').addEventListener('click', () => {
        resetImportDialog();
        openDialog(dlg);
    });
    for (const id of ['cancelImportBtn', 'closeImportBtn']) {
        $(id).addEventListener('click', () => closeDialog(dlg));
    }
    closeOnBackdrop(dlg);
    $('confirmImportBtn').addEventListener('click', saveImportedEntries);
    $('downloadTemplateBtn').addEventListener('click', downloadTemplate);

    $('showTokensBtn').addEventListener('click', () => {
        const box = $('tokenCatalog');
        box.hidden = !box.hidden;
        if (!box.hidden) { renderTokenCatalog(''); $('tokenSearch').focus(); }
    });
    $('tokenSearch').addEventListener('input', (e) => renderTokenCatalog(e.target.value));

    const zone = $('importDropzone');
    const file = $('importFile');
    file.addEventListener('change', () => { if (file.files[0]) readImportFile(file.files[0]); });

    // The label already opens the picker on click; these only add drag.
    ['dragenter', 'dragover'].forEach((type) =>
        zone.addEventListener(type, (e) => { e.preventDefault(); zone.classList.add('is-over'); }));
    ['dragleave', 'drop'].forEach((type) =>
        zone.addEventListener(type, () => zone.classList.remove('is-over')));
    zone.addEventListener('drop', (e) => {
        e.preventDefault();
        const dropped = e.dataTransfer?.files?.[0];
        if (dropped) readImportFile(dropped);
    });
}

function resetImportDialog() {
    state.importParsed = null;
    $('importFile').value = '';
    $('importStatus').hidden = true;
    $('importPreview').hidden = true;
    $('importPreview').innerHTML = '';
    $('importSummary').textContent = '';
    $('confirmImportBtn').disabled = true;
    $('tokenCatalog').hidden = true;
}

function importStatus(message, kind = 'info') {
    const box = $('importStatus');
    box.className = `alert alert--${kind === 'err' ? 'danger' : kind === 'warn' ? 'warning' : kind === 'ok' ? 'success' : 'info'}`;
    box.innerHTML = `${icon(kind === 'err' ? 'alert' : kind === 'ok' ? 'checkCircle' : 'info')}<div class="alert-body">${esc(message)}</div>`;
    box.hidden = false;
}

/**
 * Fetched rather than linked so a missing file is reported instead of
 * silently downloading a 404 page named like the template.
 */
async function downloadTemplate(e) {
    e.preventDefault();
    try {
        const response = await fetch(TEMPLATE_PATH);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const url = URL.createObjectURL(await response.blob());
        const a = document.createElement('a');
        a.href = url;
        a.download = 'نموذج-إضافة-سيناريو.md';
        a.click();
        URL.revokeObjectURL(url);
    } catch (err) {
        importStatus(`مقدرتش أنزّل النموذج (${err.message}).`, 'err');
    }
}

function renderTokenCatalog(query) {
    const q = query.trim().toLowerCase();
    const rows = Object.entries(TOKEN_LABELS)
        .filter(([token, label]) => !q || token.toLowerCase().includes(q) || label.toLowerCase().includes(q))
        .slice(0, 200);

    $('tokenList').innerHTML = rows.length
        ? rows.map(([token, label]) =>
            `<div class="token-item"><code>${esc(token)}</code><span>${esc(label)}</span></div>`).join('')
        : '<p class="sub">مفيش كلمة مطابقة.</p>';
}

/**
 * Lets an author write «واتساب» where the engine wants
 * `entity_whatsapp`. Built from the engine's own glossary labels, so it
 * cannot drift from what the tokens actually mean.
 */
function buildTokenResolver() {
    const byLabel = new Map();
    for (const [token, label] of Object.entries(TOKEN_LABELS)) {
        byLabel.set(label.trim().toLowerCase(), token);
    }
    return (written) => {
        const raw = String(written).trim();
        if (TOKEN_LABELS[raw]) return raw;           // already a token
        return byLabel.get(raw.toLowerCase()) || raw;
    };
}

async function readImportFile(file) {
    resetImportDialog();
    importStatus(`بقرا «${file.name}»…`);

    let text;
    try {
        text = /\.pdf$/i.test(file.name) || file.type === 'application/pdf'
            ? await extractPdfText(file)
            : await file.text();
    } catch (err) {
        importStatus(`مقدرتش أقرا الملف: ${err.message}`, 'err');
        return;
    }

    const parsed = parseContentDocument(text, { resolveToken: buildTokenResolver() });
    if (parsed.errors.length) {
        importStatus(parsed.errors.join(' '), 'err');
        return;
    }

    state.importParsed = parsed;
    renderImportPreview(parsed);
}

/**
 * pdf.js is ~1 MB and most imports are markdown, so it is fetched only
 * when a PDF is actually chosen — never on page load.
 */
async function extractPdfText(file) {
    importStatus('بحمّل قارئ الـ PDF…');
    const pdfjs = await import(/* @vite-ignore */ `${PDFJS_BASE}/pdf.min.mjs`);
    pdfjs.GlobalWorkerOptions.workerSrc = `${PDFJS_BASE}/pdf.worker.min.mjs`;

    const doc = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise;
    const pages = [];
    for (let i = 1; i <= doc.numPages; i += 1) {
        importStatus(`بقرا صفحة ${i} من ${doc.numPages}…`);
        const content = await (await doc.getPage(i)).getTextContent();
        // hasEOL is what preserves the line structure the parser reads
        // headings and list items from. Joining on spaces alone would
        // flatten the whole document into one unparseable line.
        let line = '';
        const lines = [];
        for (const item of content.items) {
            line += item.str;
            if (item.hasEOL) { lines.push(line); line = ''; }
        }
        if (line) lines.push(line);
        pages.push(lines.join('\n'));
    }
    return pages.join('\n\n');
}

function renderImportPreview(parsed) {
    const good = parsed.entries.filter((e) => e.valid);
    const bad = parsed.entries.filter((e) => !e.valid);

    const verdict = (entry) => entry.valid
        ? (entry.warnings.length ? badge('فيه ملاحظة', 'warning') : badge('جاهز', 'success'))
        : badge('فيه غلط', 'danger');

    $('importPreview').innerHTML = parsed.entries.map((entry) => `
        <div class="import-item ${entry.valid ? '' : 'is-invalid'}">
          <div class="import-item-head">
            <b>${esc(entry.title)}</b>
            <span class="sub">${entry.kind === 'knowledge' ? 'معرفة' : 'سيناريو'} · سطر ${entry.line}</span>
            ${verdict(entry)}
          </div>
          ${entry.errors.length ? `<ul class="import-errors">${entry.errors.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}
          ${entry.warnings.length ? `<ul class="import-warnings">${entry.warnings.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}
        </div>`).join('');
    $('importPreview').hidden = false;

    // A file with one bad entry still imports the rest — an all-or-nothing
    // rule would mean a typo on scenario 3 blocks the other 29.
    $('importSummary').textContent = bad.length
        ? `${good.length} هيتحفظوا، و${bad.length} فيهم غلط مش هيتحفظوا.`
        : `${good.length} جاهزين للحفظ.`;
    $('confirmImportBtn').disabled = good.length === 0;
    importStatus(
        bad.length
            ? 'راجع اللي فيه غلط تحت. اللي جاهز هيتحفظ عادي كمسودة.'
            : 'كله سليم. اضغط «احفظ المسودات».',
        bad.length ? 'warn' : 'ok'
    );
}

async function saveImportedEntries() {
    const parsed = state.importParsed;
    if (!parsed) return;

    const btn = $('confirmImportBtn');
    btn.disabled = true;

    const pending = parsed.entries.filter((e) => e.valid);
    const failures = [];
    let saved = 0;

    // Sequential on purpose: each draft insert reads the current max
    // version for its key, and the RLS-checked writes are cheap. Firing
    // thirty at once buys nothing and makes a partial failure harder to
    // report honestly.
    for (const [i, entry] of pending.entries()) {
        importStatus(`بحفظ ${i + 1} من ${pending.length}…`);
        const params = {
            key: entry.value.id || entry.value.key,
            definition: entry.value,
            authorNote: `اترفع من ملف — سطر ${entry.line}`
        };
        const result = entry.kind === 'knowledge'
            ? await saveKnowledgeDraft(supabase, params)
            : await saveScenarioDraft(supabase, params);

        if (result.success) saved += 1;
        else failures.push(`${entry.title}: ${result.error}`);
    }

    state.drafts = await listStoredScenarioVersions(supabase);
    $('draftCount').textContent = state.drafts.length;
    renderDrafts();
    renderScenarios();

    if (failures.length) {
        importStatus(`اتحفظ ${saved}، وفشل ${failures.length}: ${failures.join(' — ')}`, 'err');
        btn.disabled = false;
        return;
    }

    closeDialog($('importDialog'));
    // The drafts panel below the table lists scenarios only, so pointing
    // at it after a knowledge-only import would send someone looking for
    // something that is not there.
    const anyScenario = pending.some((e) => e.kind === 'scenario');
    toast(anyScenario
        ? `اتحفظ ${saved} كمسودات. افتح «السيناريوهات اللي إنت ضفتها» عشان تفعّلهم.`
        : `اتحفظ ${saved} مدخل معرفة كمسودات، مستنيين التفعيل.`);
    if (pending.some((e) => e.kind === 'knowledge')) await loadKnowledge();
    renderDashboard();
}

// ═════════════════════════════════════════════════════════════
// Operation — real switches, saved to Supabase, obeyed by the engine
// ═════════════════════════════════════════════════════════════
async function loadSettings() {
    // `fresh` so an admin never sees a cached value on a page whose whole
    // purpose is showing the current one.
    state.settings = await getSieSettings(supabase, { fresh: true });
    state.settingsGroup = state.settingsGroup || groupedSettings()[0].id;

    renderSettingsNav();
    renderSettingGroups();
    renderLiveBanner();

    $('settingSearch').addEventListener('input', debounce(() => {
        renderSettingsNav();
        renderSettingGroups();
    }, 140));
}

/** الأرقام اللي «أسلوب المحرك» بيتحكم فيها — أي تعديل بإيد فيها يرجّعه لـ«مخصص». */
const PROFILE_KEYS = new Set(Object.keys(behaviorProfileValues('balanced') || {}));

const changedInGroup = (group) =>
    group.settings.filter((s) => state.settings[s.key] !== SIE_DEFAULT_SETTINGS[s.key]).length;

function changedSettingsCount() {
    return Object.keys(SIE_DEFAULT_SETTINGS).filter(
        (key) => key !== 'engine_enabled' && state.settings[key] !== SIE_DEFAULT_SETTINGS[key]
    ).length;
}

const settingsQuery = () => $('settingSearch').value.trim().toLowerCase();

/** الإعدادات اللي بتطابق البحث، عبر كل المجموعات. */
function matchingSettings(group) {
    const q = settingsQuery();
    if (!q) return group.settings;
    return group.settings.filter((def) =>
        `${def.title} ${def.desc} ${def.key}`.toLowerCase().includes(q));
}

/**
 * قائمة أقسام الإعدادات.
 *
 * Sections rather than one long page of accordions: an operator changing
 * "how sure before answering" is deciding one thing, and a page that shows
 * all forty-five switches at once makes them scroll past forty-four of
 * them to reach it.
 */
function renderSettingsNav() {
    const groups = groupedSettings();
    const searching = Boolean(settingsQuery());

    $('settingsNav').innerHTML = groups.map((group) => {
        const matches = matchingSettings(group).length;
        const changed = changedInGroup(group);
        const disabled = searching && matches === 0;
        return `
          <button type="button" class="settings-nav-item${group.id === state.settingsGroup && !searching ? ' is-active' : ''}"
                  data-group="${esc(group.id)}" ${disabled ? 'disabled' : ''}>
            <span class="settings-nav-text">
              <b>${esc(group.title)}</b>
              <span class="sub">${esc(group.desc)}</span>
            </span>
            ${searching
                ? `<span class="badge badge--count badge--neutral">${matches}</span>`
                : changed ? `<span class="badge badge--count badge--primary">${changed}</span>` : ''}
          </button>`;
    }).join('');

    $('settingsNav').querySelectorAll('[data-group]').forEach((button) =>
        button.addEventListener('click', () => {
            state.settingsGroup = button.dataset.group;
            $('settingSearch').value = '';
            renderSettingsNav();
            renderSettingGroups();
        }));

    const changed = changedSettingsCount();
    $('settingsSummary').innerHTML = changed
        ? `${icon('info')} <span><b class="num">${changed}</b> إعداد متغيّر عن المعتاد.</span>`
        : `${icon('checkCircle')} <span>كل الإعدادات على القيم المعتادة.</span>`;
}

/**
 * كل المجموعات والعناصر، مرسومة من الوصف الواحد.
 *
 * أثناء البحث بترسم كل النتائج عبر المجموعات؛ من غير بحث بترسم القسم
 * المفتوح بس.
 */
function renderSettingGroups() {
    const container = $('settingGroups');
    const searching = Boolean(settingsQuery());
    const groups = searching
        ? groupedSettings().filter((group) => matchingSettings(group).length)
        : groupedSettings().filter((group) => group.id === state.settingsGroup);

    if (groups.length === 0) {
        container.innerHTML = emptyState({
            iconName: 'search', title: 'مفيش إعداد مطابق',
            text: 'جرّب كلمة أقصر، أو امسح البحث وافتح القسم من القائمة.'
        });
        return;
    }

    container.innerHTML = groups.map((group) => `
        <section class="settings-section" id="settings-${esc(group.id)}">
          <header class="settings-section-head">
            <div>
              <h2>${esc(group.title)}</h2>
              <p class="hint">${esc(group.desc)}</p>
            </div>
            ${changedInGroup(group)
                ? `<span class="badge badge--primary">${changedInGroup(group)} متغيّر</span>` : ''}
          </header>
          <div class="setting-list">
            ${matchingSettings(group).map(renderSetting).join('')}
          </div>
        </section>`).join('');

    wireSettingInputs();

    if (!state.isStaff) {
        container.querySelectorAll('input, select').forEach((el) => { el.disabled = true; });
    }
}

/** One control, chosen by the setting's own declared type. */
function renderSetting(def) {
    const value = state.settings[def.key];
    const active = isSettingActive(def, state.settings);
    const disabled = !state.isStaff || !active;
    const cls = `setting-row${active ? '' : ' is-inert'}`;
    const inert = !active
        ? `<span class="setting-inert">${icon('lock')} متعطّل لأن «${esc(SETTINGS_BY_KEY[def.dependsOn].title)}» مقفول.</span>`
        : '';
    const changed = value !== SIE_DEFAULT_SETTINGS[def.key]
        ? '<span class="setting-changed" title="متغيّر عن القيمة المعتادة"></span>' : '';

    if (def.type === 'boolean') {
        const on = value !== false;
        return `
        <div class="${cls}${on ? '' : ' is-off'}" data-key="${esc(def.key)}" data-type="boolean">
          <div class="setting-text">
            <b>${changed}${esc(def.title)}</b>
            <span class="sub">${esc(def.desc)}</span>
            ${!on && def.warn ? `<span class="setting-warn">${icon('alert')} ${esc(def.warn)}</span>` : ''}
            ${inert}
          </div>
          <div class="setting-control">
            <label class="switch">
              <input type="checkbox" ${on ? 'checked' : ''} ${disabled ? 'disabled' : ''}
                     aria-label="${esc(def.title)}">
              <span class="slider"></span>
            </label>
          </div>
        </div>`;
    }

    if (def.type === 'number') {
        return `
        <div class="${cls}" data-key="${esc(def.key)}" data-type="number">
          <div class="setting-text">
            <b>${changed}${esc(def.title)}</b>
            <span class="sub">${esc(def.desc)}</span>
            ${inert}
          </div>
          <div class="setting-control setting-number">
            <input type="number" class="num-box" min="${def.min}" max="${def.max}" step="${def.step || 1}"
                   value="${value}" dir="ltr" ${disabled ? 'disabled' : ''}
                   aria-label="${esc(def.title)}">
            <input type="range" min="${def.min}" max="${def.max}" step="${def.step || 1}"
                   value="${value}" ${disabled ? 'disabled' : ''} tabindex="-1" aria-hidden="true">
            <output>${numberHint(def, value)}</output>
          </div>
        </div>`;
    }

    // enum
    return `
    <div class="${cls}" data-key="${esc(def.key)}" data-type="enum">
      <div class="setting-text">
        <b>${changed}${esc(def.title)}</b>
        <span class="sub">${esc(def.desc)}</span>
      </div>
      <div class="setting-control setting-choices">
        ${def.options.map((o) => `
          <label class="radio-card ${o.value === value ? 'is-picked' : ''}">
            <input type="radio" name="${esc(def.key)}" value="${esc(o.value)}"
                   ${o.value === value ? 'checked' : ''} ${disabled ? 'disabled' : ''}>
            <span class="radio-card-label">${esc(o.label)}</span>
            ${o.desc ? `<span class="radio-card-desc">${esc(o.desc)}</span>` : ''}
          </label>`).join('')}
      </div>
    </div>`;
}

/**
 * «مستوى التأكد» جواه كسور، والباقي أعداد صحيحة. عرض 0.6 كنسبة أوضح
 * بكتير لموظف من رقم عشري.
 */
function formatNumber(def, value) {
    if (def.key === 'answer_confidence') return `${Math.round(value * 100)}٪`;
    if (def.key === 'memory_context_minutes') {
        return value >= 60 ? `${Math.round((value / 60) * 10) / 10} ساعة` : `${value} دقيقة`;
    }
    return String(value);
}

/**
 * الصيغة المقروءة جنب الخانة — وبس لما تضيف معلومة.
 * «١٠٠» جنب «١٠٠» رقم مكرر بياخد مساحة ومابيقولش حاجة؛ «٧٠٪» جنب
 * «0.7» بيقول اللي الرقم الخام مابيقولهوش.
 */
function numberHint(def, value) {
    const formatted = formatNumber(def, value);
    return formatted === String(value) ? '' : formatted;
}

function wireSettingInputs() {
    const rows = $('settingGroups').querySelectorAll('.setting-row');

    rows.forEach((row) => {
        const key = row.dataset.key;
        const type = row.dataset.type;

        if (type === 'boolean') {
            row.querySelector('input').addEventListener('change', (e) => {
                commitSetting(key, e.target.checked, e.target, () => { e.target.checked = !e.target.checked; });
            });
            return;
        }

        if (type === 'number') {
            const range = row.querySelector('input[type=range]');
            const box = row.querySelector('.num-box');
            const out = row.querySelector('output');
            const def = SETTINGS_BY_KEY[key];

            // Two controls over one value. The slider is for "roughly
            // more/less"; the box is for "exactly 100" — which a slider
            // spanning thousands of steps cannot express, and which is
            // the only way most of these numbers are ever decided.
            const paint = (v) => {
                range.value = v;
                box.value = v;
                out.textContent = numberHint(def, v);
            };

            // Clamped here rather than trusted to the browser: typing a
            // number outside min/max leaves the input valid-looking in
            // several browsers, and the database would reject it later
            // with a message nobody connects to what they typed.
            const clamp = (raw) => {
                const n = Number(raw);
                if (!Number.isFinite(n)) return null;
                return Math.min(Math.max(n, def.min), def.max);
            };

            // Live label while dragging, one save on release — a save per
            // pixel would be dozens of writes for one decision.
            range.addEventListener('input', () => {
                box.value = range.value;
                out.textContent = numberHint(def, Number(range.value));
            });
            range.addEventListener('change', () => {
                const previous = state.settings[key];
                commitSetting(key, Number(range.value), range, () => paint(previous));
            });

            // Typing updates the slider but does NOT save on every
            // keystroke: "1" on the way to "100" is a real value the
            // engine would briefly obey.
            box.addEventListener('input', () => {
                const n = clamp(box.value);
                if (n !== null) {
                    range.value = n;
                    out.textContent = numberHint(def, n);
                }
            });

            const commitBox = () => {
                const previous = state.settings[key];
                const n = clamp(box.value);
                if (n === null) { paint(previous); return; }   // empty or nonsense
                if (n === previous) { paint(previous); return; } // nothing to save
                paint(n);
                commitSetting(key, n, box, () => paint(previous));
            };
            box.addEventListener('change', commitBox);
            box.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') { e.preventDefault(); box.blur(); }
            });
            return;
        }

        row.querySelectorAll('input[type=radio]').forEach((radio) => {
            radio.addEventListener('change', () => {
                const previous = state.settings[key];
                commitSetting(key, radio.value, radio, () => {
                    const back = row.querySelector(`input[value="${previous}"]`);
                    if (back) back.checked = true;
                });
            });
        });
    });
}

/**
 * Saves one value and reconciles the page with what the database accepted.
 *
 * `revert` runs on failure: leaving a control showing a value the database
 * rejected is worse than showing the error, because the next person to look
 * at the page would believe it.
 */
async function commitSetting(key, value, control, revert) {
    control.disabled = true;
    const { error } = await saveSieSetting(supabase, key, value);
    control.disabled = false;

    if (error) {
        revert();
        toast(`مااتحفظش: ${error.message}`, 'err');
        return;
    }

    state.settings[key] = value;

    // «أسلوب المحرك» بيظبط كذا رقم مرة واحدة، وأي تعديل بإيد على رقم منهم
    // بيرجّعه لـ«مخصص» — عشان اللوحة ماتقولش أسلوب هو مش شغّال فعلاً.
    if (key === 'behavior_profile') {
        await applyBehaviorProfile(value);
    } else if (PROFILE_KEYS.has(key)) {
        const detected = detectBehaviorProfile(state.settings);
        if (detected !== state.settings.behavior_profile) {
            state.settings.behavior_profile = detected;
            await saveSieSetting(supabase, 'behavior_profile', detected);
        }
    }

    renderSettingsNav();
    renderSettingGroups();
    renderLiveBanner();
    renderDashboard();
    toast('اتحفظ، وشغّال على المحادثات الجديدة على طول.');
}

/**
 * «أسلوب المحرك»: بيكتب الأرقام اللي وراه واحدة واحدة.
 *
 * Written individually rather than as one blob because each value has to
 * pass the schema's own validation — a preset is a convenience for the
 * operator, not a way around the rules.
 */
async function applyBehaviorProfile(profile) {
    const values = behaviorProfileValues(profile);
    if (!values) return; // «مخصص» معناه ماتلمسش الأرقام

    for (const [key, value] of Object.entries(values)) {
        const { error } = await saveSieSetting(supabase, key, value);
        if (error) {
            toast(`مااتحفظش «${SETTINGS_BY_KEY[key].title}»: ${error.message}`, 'err');
            return;
        }
        state.settings[key] = value;
    }
}

function renderLiveBanner() {
    const banner = $('liveBanner');
    if (state.settings.engine_enabled === false) {
        banner.className = 'live-banner live-banner--off';
        banner.innerHTML = `${icon('power')}
            <div><b>المحرك الذكي متوقف دلوقتي.</b>
            <span class="sub">العملاء بيرد عليهم البوت العادي لحد ما تفتحه تاني.</span></div>`;
        return;
    }

    banner.className = 'live-banner live-banner--on';
    // Counts what differs from the shipped defaults, not what is merely
    // off: several settings ship off, so counting "off" would report
    // changes on a console nobody has ever touched.
    const changed = changedSettingsCount();
    banner.innerHTML = `${icon('checkCircle')}
        <div><b>المحرك الذكي شغّال${changed ? `، مع ${changed} إعداد متغيّر عن المعتاد` : ' بكل الإعدادات المعتادة'}.</b>
        <span class="sub">أي تغيير هنا بيتحفظ فورًا وبيسري على المحادثات الجديدة على طول.</span></div>`;
}

// ═════════════════════════════════════════════════════════════
// التشخيص — تجربة رسالة
// ═════════════════════════════════════════════════════════════
const TRY_SAMPLES = ['الاشتراك بتاعي منتهي', 'الواتساب مش مربوط', 'نسيت الباسورد'];

function wireDiagnostics() {
    $('tryBtn').addEventListener('click', runDiagnosisPreview);
    $('tryInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') runDiagnosisPreview(); });

    $('trySamples').innerHTML = '<span class="sub">جرّب مثلاً:</span>'
        + TRY_SAMPLES.map((text) => `<button type="button" class="chip chip--action" data-sample="${esc(text)}">${esc(text)}</button>`).join('');
    $('trySamples').querySelectorAll('[data-sample]').forEach((button) =>
        button.addEventListener('click', () => {
            $('tryInput').value = button.dataset.sample;
            runDiagnosisPreview();
        }));
}

/**
 * Runs the message through Language -> Diagnostics -> Ranking only.
 * Stops before Decision and Action deliberately, so a preview can never
 * write a message, open a ticket or spend a customer's quota.
 */
async function runDiagnosisPreview() {
    const text = $('tryInput').value.trim();
    const box = $('tryResult');
    if (!text) return;

    box.hidden = false;
    box.innerHTML = '<div class="loading-block"><span class="loading-dot"></span> بشغّل المحرك على الرسالة…</div>';
    try {
        const { normalize } = await import('/sie/language/normalizer.js');
        const { processTurn } = await import('/sie/diagnostics/diagnostic-engine.js');
        const { rankDiagnosticState } = await import('/sie/ranking/ranking-engine.js');

        const { normalizedTokens } = await normalize(text);
        const diagnosticState = await processTurn({ normalizedTokens, turn: 1 });
        const ranking = await rankDiagnosticState(diagnosticState);
        const top = ranking.ranked.slice(0, 4).filter((r) => r.hypothesis.confidence > 0);

        if (top.length === 0) {
            box.innerHTML = emptyState({
                iconName: 'search',
                title: 'المحرك مافهمش الرسالة دي',
                text: 'هيسأل العميل يوضّح أكتر. لو دي حالة متكررة عندك، ضيفها من صفحة السيناريوهات.',
                action: '<a class="btn btn--secondary btn--sm" href="#/scenarios">افتح السيناريوهات</a>'
            });
            return;
        }

        const best = top[0];
        const willAnswer = best.hypothesis.confidence >= 0.6;
        box.innerHTML = `
          <div class="verdict verdict--${willAnswer ? 'ok' : 'ask'}">
            ${icon(willAnswer ? 'checkCircle' : 'alert')}
            <div>
              <b>${willAnswer
                  ? `هيتعامل معاها كـ «${esc(best.scenario?.label.ar || best.hypothesis.scenarioId)}»`
                  : 'مش متأكد كفاية، فهيسأل العميل سؤال توضيحي الأول'}</b>
              <span class="sub">الحد المطلوب للحسم هو ٦٠٪.</span>
            </div>
          </div>
          <ul class="rank-list">
            ${top.map((r) => {
                const pct = Math.round(r.hypothesis.confidence * 100);
                return `
                <li class="rank-row">
                  <span class="rank-name">${esc(r.scenario?.label.ar || r.hypothesis.scenarioId)}</span>
                  <span class="rank-meter">${meter(pct, pct >= 60 ? 'success' : 'warning')}</span>
                  <b class="num">${pct}%</b>
                </li>`;
            }).join('')}
          </ul>`;
    } catch (err) {
        box.innerHTML = errorState(err.message);
    }
}

// ═════════════════════════════════════════════════════════════
// Users
// ═════════════════════════════════════════════════════════════
async function loadUsers() {
    const notice = $('usersNotice');
    if (!state.isSieAdmin) {
        notice.hidden = false;
        notice.className = 'alert alert--info';
        notice.innerHTML = `${icon('info')}<div class="alert-body">`
            + 'السماح للعملاء متاح لمسؤول المحرك بس. تقدر تشوف القائمة، لكن الحفظ هيترفض من قاعدة البيانات.'
            + '</div>';
    }

    const [{ data: profiles, error: pErr }, { data: access }, rateLimits] = await Promise.all([
        supabase.from('profiles').select('id, full_name, email, role').order('created_at', { ascending: false }),
        supabase.from('customer_sie_access').select('*'),
        // One RPC for the whole table rather than one per row, and it
        // already degrades to [] for a caller without the permission.
        getRateLimitStatus(supabase)
    ]);

    if (pErr) {
        $('userRows').innerHTML = '';
        $('userEmpty').hidden = false;
        $('userEmpty').innerHTML = errorState(`تعذّر تحميل المستخدمين: ${pErr.message}`);
        $('userStats').innerHTML = '';
        return;
    }

    const byUser = new Map((access || []).map((a) => [a.user_id, a]));
    const rateLimitByUser = new Map((rateLimits || []).map((r) => [r.user_id, r]));

    // استهلاك الـtokens بيانات مساندة: لو RLS مخبّيها أو اتأخرت، الجدول
    // لازم يفضل شغّال. عشان كده بتتقرا لوحدها وفشلها مابيوقفش الصفحة.
    let tokensByUser = new Map();
    try {
        const rows = await sieQuotaService.getUsersQuotas();
        tokensByUser = new Map(rows.map((r) => [r.user_id, r.tokensUsed]));
    } catch (err) {
        console.warn('[settings] تعذّر قراءة استهلاك الـtokens:', err?.message || err);
    }
    state.users = (profiles || []).map((p) => ({
        id: p.id,
        name: p.full_name || '—',
        email: p.email || '',
        role: p.role,
        access: byUser.get(p.id) || null,
        rateLimit: rateLimitByUser.get(p.id) || null,
        quota: quotaMetrics(byUser.get(p.id) || null, tokensByUser.get(p.id) ?? null)
    }));

    const enabled = state.users.filter((u) => evaluateSieAccessRow(u.access).available).length;
    // «قرّب من الحد» و«مستنفد» هما الرقمين اللي بيخلوا الأدمن يتحرك قبل
    // ما العميل يتقفل عليه الباب — أنفع من عدد اللي عندهم حد.
    const nearLimit = state.users.filter((u) => ['warning', 'almost'].includes(u.quota?.status)).length;
    const exhausted = state.users.filter((u) => u.quota?.status === 'exhausted').length;
    const limited = state.users.filter((u) => u.access && u.access.access_mode !== 'unlimited').length;

    $('userStats').innerHTML = [
        statCard({ label: 'كل المستخدمين', value: fmtNumber(state.users.length), iconName: 'users' }),
        statCard({ label: 'مسموح لهم', value: fmtNumber(enabled), iconName: 'checkCircle', tone: 'success' }),
        statCard({ label: 'مش مسموح', value: fmtNumber(state.users.length - enabled), iconName: 'lock', tone: 'neutral' }),
        statCard({ label: 'عندهم حد استخدام', value: fmtNumber(limited), iconName: 'gauge', tone: 'neutral' })
    ].join('');

    $('usageStats').innerHTML = [
        statCard({ label: 'حسابات برصيد محدد', value: fmtNumber(state.users.filter((u) => u.access?.access_mode === 'quota').length), iconName: 'usage' }),
        statCard({ label: 'قرّبوا من الحد', value: fmtNumber(nearLimit), iconName: 'alert', tone: nearLimit ? 'warning' : 'neutral' }),
        statCard({ label: 'مستنفدين', value: fmtNumber(exhausted), iconName: 'lock', tone: exhausted ? 'danger' : 'neutral' }),
        statCard({
            label: 'استثناءات حد المعدل',
            value: fmtNumber(state.users.filter((u) => u.rateLimit?.is_overridden).length),
            iconName: 'zap', tone: 'neutral'
        })
    ].join('');

    $('userSearch').addEventListener('input', debounce(() => { state.userPage = 1; renderUsers(); }));
    $('userFilter').addEventListener('input', () => { state.userPage = 1; renderUsers(); });
    $('usageSearch').addEventListener('input', debounce(() => { state.usagePage = 1; renderUsage(); }));
    $('usageFilter').addEventListener('input', () => { state.usagePage = 1; renderUsage(); });

    renderUsers();
    renderUsage();
}

const quotaTone = (status) => ({
    success: 'success', warning: 'warning', danger: 'danger', neutral: 'neutral'
}[quotaStatus[status]?.tone] || 'neutral');

/**
 * الاستهلاك مع حالته. الرقم لوحده («٨٠ / ١٠٠») مابيقولش إن ده قرّب من
 * الحد، والنسبة هي اللي بتخلي الأدمن ياخد باله قبل ما تخلص.
 * التصنيف نفسه بيجي من quotaMetrics عشان يبقى واحد في كل الشاشات.
 */
function quotaCell(quota, valueHtml) {
    if (!quota || quota.status === 'unavailable') return `<span class="sub">—</span>`;
    const label = quotaStatus[quota.status]?.label || '';
    const pct = quota.total ? `<span class="sub num">${quota.percentage}٪</span>` : '';
    const tokens = quota.tokensUsed === null || quota.tokensUsed === undefined
        ? '' : `<span class="sub"><b class="num">${fmtNumber(quota.tokensUsed)}</b> توكن</span>`;
    return `<div class="usage-cell">
              ${valueHtml}
              ${badge(label, quotaTone(quota.status))}
              ${pct}${tokens}
            </div>`;
}

/**
 * The rate-limit cell: the effective ceiling, and whether it came from the
 * global setting or an exception on this customer. Which of the two is in
 * force matters more than the number — an admin changing the global
 * default needs to see at a glance who will not follow it.
 */
function rateLimitCell(status) {
    if (!status) return '<span class="sub">—</span>';
    if (status.effective_enabled === false) {
        return `<div class="usage-cell"><span>مقفول</span>
                <span class="sub">${status.is_overridden ? 'استثناء' : 'الإعداد العام'}</span></div>`;
    }
    const pressure = describeRateLimitPressure(status);
    const pressed = pressure.level === 'critical' || pressure.level === 'exhausted';
    const window = Number(status.window_requests) > 0
        ? ` · <b class="num">${Number(status.window_requests)}</b> آخر دقيقة` : '';
    // الرقم في عنصر معزول لوحده: «100/دقيقة» في نص عربي بيتقلب حسب
    // خوارزمية الاتجاه، والفصل بيمنع ده تمامًا.
    return `<div class="usage-cell${pressed ? ' is-pressed' : ''}">
              <span><b class="num">${Number(status.effective_limit)}</b> طلب/دقيقة</span>
              <span class="sub">${status.is_overridden ? 'استثناء' : 'الإعداد العام'}${window}</span>
            </div>`;
}

function usageText(user) {
    if (!user.access) return '—';
    return user.access.access_mode === 'quota'
        ? `${user.access.messages_used ?? 0} / ${user.access.message_quota ?? '—'}`
        : `${user.access.messages_used ?? 0}`;
}

/** «١٢٨٤ رسالة» — الرقم معزول والكلمة عربية، عشان الاتنين مايتقلبوش. */
function usageCellText(user) {
    if (!user.access) return '<span class="sub">—</span>';
    return user.access.access_mode === 'quota'
        ? `<span class="num">${esc(usageText(user))}</span>`
        : `<span><b class="num">${user.access.messages_used ?? 0}</b> رسالة</span>`;
}

function userIdentityCell(user) {
    return `<div class="user-cell">
              ${avatar(user.name, user.email)}
              <span class="user-text">
                <span class="cell-title">${esc(user.name)}</span>
                <span class="cell-sub">${esc(user.email)}</span>
              </span>
            </div>`;
}

function filteredUsers() {
    const q = $('userSearch').value.trim().toLowerCase();
    const filter = $('userFilter').value;

    return state.users.filter((u) => {
        const status = evaluateSieAccessRow(u.access);
        if (filter === 'enabled' && !status.available) return false;
        if (filter === 'disabled' && status.available) return false;
        if (!q) return true;
        return `${u.name} ${u.email}`.toLowerCase().includes(q);
    });
}

function renderUsers() {
    const rows = filteredUsers();
    const pageCount = Math.max(1, Math.ceil(rows.length / USERS_PER_PAGE));
    state.userPage = Math.min(Math.max(1, state.userPage), pageCount);
    const start = (state.userPage - 1) * USERS_PER_PAGE;
    const page = rows.slice(start, start + USERS_PER_PAGE);

    $('userCount').textContent = rows.length === 0 ? ''
        : rows.length <= USERS_PER_PAGE ? `${rows.length} مستخدم`
        : `${start + 1}–${start + page.length} من ${rows.length} مستخدم`;

    $('userEmpty').hidden = rows.length > 0;
    $('userEmpty').innerHTML = rows.length > 0 ? '' : emptyState({
        iconName: 'users', title: 'مفيش مستخدمين مطابقين',
        text: 'جرّب اسم أو بريد تاني، أو شيل الفلتر.'
    });

    $('userRows').innerHTML = page.map((u) => {
        const s = evaluateSieAccessRow(u.access);
        /* USERS_ROW_TEMPLATE — عدد الخانات هنا لازم يساوي عدد الأعمدة في الترويسة */
        return `
        <tr>
          <td>${userIdentityCell(u)}</td>
          <td data-label="الحالة">${badge(s.statusLabel, s.available ? 'success' : 'neutral')}</td>
          <td data-label="نوع السماح" class="sub">${esc(ACCESS_MODE_AR[u.access?.access_mode] || '—')}</td>
          <td data-label="الاستهلاك">${quotaCell(u.quota, usageCellText(u))}</td>
          <td data-label="حد المعدل">${rateLimitCell(u.rateLimit)}</td>
          <td data-label="آخر نشاط" class="sub" title="${esc(fmtDate(u.rateLimit?.last_request_at, { withTime: true }))}">${esc(fmtRelative(u.rateLimit?.last_request_at))}</td>
          <td class="cell-actions">
            <button class="btn btn--ghost btn--sm" data-edit="${esc(u.id)}">${icon('edit')} تعديل</button>
          </td>
        </tr>`;
    }).join('');

    $('userRows').querySelectorAll('[data-edit]').forEach((b) =>
        b.addEventListener('click', () => openAccessDialog(b.dataset.edit)));

    renderPager($('userPager'), {
        page: state.userPage,
        pageCount,
        onSelect: (target) => { state.userPage = target; renderUsers(); $('pageScroll').scrollTo({ top: 0, behavior: 'smooth' }); }
    });
}

// ═════════════════════════════════════════════════════════════
// الاستهلاك والحدود — نفس البيانات، بس مقروءة من ناحية الرصيد
// ═════════════════════════════════════════════════════════════
function renderUsage() {
    const q = $('usageSearch').value.trim().toLowerCase();
    const filter = $('usageFilter').value;

    const rows = state.users.filter((u) => {
        if (filter === 'quota' && u.access?.access_mode !== 'quota') return false;
        if (filter === 'attention' && !['warning', 'almost', 'exhausted'].includes(u.quota?.status)) return false;
        if (filter === 'overridden' && !u.rateLimit?.is_overridden) return false;
        if (!q) return true;
        return `${u.name} ${u.email}`.toLowerCase().includes(q);
    });

    const pageCount = Math.max(1, Math.ceil(rows.length / USERS_PER_PAGE));
    state.usagePage = Math.min(Math.max(1, state.usagePage), pageCount);
    const start = (state.usagePage - 1) * USERS_PER_PAGE;
    const page = rows.slice(start, start + USERS_PER_PAGE);

    $('usageCount').textContent = rows.length === 0 ? ''
        : rows.length <= USERS_PER_PAGE ? `${rows.length} عميل`
        : `${start + 1}–${start + page.length} من ${rows.length} عميل`;

    $('usageEmpty').hidden = rows.length > 0;
    $('usageEmpty').innerHTML = rows.length > 0 ? '' : emptyState({
        iconName: 'usage', title: 'مفيش عميل هنا',
        text: 'غيّر الفلتر عشان تشوف باقي الحسابات.'
    });

    $('usageRows').innerHTML = page.map((u) => {
        const quota = u.quota || {};
        const hasQuota = u.access?.access_mode === 'quota' && quota.total;
        return `
        <tr>
          <td>${userIdentityCell(u)}</td>
          <td data-label="الرصيد">
            <div class="usage-cell">
              ${usageCellText(u)}
              ${hasQuota ? meter(quota.percentage, quotaTone(quota.status)) : ''}
            </div>
          </td>
          <td data-label="المتبقي" class="num">${hasQuota ? fmtNumber(quota.remaining) : '—'}</td>
          <td data-label="التوكن" class="num">${quota.tokensUsed === null || quota.tokensUsed === undefined ? '—' : fmtNumber(quota.tokensUsed)}</td>
          <td data-label="الطلبات" class="num">${u.rateLimit ? fmtNumber(u.rateLimit.total_requests) : '—'}${
              Number(u.rateLimit?.total_rejected) > 0
                  ? `<span class="sub"><b class="num">${fmtNumber(u.rateLimit.total_rejected)}</b> مرفوض</span>` : ''}</td>
          <td data-label="حد المعدل">${rateLimitCell(u.rateLimit)}</td>
          <td class="cell-actions">
            <button class="btn btn--ghost btn--sm" data-edit-usage="${esc(u.id)}">${icon('edit')} تعديل</button>
          </td>
        </tr>`;
    }).join('');

    $('usageRows').querySelectorAll('[data-edit-usage]').forEach((b) =>
        b.addEventListener('click', () => openAccessDialog(b.dataset.editUsage)));

    renderPager($('usagePager'), {
        page: state.usagePage,
        pageCount,
        onSelect: (target) => { state.usagePage = target; renderUsage(); $('pageScroll').scrollTo({ top: 0, behavior: 'smooth' }); }
    });
}

// ═════════════════════════════════════════════════════════════
// درج العميل — الوصول والاستهلاك وحد المعدل في مكان واحد
// ═════════════════════════════════════════════════════════════
function wireAccessEditor() {
    const dlg = $('accessDialog');
    $('aMode').addEventListener('change', syncAccessMode);

    const isDirty = () => state.dirtySnapshot !== null && snapshotOf(dlg) !== state.dirtySnapshot;
    for (const id of ['cancelAccessBtn', 'closeAccessBtn']) {
        $(id).addEventListener('click', () => tryClose(dlg, isDirty));
    }
    guardUnsaved(dlg, isDirty);
    closeOnBackdrop(dlg, { guardDirty: isDirty });

    $('resetRateLimitBtn').addEventListener('click', submitResetRateLimit);
    $('saveAccessBtn').addEventListener('click', submitAccess);
    $('resetUsageBtn').addEventListener('click', submitResetUsage);
}

function syncAccessMode() {
    const mode = $('aMode').value;
    $('aQuotaWrap').hidden = mode !== 'quota';
    $('aExpiryWrap').hidden = mode !== 'expiration';
}

async function openAccessDialog(userId) {
    const user = state.users.find((u) => u.id === userId);
    state.editingUserId = userId;
    state.dirtySnapshot = null;

    $('accessUserName').textContent = user?.name || '';
    $('accessUserEmail').textContent = user?.email || '';
    $('accessAvatar').textContent = user ? initialsOf(user) : '؟';
    $('accessErrors').hidden = true;

    // Re-read rather than trusting the list: the row may have changed since
    // the page loaded, and overwriting a newer value with a stale one is
    // exactly how quotas silently reset.
    const row = await getSieAccessStatus(supabase, userId);
    $('aEnabled').checked = Boolean(row?.is_enabled);
    $('aMode').value = row?.access_mode || 'unlimited';
    $('aQuota').value = row?.message_quota ?? '';
    $('aExpiry').value = row?.expires_at ? new Date(row.expires_at).toISOString().slice(0, 16) : '';
    $('aNotes').value = row?.notes || '';
    syncAccessMode();

    const evaluated = evaluateSieAccessRow(row);
    $('accessStatusBadge').innerHTML = badge(evaluated.statusLabel, evaluated.available ? 'success' : 'neutral');
    renderAccessUsage(row);

    fillRateLimitFields(state.users.find((u) => u.id === userId)?.rateLimit || null);

    $('saveAccessBtn').disabled = !state.isSieAdmin;
    $('resetUsageBtn').disabled = !state.isSieAdmin || !row;
    $('resetRateLimitBtn').disabled = !state.isSieAdmin;

    openDialog($('accessDialog'));
    state.dirtySnapshot = snapshotOf($('accessDialog'));
}

const initialsOf = (user) => (user.name && user.name !== '—' ? user.name : user.email).slice(0, 2).toUpperCase();

/** الاستهلاك الحالي للعميل — من نفس حساب quotaMetrics المستخدم في الجداول. */
function renderAccessUsage(row) {
    const quota = quotaMetrics(row, state.users.find((u) => u.id === state.editingUserId)?.quota?.tokensUsed ?? null);
    const hasQuota = row?.access_mode === 'quota' && quota.total;

    $('accessUsage').innerHTML = `
      <div class="usage-summary">
        <div class="usage-figure">
          <span class="sub">مستهلك</span>
          <b class="num">${fmtNumber(quota.used)}</b>
        </div>
        <div class="usage-figure">
          <span class="sub">الرصيد</span>
          <b class="num">${hasQuota ? fmtNumber(quota.total) : 'غير محدود'}</b>
        </div>
        <div class="usage-figure">
          <span class="sub">المتبقي</span>
          <b class="num">${hasQuota ? fmtNumber(quota.remaining) : '—'}</b>
        </div>
        <div class="usage-figure">
          <span class="sub">التوكن</span>
          <b class="num">${quota.tokensUsed === null || quota.tokensUsed === undefined ? '—' : fmtNumber(quota.tokensUsed)}</b>
        </div>
      </div>
      ${hasQuota ? `${meter(quota.percentage, quotaTone(quota.status))}
        <p class="sub usage-note">${badge(quotaStatus[quota.status]?.label || '', quotaTone(quota.status))}
        <span class="num">${quota.percentage}٪</span> من الرصيد اتستهلك.</p>` : ''}
      ${row?.access_mode === 'expiration' && row.expires_at
        ? `<p class="sub usage-note">${icon('calendar')} الصلاحية بتنتهي ${esc(fmtDate(row.expires_at, { withTime: true }))}</p>` : ''}
      ${!row ? '<p class="sub usage-note">العميل ده لسه مالوش صف صلاحية — أول حفظ هينشئه.</p>' : ''}`;
}

/**
 * The rate-limit half of the drawer.
 *
 * The three inputs show the OVERRIDE, not the effective value: an empty
 * box means "inherit", and pre-filling it with the inherited number would
 * turn every save into an accidental override.
 */
function fillRateLimitFields(status) {
    const pressure = describeRateLimitPressure(status);
    const limit = status ? Number(status.effective_limit) : null;
    const burst = status ? Number(status.effective_burst) : null;

    $('rlEffective').textContent = !status ? '—'
        : status.effective_enabled === false ? 'مقفول'
        : `${limit}/دقيقة (+${burst})`;
    $('rlRemaining').textContent = !status || status.effective_enabled === false ? '—'
        : `${Number(status.tokens_remaining)} / ${limit + burst}`;
    $('rlWindow').textContent = status
        ? `${Number(status.window_requests)} طلب${Number(status.window_rejected) > 0 ? ` — ${Number(status.window_rejected)} اترفض` : ''}`
        : '—';

    const meterEl = $('rlMeter');
    const tone = { warning: 'is-warning', critical: 'is-danger', exhausted: 'is-danger', off: 'is-neutral' }[pressure.level] || 'is-success';
    meterEl.className = `meter-fill ${tone}`;
    meterEl.style.width = `${Math.round(pressure.ratio * 100)}%`;

    const pressureEl = $('rlPressure');
    pressureEl.className = `rl-pressure ${pressure.level}`;
    pressureEl.textContent = status
        ? `${pressure.label}${status.is_overridden ? ' — استثناء للعميل ده' : ' — بيورث الإعداد العام'}`
        : 'مفيش بيانات استخدام للعميل ده لسه';

    $('rlEnabled').value = !status || status.override_enabled === null || status.override_enabled === undefined
        ? 'inherit' : (status.override_enabled ? 'on' : 'off');
    $('rlRpm').value = status?.override_limit ?? '';
    $('rlBurst').value = status?.override_burst ?? '';
    $('rlNotes').value = status?.notes ?? '';
}

async function submitAccess() {
    const mode = $('aMode').value;

    if (mode === 'quota' && !(Number($('aQuota').value) > 0)) {
        showFormError('accessErrors', 'اكتب عدد رسائل أكبر من صفر.');
        $('aQuota').focus();
        return;
    }
    if (mode === 'expiration' && !$('aExpiry').value) {
        showFormError('accessErrors', 'اختار تاريخ انتهاء.');
        $('aExpiry').focus();
        return;
    }

    const { error } = await withBusy($('saveAccessBtn'), () => adminSetAccess(supabase, {
        userId: state.editingUserId,
        isEnabled: $('aEnabled').checked,
        accessMode: mode,
        messageQuota: mode === 'quota' ? Number($('aQuota').value) : null,
        expiresAt: mode === 'expiration' ? new Date($('aExpiry').value).toISOString() : null,
        notes: $('aNotes').value.trim() || null
    }));

    if (error) {
        showFormError('accessErrors', `تعذّر الحفظ: ${esc(error.message)}`);
        return;
    }

    // The rate limit is saved from the same button but through its own RPC:
    // different table, different authorization. Writing it AFTER the access
    // row means a rejected rate limit cannot roll back a quota change the
    // admin already made — they get told, and the quota stands.
    const rlError = await saveRateLimitFields();
    if (rlError) {
        showFormError('accessErrors', `الصلاحية اتحفظت، لكن حد المعدل فشل: ${esc(rlError.message)}`);
        state.dirtySnapshot = null;
        await loadUsers();
        return;
    }

    state.dirtySnapshot = null;
    closeDialog($('accessDialog'));
    toast('اتحفظت الصلاحية وحد المعدل.');
    await loadUsers();
    renderDashboard();
}

/** @returns {Promise<Error|null>} */
async function saveRateLimitFields() {
    const choice = $('rlEnabled').value;
    const rpmRaw = $('rlRpm').value.trim();
    const burstRaw = $('rlBurst').value.trim();

    // Empty means inherit, which is null in the database — NOT zero.
    const requestsPerMinute = rpmRaw === '' ? null : Number(rpmRaw);
    const burst = burstRaw === '' ? null : Number(burstRaw);

    if (requestsPerMinute !== null && !(requestsPerMinute >= 1)) {
        return new Error('عدد الطلبات في الدقيقة لازم يكون أكبر من صفر، أو سيبه فاضي.');
    }
    if (burst !== null && !(burst >= 0)) {
        return new Error('الدفعة المفاجئة لازم تكون صفر أو أكتر، أو سيبها فاضية.');
    }

    const { error } = await adminSetRateLimit(supabase, {
        userId: state.editingUserId,
        isEnabled: choice === 'inherit' ? null : choice === 'on',
        requestsPerMinute,
        burst,
        notes: $('rlNotes').value.trim() || null
    });
    return error;
}

// Separate from saving a limit on purpose: "this customer deserves a higher
// ceiling" and "this customer is stuck behind a 429 right now" are different
// decisions, and merging them means every unblock rewrites the policy.
async function submitResetRateLimit() {
    const ok = await confirmAction({
        title: 'فك الحظر المؤقت للعميل ده؟',
        body: 'ده بيصفّر عدّاد المعدل عشان يقدر يبعت حالًا، من غير ما يغيّر الحد نفسه.',
        confirmLabel: 'فُك الحظر'
    });
    if (!ok) return;

    const { error } = await withBusy($('resetRateLimitBtn'), () =>
        adminResetRateLimit(supabase, state.editingUserId));
    if (error) {
        showFormError('accessErrors', `تعذّر فك الحظر: ${esc(error.message)}`);
        return;
    }
    state.dirtySnapshot = null;
    closeDialog($('accessDialog'));
    toast('اتفك الحظر — العميل يقدر يبعت دلوقتي.');
    await loadUsers();
}

async function submitResetUsage() {
    const ok = await confirmAction({
        title: 'تصفير عدّاد الاستخدام؟',
        body: 'الرسائل المستهلكة هترجع صفر. الرصيد نفسه مش هيتغير.',
        confirmLabel: 'صفّر العدّاد',
        tone: 'danger'
    });
    if (!ok) return;

    const { error } = await withBusy($('resetUsageBtn'), () =>
        adminResetUsage(supabase, state.editingUserId));
    if (error) {
        showFormError('accessErrors', `تعذّر التصفير: ${esc(error.message)}`);
        return;
    }
    state.dirtySnapshot = null;
    closeDialog($('accessDialog'));
    toast('اتصفّر الاستخدام.');
    await loadUsers();
    renderDashboard();
}
