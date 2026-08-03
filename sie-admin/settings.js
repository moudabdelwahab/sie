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
    getSieSettings,
    saveSieSetting,
    publishScenarioVersion,
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
    editingUserId: null
};

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
        ['حالة بيفهمها', state.scenarios.length],
        ['بيرد عليها بحل', auto],
        ['بيجمع معلومات ويسلّم', state.scenarios.length - auto],
        ['بيسأل فيها سؤال توضيحي', withQ]
    ].map(([k, v]) => `<div class="stat"><b>${v}</b><span>${k}</span></div>`).join('');

    $('draftCount').textContent = state.drafts.length;
    renderDrafts();
    renderScenarios();

    ['scenarioSearch', 'scenarioCategory', 'scenarioResolution']
        .forEach((id) => $(id).addEventListener('input', renderScenarios));
    $('newScenarioBtn').addEventListener('click', () => openScenarioDialog(null));
    if (!state.isStaff) {
        $('newScenarioBtn').disabled = true;
        $('newScenarioBtn').title = 'إضافة الحالات متاحة لفريق العمل بس';
    }
}

function renderScenarios() {
    const q = $('scenarioSearch').value.trim().toLowerCase();
    const cat = $('scenarioCategory').value;
    const res = $('scenarioResolution').value;

    const rows = state.scenarios.filter((s) => {
        if (cat && s.category !== cat) return false;
        if (res === 'auto' && !s.resolution.hasAutoResolution) return false;
        if (res === 'manual' && s.resolution.hasAutoResolution) return false;
        if (!q) return true;
        const hay = [s.id, s.label.ar, s.label.en, ...s.evidenceSignature.map((e) => e.token)]
            .join(' ').toLowerCase();
        return hay.includes(q);
    });

    $('scenarioEmpty').hidden = rows.length > 0;
    $('scenarioRows').innerHTML = rows.map((s) => `
        <tr>
          <td><b>${esc(s.label.ar)}</b></td>
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
        : '<tr><td colspan="5" class="sub">لسه مضفتش أي حالة.</td></tr>';

    $('draftRows').querySelectorAll('[data-publish]').forEach((b) =>
        b.addEventListener('click', async () => {
            if (!confirm('تفعيل الحالة دي معناها إن المحرك يبدأ يستخدمها مع العملاء. تمام؟')) return;
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

    const scenario = {
        id: $('fId').value.trim(),
        label: { ar: $('fLabelAr').value.trim(), en: $('fLabelEn').value.trim() },
        category: $('fCategory').value,
        evidenceSignature: evidence,
        discriminatingQuestions: [],
        resolution: $('fHasAuto').checked
            ? { hasAutoResolution: true, text: { ar: $('fTextAr').value.trim(), en: $('fTextEn').value.trim() } }
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
            <input type="range" min="${def.min}" max="${def.max}" step="${def.step || 1}"
                   value="${value}" ${disabled ? 'disabled' : ''}>
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
            const out = row.querySelector('output');
            const def = SETTINGS_BY_KEY[key];
            // Live label while dragging, one save on release — a save per
            // pixel would be dozens of writes for one decision.
            range.addEventListener('input', () => { out.textContent = formatNumber(def, Number(range.value)); });
            range.addEventListener('change', () => {
                const previous = state.settings[key];
                commitSetting(key, Number(range.value), range, () => {
                    range.value = previous;
                    out.textContent = formatNumber(def, previous);
                });
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
                + 'لو دي حالة متكررة عندك، ضيفها من صفحة «الحالات اللي بيفهمها».</span>';
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
            <thead><tr><th>أقرب الحالات</th><th>درجة التأكد</th></tr></thead>
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

    const [{ data: profiles, error: pErr }, { data: access }] = await Promise.all([
        supabase.from('profiles').select('id, full_name, email, role').order('created_at', { ascending: false }),
        supabase.from('customer_sie_access').select('*')
    ]);

    if (pErr) {
        $('userEmpty').hidden = false;
        $('userEmpty').textContent = `تعذّر تحميل المستخدمين: ${pErr.message}`;
        return;
    }

    const byUser = new Map((access || []).map((a) => [a.user_id, a]));
    state.users = (profiles || []).map((p) => ({
        id: p.id,
        name: p.full_name || '—',
        email: p.email || '',
        role: p.role,
        access: byUser.get(p.id) || null
    }));

    const enabled = state.users.filter((u) => evaluateSieAccessRow(u.access).available).length;
    $('userStats').innerHTML = [
        ['كل المستخدمين', state.users.length],
        ['مسموح لهم', enabled],
        ['مش مسموح', state.users.length - enabled],
        ['عندهم حد استخدام', state.users.filter((u) => u.access && u.access.access_mode !== 'unlimited').length]
    ].map(([k, v]) => `<div class="stat"><b>${v}</b><span>${k}</span></div>`).join('');

    ['userSearch', 'userFilter'].forEach((id) => $(id).addEventListener('input', renderUsers));
    renderUsers();
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
          <td class="ltr sub">${esc(usage)}</td>
          <td><button class="btn-ghost btn-sm" data-edit="${esc(u.id)}">تعديل</button></td>
        </tr>`;
    }).join('');

    $('userRows').querySelectorAll('[data-edit]').forEach((b) =>
        b.addEventListener('click', () => openAccessDialog(b.dataset.edit)));
}

function wireAccessEditor() {
    $('aMode').addEventListener('change', syncAccessMode);
    $('cancelAccessBtn').addEventListener('click', () => $('accessDialog').close());
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

    $('saveAccessBtn').disabled = !state.isSieAdmin;
    $('resetUsageBtn').disabled = !state.isSieAdmin || !row;
    $('accessDialog').showModal();
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

    $('accessDialog').close();
    toast('اتحفظت الصلاحية.');
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
