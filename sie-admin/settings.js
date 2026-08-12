/**
 * settings.js — SIE settings console
 * ------------------------------------------------------------
 * Three things an operator needs in one place: what the engine knows
 * (scenarios), how it decides (engine settings), and who is allowed to
 * use it (users).
 *
 * ── ARCHITECTURE ────────────────────────────────────────────
 * Every call into SIE goes through `/sie-integration/sie-runtime.js` and
 * nothing else. This page never imports an engine module directly, so
 * the nine modules stay free to change shape behind the runtime. The
 * only non-SIE import is the standalone Supabase client (./supabase-client.js),
 * which points at the same Supabase project — these pages are served from
 * their own origin, so the platform's /api-config.js is not reachable.
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
    users: [],
    isStaff: false,
    isSieAdmin: false,
    editingUserId: null,
    scenarioPage: 1,
    /** آخر ملف اتقرا، جاهز للحفظ. */
    importParsed: null
};

/**
 * A catalog runs to hundreds of scenarios, and a table that renders all of
 * them at once is a page an operator scrolls past rather than reads. 25 is
 * about a screen and a half — enough to scan, short enough to reach the
 * end of.
 */
const SCENARIOS_PER_PAGE = 25;

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

const $ = (id) => document.getElementById(id);
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function toast(message, kind = 'ok') {
    const el = $('toast');
    el.textContent = message;
    el.className = `toast toast--${kind}`;
    el.hidden = false;
    clearTimeout(toast._t);
    toast._t = setTimeout(() => { el.hidden = true; }, 4000);
}

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
    $('whoAmI').textContent = session.user.email;

    wireChrome();
    wireScenarioEditor();
    wireImportDialog();
    wireAccessEditor();

    await Promise.all([loadSettings(), loadScenarios(), loadUsers()]);
})();

function wireChrome() {
    $('signOutBtn').addEventListener('click', async () => {
        await supabase.auth.signOut();
        window.location.replace(LOGIN_PAGE);
    });

    const tabs = $('mainTabs');
    tabs.addEventListener('click', (e) => {
        const btn = e.target.closest('.tab-btn');
        if (!btn) return;
        tabs.querySelectorAll('.tab-btn').forEach((b) => b.classList.toggle('active', b === btn));
        document.querySelectorAll('.tab-panel').forEach((p) =>
            p.classList.toggle('active', p.id === btn.dataset.target));
    });
}

