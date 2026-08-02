/**
 * settings.js — SIE settings console (standalone)
 * ------------------------------------------------------------
 * Identical logic to the original sie-admin/settings.js. The only
 * change: the Supabase client comes from ./supabase-client.js (a local
 * client pointed at the same project) instead of the platform's
 * /api-config.js, which isn't reachable from this origin — same fix
 * already applied to login.js, per sie-admin/readme.md.
 *
 * Three things an operator needs in one place: what the engine knows
 * (scenarios), how it decides (engine settings), and who is allowed to
 * use it (users).
 *
 * ── ARCHITECTURE ────────────────────────────────────────────
 * Every call into SIE goes through `/sie-integration/sie-runtime.js` and
 * nothing else. This page never imports an engine module directly, so
 * the nine modules stay free to change shape behind the runtime. The
 * only non-SIE import is the standalone Supabase client, because
 * Mad3oom owns authentication and sessions — SIE has no identity system
 * of its own.
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
    SIE_RUNTIME_VERSION
} from '/sie-integration/sie-runtime.js';

const LOGIN_PAGE = './login.html';

const state = {
    scenarios: [],
    drafts: [],
    users: [],
    isStaff: false,
    isSieAdmin: false,
    editingUserId: null
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

    await Promise.all([loadScenarios(), loadEngineSettings(), loadUsers()]);
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
    state.scenarios = await listActiveScenarios();
    state.drafts = state.isStaff ? await listStoredScenarioVersions(supabase) : [];

    const categories = [...new Set(state.scenarios.map((s) => s.category))].sort();
    $('scenarioCategory').insertAdjacentHTML('beforeend',
        categories.map((c) => `<option value="${esc(c)}">${esc(c)}</option>`).join(''));

    const auto = state.scenarios.filter((s) => s.resolution.hasAutoResolution).length;
    const withQ = state.scenarios.filter((s) => s.discriminatingQuestions?.length).length;
    $('scenarioStats').innerHTML = [
        ['إجمالي السيناريوهات', state.scenarios.length],
        ['بيرد تلقائيًا', auto],
        ['بيفتح تذكرة', state.scenarios.length - auto],
        ['فيها أسئلة توضيحية', withQ]
    ].map(([k, v]) => `<div class="stat"><b>${v}</b><span>${k}</span></div>`).join('');

    $('draftCount').textContent = state.drafts.length;
    renderDrafts();
    renderScenarios();

    ['scenarioSearch', 'scenarioCategory', 'scenarioResolution']
        .forEach((id) => $(id).addEventListener('input', renderScenarios));
    $('newScenarioBtn').addEventListener('click', () => openScenarioDialog(null));
    if (!state.isStaff) {
        $('newScenarioBtn').disabled = true;
        $('newScenarioBtn').title = 'إضافة السيناريوهات لفريق المحرك فقط';
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
          <td>
            <b>${esc(s.label.ar)}</b>
            <span class="sub ltr">${esc(s.id)}</span>
          </td>
          <td><span class="pill">${esc(s.category)}</span></td>
          <td class="ltr sub">${s.evidenceSignature.map((e) =>
              `${esc(e.token)}<b>·${e.weight}</b>`).join('<br>')}</td>
          <td>${s.resolution.hasAutoResolution
              ? '<span class="pill pill--ok">رد تلقائي</span>'
              : '<span class="pill pill--warn">تذكرة</span>'}</td>
          <td>${s.discriminatingQuestions?.length || 0}</td>
          <td><button class="btn-ghost btn-sm" data-view="${esc(s.id)}">عرض</button></td>
        </tr>`).join('');

    $('scenarioRows').querySelectorAll('[data-view]').forEach((b) =>
        b.addEventListener('click', () => openScenarioDialog(
            state.scenarios.find((s) => s.id === b.dataset.view))));
}

function renderDrafts() {
    $('draftRows').innerHTML = state.drafts.length
        ? state.drafts.map((d) => `
            <tr>
              <td class="ltr">${esc(d.scenario_key)}</td>
              <td>${d.version}</td>
              <td><span class="pill">${esc(d.status)}</span></td>
              <td class="sub">${esc(d.notes || '—')}</td>
              <td class="sub">${d.created_at ? new Date(d.created_at).toLocaleString('ar-EG') : ''}</td>
            </tr>`).join('')
        : '<tr><td colspan="5" class="sub">مفيش مسودات محفوظة.</td></tr>';
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
// Engine settings
// ═════════════════════════════════════════════════════════════
async function loadEngineSettings() {
    const kv = (grid, pairs) => {
        $(grid).innerHTML = pairs.map(([k, v, hint]) => `
            <div class="kv">
              <span class="kv-k">${esc(k)}</span>
              <span class="kv-v ltr">${esc(v)}</span>
              ${hint ? `<span class="kv-hint">${esc(hint)}</span>` : ''}
            </div>`).join('');
    };

    try {
        const policy = await import('/sie/decision/decision-policy.js');
        const tracker = await import('/sie/diagnostics/hypothesis-tracker.js');
        const ranking = await import('/sie/ranking/ranking-engine.js');

        kv('policyGrid', [
            ['حد الحسم', policy.RESOLUTION_CONFIDENCE_THRESHOLD, 'الثقة اللازمة عشان المحرك يرد أو يفتح تذكرة'],
            ['أقصى أسئلة توضيحية', policy.MAX_CLARIFYING_QUESTIONS, 'بعدها بيصعّد بدل ما يفضل يسأل'],
            ['أقصى عدد أدوار', policy.MAX_TURNS_BEFORE_ESCALATION, 'سقف المحادثة قبل التصعيد الإجباري'],
            ['أدوار بلا تقدّم', policy.MAX_NO_PROGRESS_TURNS, 'أدوار متتالية بلا دليل جديد قبل الاستسلام'],
            ['حد التفعيل', tracker.ACTIVATION_THRESHOLD, 'الفرضية بتُعتبر مرشحة فوق القيمة دي'],
            ['حد الرفض', tracker.REJECTION_THRESHOLD, 'تحتها بتُرفض بعد ما كانت نشطة'],
            ['هامش التعادل', ranking.AMBIGUITY_MARGIN, 'فرق أقل من كده بين أول اتنين = تعادل']
        ]);
    } catch (err) {
        $('policyGrid').innerHTML = `<div class="sub">تعذّر قراءة إعدادات القرار: ${esc(err.message)}</div>`;
    }

    try {
        const [glossary, arabizi] = await Promise.all([
            fetch('/sie/language/data/technical-glossary.json').then((r) => r.json()),
            fetch('/sie/language/data/arabizi-map.json').then((r) => r.json())
        ]);
        kv('languageGrid', [
            ['مصطلحات معرّفة', glossary.entries.length],
            ['أنماط الكتابة', glossary.entries.reduce((n, e) => n + e.patterns.length, 0),
             'يشمل الفصحى والعامية والأخطاء الإملائية الشائعة'],
            ['كلمات فرانكو', Object.keys(arabizi.wordMap).length],
            ['نسخة الـ runtime', SIE_RUNTIME_VERSION]
        ]);
    } catch (err) {
        $('languageGrid').innerHTML = `<div class="sub">تعذّر قراءة بيانات اللغة: ${esc(err.message)}</div>`;
    }

    try {
        const knowledge = await fetch('/sie/knowledge/static-knowledge.data/content.json').then((r) => r.json());
        $('knowledgeRows').innerHTML = knowledge.entries.map((e) => `
            <tr><td class="ltr"><b>${esc(e.key)}</b></td>
                <td class="sub">${esc(e.text.ar.slice(0, 160))}${e.text.ar.length > 160 ? '…' : ''}</td></tr>`).join('');
    } catch {
        $('knowledgeRows').innerHTML = '<tr><td colspan="2" class="sub">تعذّر تحميل قاعدة المعرفة.</td></tr>';
    }

    $('tryBtn').addEventListener('click', runDiagnosisPreview);
    $('tryInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') runDiagnosisPreview(); });
}

/**
 * Runs Language -> Diagnostics -> Ranking on a sample message.
 *
 * Stops before Decision and Action deliberately: this is a preview, and
 * it must never be able to write a message, open a ticket or spend a
 * customer's quota.
 */
async function runDiagnosisPreview() {
    const text = $('tryInput').value.trim();
    const box = $('tryResult');
    if (!text) return;

    box.hidden = false;
    box.innerHTML = 'جارِ التشخيص…';
    try {
        const { normalize } = await import('/sie/language/normalizer.js');
        const { processTurn } = await import('/sie/diagnostics/diagnostic-engine.js');
        const { rankDiagnosticState } = await import('/sie/ranking/ranking-engine.js');

        const { normalizedTokens, responseLanguage } = await normalize(text);
        const diagnosticState = await processTurn({ normalizedTokens, turn: 1 });
        const ranking = await rankDiagnosticState(diagnosticState);
        const top = ranking.ranked.slice(0, 5);

        box.innerHTML = `
          <div class="try-tokens"><b>الأدلة المستخرجة:</b>
            ${normalizedTokens.map((t) => `<span class="tok tok--${esc(t.source)}">${esc(t.canonical)}</span>`).join('') || '<span class="sub">مفيش</span>'}
          </div>
          <div class="sub">لغة الرد: ${esc(responseLanguage)} · تعادل: ${ranking.isAmbiguous ? 'أيوه' : 'لأ'}</div>
          <table class="data-table">
            <thead><tr><th>السيناريو</th><th>الثقة</th><th></th></tr></thead>
            <tbody>${top.map((r) => `
              <tr>
                <td>${esc(r.scenario?.label.ar || r.hypothesis.scenarioId)}<span class="sub ltr">${esc(r.hypothesis.scenarioId)}</span></td>
                <td class="ltr"><b>${r.hypothesis.confidence.toFixed(2)}</b></td>
                <td>${r.hypothesis.confidence >= 0.6
                    ? '<span class="pill pill--ok">يحسم</span>'
                    : '<span class="pill pill--warn">يسأل</span>'}</td>
              </tr>`).join('')}</tbody>
          </table>`;
    } catch (err) {
        box.innerHTML = `<span class="sub">تعذّر التشخيص: ${esc(err.message)}</span>`;
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
            'تفعيل SIE للعملاء مقصور على أدمن SIE. تقدر تشوف القائمة، لكن التعديل هيترفض من قاعدة البيانات.';
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
        ['إجمالي المستخدمين', state.users.length],
        ['مفعّل لهم SIE', enabled],
        ['غير مفعّل', state.users.length - enabled],
        ['بحدود استخدام', state.users.filter((u) => u.access && u.access.access_mode !== 'unlimited').length]
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
          <td class="sub">${esc(u.access?.access_mode || '—')}</td>
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