// ═════════════════════════════════════════════════════════════
// Scenarios
// ═════════════════════════════════════════════════════════════
async function loadScenarios() {
    await loadTokenLabels();
    state.scenarios = await listActiveScenarios();
    state.drafts = state.isStaff ? await listStoredScenarioVersions(supabase) : [];

    const categories = [...new Set(state.scenarios.map((s) => s.category))].sort();
    $('scenarioCategory').insertAdjacentHTML('beforeend',
        categories.map((c) => `<option value="${esc(c)}">${esc(catAr(c))}</option>`).join(''));

    const auto = state.scenarios.filter((s) => s.resolution.hasAutoResolution).length;
    const withQ = state.scenarios.filter((s) => s.discriminatingQuestions?.length).length;
    $('scenarioStats').innerHTML = [
        ['سيناريو بيفهمه', state.scenarios.length],
        ['بيرد عليه بحل', auto],
        ['بيجمع معلومات ويسلّم', state.scenarios.length - auto],
        ['بيسأل فيه سؤال توضيحي', withQ]
    ].map(([k, v]) => `<div class="stat"><b>${v}</b><span>${k}</span></div>`).join('');

    $('draftCount').textContent = state.drafts.length;
    renderDrafts();
    renderScenarios();
    wireScenarioToolbar();

    $('newScenarioBtn').addEventListener('click', () => openScenarioDialog(null));
    if (!state.isStaff) {
        for (const id of ['newScenarioBtn', 'importScenarioBtn']) {
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
    for (const id of ['scenarioSearch', 'scenarioCategory', 'scenarioResolution', 'scenarioSort']) {
        $(id).addEventListener('input', () => { state.scenarioPage = 1; renderScenarios(); });
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

    $('scenarioEmpty').hidden = total > 0;
    $('scenarioRows').innerHTML = page.map((s) => `
        <tr>
          <td><b>${esc(s.label.ar)}</b><div class="row-sub ltr">${esc(s.id)}</div></td>
          <td><span class="pill">${esc(catAr(s.category))}</span></td>
          <td class="sub">${s.evidenceSignature.map((e) => esc(tokenAr(e.token))).join(' + ')}</td>
          <td>${s.resolution.hasAutoResolution
              ? '<span class="pill pill--ok">بيرد بحل</span>'
              : '<span class="pill pill--warn">بيسلّم لفريق</span>'}</td>
          <td><button class="btn-ghost btn-sm" data-view="${esc(s.id)}">افتح</button></td>
        </tr>`).join('');

    $('scenarioRows').querySelectorAll('[data-view]').forEach((b) =>
        b.addEventListener('click', () => openScenarioDialog(
            state.scenarios.find((s) => s.id === b.dataset.view))));

    renderPager(pageCount);
}

/**
 * Page numbers around the current one, with the first and last always
 * reachable. A catalog of 400 scenarios is 16 pages, and printing all 16
 * turns the control into a wall of digits.
 */
function pageWindow(current, pageCount) {
    if (pageCount <= 7) return Array.from({ length: pageCount }, (_, i) => i + 1);

    const pages = new Set([1, pageCount, current, current - 1, current + 1]);
    const sorted = [...pages].filter((p) => p >= 1 && p <= pageCount).sort((a, b) => a - b);

    const withGaps = [];
    sorted.forEach((p, i) => {
        if (i > 0 && p - sorted[i - 1] > 1) withGaps.push('…');
        withGaps.push(p);
    });
    return withGaps;
}

function renderPager(pageCount) {
    const pager = $('scenarioPager');
    if (pageCount <= 1) { pager.hidden = true; pager.innerHTML = ''; return; }
    pager.hidden = false;

    const current = state.scenarioPage;
    const step = (label, target, disabled) =>
        `<button type="button" class="pager-btn" data-page="${target}" ${disabled ? 'disabled' : ''}>${label}</button>`;

    pager.innerHTML = [
        step('السابق', current - 1, current === 1),
        ...pageWindow(current, pageCount).map((p) => p === '…'
            ? '<span class="pager-gap">…</span>'
            : `<button type="button" class="pager-btn ${p === current ? 'is-current' : ''}" data-page="${p}"${p === current ? ' aria-current="page"' : ''}>${p}</button>`),
        step('التالي', current + 1, current === pageCount)
    ].join('');

    pager.querySelectorAll('[data-page]').forEach((b) =>
        b.addEventListener('click', () => {
            state.scenarioPage = Number(b.dataset.page);
            renderScenarios();
            // Paging without this leaves the reader at the bottom of the
            // page they just left, looking at row 25 of the new one.
            document.getElementById('tab-scenarios').scrollIntoView({ behavior: 'smooth', block: 'start' });
        }));
}

function renderDrafts() {
    $('draftRows').innerHTML = state.drafts.length
        ? state.drafts.map((d) => `
            <tr>
              <td><b>${esc(d.scenario_key)}</b></td>
              <td class="ltr">${d.version}</td>
              <td><span class="pill ${d.status === 'published' ? 'pill--ok' : ''}">${esc(DRAFT_STATUS_AR[d.status] || d.status)}</span></td>
              <td class="sub">${esc(d.notes || '—')}</td>
              <td>${d.status === 'published'
                  ? '<span class="sub">شغّالة</span>'
                  : `<button class="btn-ghost btn-sm" data-publish="${esc(d.scenario_key)}" data-version="${d.version}">فعّلها</button>`}</td>
            </tr>`).join('')
        : '<tr><td colspan="5" class="sub">لسه مضفتش أي سيناريو.</td></tr>';

    $('draftRows').querySelectorAll('[data-publish]').forEach((b) =>
        b.addEventListener('click', async () => {
            if (!confirm('تفعيل السيناريو ده معناها إن المحرك يبدأ يستخدمه مع العملاء. تمام؟')) return;
            b.disabled = true;
            const { success, error } = await publishScenarioVersion(supabase, {
                key: b.dataset.publish,
                version: Number(b.dataset.version)
            });
            b.disabled = false;
            if (!success) { toast(`مااتفعلتش: ${error}`, 'err'); return; }
            toast(state.settings.use_published_scenarios
                ? 'اتفعّلت، والمحرك هيستخدمها في المحادثات الجديدة.'
                : 'اتفعّلت. عشان تشتغل فعلًا، افتح خيار «استخدم الحالات اللي ضفتها» من صفحة التشغيل.');
            state.drafts = await listStoredScenarioVersions(supabase);
            renderDrafts();
        }));
}

// ── Scenario editor ──────────────────────────────────────────
function evidenceRow(token = '', weight = 3) {
    const el = document.createElement('div');
    el.className = 'evidence-row';
    el.innerHTML = `
        <input type="text" class="ev-token ltr" placeholder="entity_whatsapp" value="${esc(token)}">
        <input type="number" class="ev-weight" min="1" max="10" value="${weight}">
        <button type="button" class="btn-ghost btn-sm ev-del">حذف</button>`;
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
        ? '<b class="ok">يحسم</b>'
        : '<b class="warn">يسأل سؤال توضيحي</b>';

    box.innerHTML = `
      <div>الدليل الأول لوحده — لو اتطابق من مصطلح إنجليزي: ${(share(1)).toFixed(2)} ${verdict(share(1))}</div>
      <div>نفسه لو اتطابق من كلمة عربية (×0.80): ${(share(1) * 0.8).toFixed(2)} ${verdict(share(1) * 0.8)}</div>
      <div>أول دليلين مع بعض: ${(share(2)).toFixed(2)} ${verdict(share(2))}</div>`;
}

function wireScenarioEditor() {
    const dlg = $('scenarioDialog');
    $('addEvidenceBtn').addEventListener('click', () => {
        $('evidenceList').appendChild(evidenceRow());
        previewConfidence();
    });
    $('fHasAuto').addEventListener('change', (e) => {
        $('autoTextWrap').hidden = !e.target.checked;
    });
    $('cancelScenarioBtn').addEventListener('click', () => dlg.close());
    $('saveScenarioBtn').addEventListener('click', submitScenario);
}

function openScenarioDialog(scenario) {
    const editing = Boolean(scenario);
    $('scenarioDialogTitle').textContent = editing ? `عرض: ${scenario.label.ar}` : 'سيناريو جديد';
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

    $('scenarioDialog').showModal();
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

async function submitScenario() {
    const scenario = collectScenario();
    const errBox = $('scenarioErrors');

    // Validated against the engine's own schema, so the editor sees exactly
    // the errors the catalog provider would raise rather than saving
    // something the engine will silently skip.
    const { valid, errors } = await validateScenarioDraft(scenario);
    if (!valid) {
        errBox.innerHTML = '<b>السيناريو مش صالح:</b><br>' + errors.map(esc).join('<br>');
        errBox.hidden = false;
        return;
    }

    const weights = scenario.evidenceSignature.map((e) => e.weight).sort((a, b) => b - a);
    const topTwo = weights.slice(0, 2).reduce((a, b) => a + b, 0) / weights.reduce((a, b) => a + b, 0);
    if (topTwo < 0.6) {
        errBox.innerHTML =
            '<b>التوقيع ده مش هيحسم أبدًا.</b><br>' +
            `أقوى دليلين مع بعض بيوصلوا ${topTwo.toFixed(2)} بس، والحد المطلوب 0.60. ` +
            'قلّل عدد الأدلة أو زوّد وزن الدليل المميِّز.';
        errBox.hidden = false;
        return;
    }

    $('saveScenarioBtn').disabled = true;
    const result = await saveScenarioDraft(supabase, {
        key: scenario.id,
        definition: scenario,
        authorNote: $('fNote').value.trim() || null
    });
    $('saveScenarioBtn').disabled = false;

    if (!result.success) {
        errBox.textContent = `تعذّر الحفظ: ${result.error}`;
        errBox.hidden = false;
        return;
    }

    $('scenarioDialog').close();
    toast(`اتحفظت كمسودة (إصدار ${result.draftVersion}). المحرك لسه بيستخدم النسخة المنشورة.`);
    state.drafts = await listStoredScenarioVersions(supabase);
    $('draftCount').textContent = state.drafts.length;
    renderDrafts();
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
        dlg.showModal();
    });
    $('cancelImportBtn').addEventListener('click', () => dlg.close());
    $('confirmImportBtn').addEventListener('click', saveImportedEntries);
    $('downloadTemplateBtn').addEventListener('click', downloadTemplate);

    $('showTokensBtn').addEventListener('click', () => {
        const box = $('tokenCatalog');
        box.hidden = !box.hidden;
        if (!box.hidden) renderTokenCatalog('');
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
    box.className = `notice notice--${kind}`;
    box.textContent = message;
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
            `<div class="token-item"><code class="ltr">${esc(token)}</code><span>${esc(label)}</span></div>`).join('')
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
        ? (entry.warnings.length
            ? '<span class="pill pill--warn">فيه ملاحظة</span>'
            : '<span class="pill pill--ok">جاهز</span>')
        : '<span class="pill pill--err">فيه غلط</span>';

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

    if (failures.length) {
        importStatus(`اتحفظ ${saved}، وفشل ${failures.length}: ${failures.join(' — ')}`, 'err');
        btn.disabled = false;
        return;
    }

    $('importDialog').close();
    // The drafts panel below the table lists scenarios only, so pointing
    // at it after a knowledge-only import would send someone looking for
    // something that is not there.
    const anyScenario = pending.some((e) => e.kind === 'scenario');
    toast(anyScenario
        ? `اتحفظ ${saved} كمسودات. افتح «السيناريوهات اللي إنت ضفتها» عشان تفعّلهم.`
        : `اتحفظ ${saved} مدخل معرفة كمسودات، مستنيين التفعيل.`);
}

// ═════════════════════════════════════════════════════════════
// Operation — real switches, saved to Supabase, obeyed by the engine
// ═════════════════════════════════════════════════════════════
async function loadSettings() {
    // `fresh` so an admin never sees a cached value on a page whose whole
    // purpose is showing the current one.
    state.settings = await getSieSettings(supabase, { fresh: true });
    renderSettingGroups();
    renderLiveBanner();

    $('tryBtn').addEventListener('click', runDiagnosisPreview);
    $('tryInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') runDiagnosisPreview(); });
}

/** الأرقام اللي «أسلوب المحرك» بيتحكم فيها — أي تعديل بإيد فيها يرجّعه لـ«مخصص». */
const PROFILE_KEYS = new Set(Object.keys(behaviorProfileValues('balanced') || {}));

/**
 * كل المجموعات والعناصر، مرسومة من الوصف الواحد.
 *
 * Groups are rendered as collapsible sections rather than more tabs: an
 * operator changing "how sure before answering" usually wants to see the
 * question cap next to it, and tabs would hide one behind the other.
 * Only the first group is open on load, so the page opens on the switches
 * that get touched most.
 */
function renderSettingGroups() {
    const container = $('settingGroups');
    container.innerHTML = groupedSettings().map((group, i) => `
        <details class="setting-group" ${i === 0 ? 'open' : ''}>
          <summary>
            <span class="group-title">${esc(group.title)}</span>
            <span class="group-desc">${esc(group.desc)}</span>
            <span class="group-count" data-group="${esc(group.id)}"></span>
          </summary>
          <div class="setting-list">
            ${group.settings.map(renderSetting).join('')}
          </div>
        </details>`).join('');

    wireSettingInputs();
    renderGroupCounts();
}

/** One control, chosen by the setting's own declared type. */
function renderSetting(def) {
    const value = state.settings[def.key];
    const active = isSettingActive(def, state.settings);
    const disabled = !state.isStaff || !active;
    const cls = `setting-row${active ? '' : ' is-inert'}`;

    if (def.type === 'boolean') {
        const on = value !== false;
        return `
        <div class="${cls}${on ? '' : ' is-off'}" data-key="${esc(def.key)}" data-type="boolean">
          <label class="switch">
            <input type="checkbox" ${on ? 'checked' : ''} ${disabled ? 'disabled' : ''}>
            <span class="slider"></span>
          </label>
          <div class="setting-text">
            <b>${esc(def.title)}</b>
            <span class="sub">${esc(def.desc)}</span>
            ${!on && def.warn ? `<span class="setting-warn">${esc(def.warn)}</span>` : ''}
            ${!active ? `<span class="setting-inert">متعطّل لأن «${esc(SETTINGS_BY_KEY[def.dependsOn].title)}» مقفول.</span>` : ''}
          </div>
        </div>`;
    }

    if (def.type === 'number') {
        return `
        <div class="${cls}" data-key="${esc(def.key)}" data-type="number">
          <div class="setting-text">
            <b>${esc(def.title)}</b>
            <span class="sub">${esc(def.desc)}</span>
            ${!active ? `<span class="setting-inert">متعطّل لأن «${esc(SETTINGS_BY_KEY[def.dependsOn].title)}» مقفول.</span>` : ''}
          </div>
          <div class="setting-number">
            <input type="number" class="num-box" min="${def.min}" max="${def.max}" step="${def.step || 1}"
                   value="${value}" dir="ltr" ${disabled ? 'disabled' : ''}
                   aria-label="${esc(def.title)}">
            <input type="range" min="${def.min}" max="${def.max}" step="${def.step || 1}"
                   value="${value}" ${disabled ? 'disabled' : ''} tabindex="-1" aria-hidden="true">
            <output>${formatNumber(def, value)}</output>
          </div>
        </div>`;
    }

    // enum
    return `
    <div class="${cls}" data-key="${esc(def.key)}" data-type="enum">
      <div class="setting-text">
        <b>${esc(def.title)}</b>
        <span class="sub">${esc(def.desc)}</span>
      </div>
      <div class="setting-choices">
        ${def.options.map((o) => `
          <label class="choice ${o.value === value ? 'is-picked' : ''}">
            <input type="radio" name="${esc(def.key)}" value="${esc(o.value)}"
                   ${o.value === value ? 'checked' : ''} ${disabled ? 'disabled' : ''}>
            <span class="choice-label">${esc(o.label)}</span>
            ${o.desc ? `<span class="choice-desc">${esc(o.desc)}</span>` : ''}
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
                out.textContent = formatNumber(def, v);
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
                out.textContent = formatNumber(def, Number(range.value));
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
                    out.textContent = formatNumber(def, n);
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

    renderSettingGroups();
    renderLiveBanner();
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

/** عدد الإعدادات المتغيّرة عن المعتاد جوه كل مجموعة. */
function renderGroupCounts() {
    for (const group of groupedSettings()) {
        const el = $('settingGroups').querySelector(`.group-count[data-group="${group.id}"]`);
        if (!el) continue;
        const changed = group.settings.filter((s) => state.settings[s.key] !== SIE_DEFAULT_SETTINGS[s.key]).length;
        el.textContent = changed ? `${changed} متغيّر` : '';
        el.className = `group-count${changed ? ' is-changed' : ''}`;
    }
}

function renderLiveBanner() {
    const banner = $('liveBanner');
    if (state.settings.engine_enabled === false) {
        banner.className = 'live-banner live-banner--off';
        banner.textContent = 'المحرك الذكي متوقف دلوقتي. العملاء بيرد عليهم البوت العادي.';
        return;
    }

    banner.className = 'live-banner live-banner--on';
    // Counts what differs from the shipped defaults, not what is merely
    // off: several settings ship off, so counting "off" would report
    // changes on a console nobody has ever touched.
    const changed = Object.keys(SIE_DEFAULT_SETTINGS).filter(
        (key) => key !== 'engine_enabled' && state.settings[key] !== SIE_DEFAULT_SETTINGS[key]
    ).length;
    banner.textContent = changed === 0
        ? 'المحرك الذكي شغّال بكل الإعدادات المعتادة.'
        : `المحرك الذكي شغّال، مع ${changed} إعداد متغيّر عن المعتاد.`;
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
    box.innerHTML = 'ثانية واحدة…';
    try {
        const { normalize } = await import('/sie/language/normalizer.js');
        const { processTurn } = await import('/sie/diagnostics/diagnostic-engine.js');
        const { rankDiagnosticState } = await import('/sie/ranking/ranking-engine.js');

        const { normalizedTokens } = await normalize(text);
        const diagnosticState = await processTurn({ normalizedTokens, turn: 1 });
        const ranking = await rankDiagnosticState(diagnosticState);
        const top = ranking.ranked.slice(0, 4).filter((r) => r.hypothesis.confidence > 0);

        if (top.length === 0) {
            box.innerHTML = '<span class="sub">المحرك مافهمش الرسالة دي، وهيسأل العميل يوضّح أكتر. '
                + 'لو دي حالة متكررة عندك، ضيفها من صفحة «السيناريوهات».</span>';
            return;
        }

        const best = top[0];
        const willAnswer = best.hypothesis.confidence >= 0.6;
        box.innerHTML = `
          <div class="verdict ${willAnswer ? 'verdict--ok' : 'verdict--ask'}">
            ${willAnswer
              ? `هيتعامل معاها كـ «${esc(best.scenario?.label.ar || best.hypothesis.scenarioId)}»`
              : 'مش متأكد كفاية، فهيسأل العميل سؤال توضيحي الأول'}
          </div>
          <table class="data-table">
            <thead><tr><th>أقرب السيناريوهات</th><th>درجة التأكد</th></tr></thead>
            <tbody>${top.map((r) => `
              <tr>
                <td>${esc(r.scenario?.label.ar || r.hypothesis.scenarioId)}</td>
                <td class="ltr">${Math.round(r.hypothesis.confidence * 100)}%</td>
              </tr>`).join('')}</tbody>
          </table>`;
    } catch (err) {
        box.innerHTML = `<span class="sub">مقدرتش أجرّب دلوقتي: ${esc(err.message)}</span>`;
    }
}

// ═════════════════════════════════════════════════════════════
// Users
// ═════════════════════════════════════════════════════════════
async function loadUsers() {
    const notice = $('usersNotice');
    if (!state.isSieAdmin) {
        notice.hidden = false;
        notice.textContent =
            'السماح للعملاء متاح لمسؤول المحرك بس. تقدر تشوف القائمة، لكن الحفظ هيترفض من قاعدة البيانات.';
    }

    const [{ data: profiles, error: pErr }, { data: access }, rateLimits] = await Promise.all([
        supabase.from('profiles').select('id, full_name, email, role').order('created_at', { ascending: false }),
        supabase.from('customer_sie_access').select('*'),
        // One RPC for the whole table rather than one per row, and it
        // already degrades to [] for a caller without the permission.
        getRateLimitStatus(supabase)
    ]);

    if (pErr) {
        $('userEmpty').hidden = false;
        $('userEmpty').textContent = `تعذّر تحميل المستخدمين: ${pErr.message}`;
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
    $('userStats').innerHTML = [
        ['كل المستخدمين', state.users.length],
        ['مسموح لهم', enabled],
        ['مش مسموح', state.users.length - enabled],
        ['عندهم حد استخدام', state.users.filter((u) => u.access && u.access.access_mode !== 'unlimited').length],
        ['قرّبوا من الحد', nearLimit],
        ['مستنفدين', exhausted]
    ].map(([k, v]) => `<div class="stat"><b>${v}</b><span>${k}</span></div>`).join('');

    ['userSearch', 'userFilter'].forEach((id) => $(id).addEventListener('input', renderUsers));
    renderUsers();
}

/**
 * The rate-limit cell: the effective ceiling, and whether it came from the
 * global setting or an exception on this customer. Which of the two is in
 * force matters more than the number — an admin changing the global
 * default needs to see at a glance who will not follow it.
 */
/**
 * الاستهلاك مع حالته. الرقم لوحده («٨٠ / ١٠٠») مابيقولش إن ده قرّب من
 * الحد، والنسبة هي اللي بتخلي الأدمن ياخد باله قبل ما تخلص.
 * التصنيف نفسه بيجي من quotaMetrics عشان يبقى واحد في كل الشاشات.
 */
function quotaCell(quota, fallbackText) {
    if (!quota || quota.status === 'unavailable') return `<span class="sub">${esc(fallbackText)}</span>`;
    const tone = quotaStatus[quota.status]?.tone || 'neutral';
    const label = quotaStatus[quota.status]?.label || '';
    const pct = quota.total ? ` — ${quota.percentage}٪` : '';
    const tokens = quota.tokensUsed === null || quota.tokensUsed === undefined
        ? '' : `<span class="sub">${Number(quota.tokensUsed).toLocaleString('en')} توكن</span>`;
    return `<span class="ltr sub">${esc(fallbackText)}${pct}`
         + `<span class="sub"><span class="pill pill--${esc(tone)}">${esc(label)}</span></span>${tokens}</span>`;
}

function rateLimitCell(status) {
    if (!status) return '<span class="sub">—</span>';
    if (status.effective_enabled === false) {
        return `<span class="sub">مقفول<span class="sub">${status.is_overridden ? 'استثناء' : 'الإعداد العام'}</span></span>`;
    }
    const pressure = describeRateLimitPressure(status);
    const pressed = pressure.level === 'critical' || pressure.level === 'exhausted';
    const window = Number(status.window_requests) > 0 ? ` — ${Number(status.window_requests)} آخر دقيقة` : '';
    return `<span class="ltr sub${pressed ? ' rl-pressed' : ''}">${Number(status.effective_limit)}/دقيقة`
         + `<span class="sub">${status.is_overridden ? 'استثناء' : 'الإعداد العام'}${window}</span></span>`;
}

function renderUsers() {
    const q = $('userSearch').value.trim().toLowerCase();
    const filter = $('userFilter').value;

    const rows = state.users.filter((u) => {
        const status = evaluateSieAccessRow(u.access);
        if (filter === 'enabled' && !status.available) return false;
        if (filter === 'disabled' && status.available) return false;
        if (!q) return true;
        return `${u.name} ${u.email}`.toLowerCase().includes(q);
    });

    $('userEmpty').hidden = rows.length > 0;
    $('userRows').innerHTML = rows.map((u) => {
        const s = evaluateSieAccessRow(u.access);
        const usage = !u.access ? '—'
            : u.access.access_mode === 'quota'
                ? `${u.access.messages_used ?? 0} / ${u.access.message_quota ?? '—'}`
                : `${u.access.messages_used ?? 0} رسالة`;
        return `
        <tr>
          <td><b>${esc(u.name)}</b><span class="sub ltr">${esc(u.email)}</span></td>
          <td><span class="pill ${s.available ? 'pill--ok' : 'pill--warn'}">${esc(s.statusLabel)}</span></td>
          <td class="sub">${esc({ unlimited: 'من غير حدود', quota: 'عدد رسائل', expiration: 'لحد تاريخ' }[u.access?.access_mode] || '—')}</td>
          <td class="ltr sub">${quotaCell(u.quota, usage)}</td>
          <td>${rateLimitCell(u.rateLimit)}</td>
          <td><button class="btn-ghost btn-sm" data-edit="${esc(u.id)}">تعديل</button></td>
        </tr>`;
    }).join('');

    $('userRows').querySelectorAll('[data-edit]').forEach((b) =>
        b.addEventListener('click', () => openAccessDialog(b.dataset.edit)));
}

function wireAccessEditor() {
    $('aMode').addEventListener('change', syncAccessMode);
    $('cancelAccessBtn').addEventListener('click', () => $('accessDialog').close());
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
    $('accessUserName').textContent = user?.name || '';
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

    fillRateLimitFields(state.users.find((u) => u.id === userId)?.rateLimit || null);

    $('saveAccessBtn').disabled = !state.isSieAdmin;
    $('resetUsageBtn').disabled = !state.isSieAdmin || !row;
    $('resetRateLimitBtn').disabled = !state.isSieAdmin;
    $('accessDialog').showModal();
}

/**
 * The rate-limit half of the dialog.
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

    const meter = $('rlMeter');
    meter.className = `rl-meter-fill ${pressure.level}`;
    meter.style.width = `${Math.round(pressure.ratio * 100)}%`;

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
    const errBox = $('accessErrors');

    if (mode === 'quota' && !(Number($('aQuota').value) > 0)) {
        errBox.textContent = 'اكتب عدد رسائل أكبر من صفر.';
        errBox.hidden = false;
        return;
    }
    if (mode === 'expiration' && !$('aExpiry').value) {
        errBox.textContent = 'اختار تاريخ انتهاء.';
        errBox.hidden = false;
        return;
    }

    $('saveAccessBtn').disabled = true;
    const { error } = await adminSetAccess(supabase, {
        userId: state.editingUserId,
        isEnabled: $('aEnabled').checked,
        accessMode: mode,
        messageQuota: mode === 'quota' ? Number($('aQuota').value) : null,
        expiresAt: mode === 'expiration' ? new Date($('aExpiry').value).toISOString() : null,
        notes: $('aNotes').value.trim() || null
    });
    $('saveAccessBtn').disabled = false;

    if (error) {
        errBox.textContent = `تعذّر الحفظ: ${error.message}`;
        errBox.hidden = false;
        return;
    }

    // The rate limit is saved from the same button but through its own RPC:
    // different table, different authorization. Writing it AFTER the access
    // row means a rejected rate limit cannot roll back a quota change the
    // admin already made — they get told, and the quota stands.
    const rlError = await saveRateLimitFields();
    if (rlError) {
        errBox.textContent = `الصلاحية اتحفظت، لكن حد المعدل فشل: ${rlError.message}`;
        errBox.hidden = false;
        await loadUsers();
        return;
    }

    $('accessDialog').close();
    toast('اتحفظت الصلاحية وحد المعدل.');
    await loadUsers();
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
    if (!confirm('فك الحظر المؤقت للعميل ده؟ ده بيصفّر عدّاد المعدل من غير ما يغيّر الحد نفسه.')) return;
    const { error } = await adminResetRateLimit(supabase, state.editingUserId);
    if (error) {
        $('accessErrors').textContent = `تعذّر فك الحظر: ${error.message}`;
        $('accessErrors').hidden = false;
        return;
    }
    $('accessDialog').close();
    toast('اتفك الحظر — العميل يقدر يبعت دلوقتي.');
    await loadUsers();
}

async function submitResetUsage() {
    if (!confirm('تصفير عدّاد الاستخدام للعميل ده؟')) return;
    const { error } = await adminResetUsage(supabase, state.editingUserId);
    if (error) {
        $('accessErrors').textContent = `تعذّر التصفير: ${error.message}`;
        $('accessErrors').hidden = false;
        return;
    }
    $('accessDialog').close();
    toast('اتصفّر الاستخدام.');
    await loadUsers();
}
