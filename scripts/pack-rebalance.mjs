/**
 * pack-rebalance.mjs — make a pack satisfy the single-token rule
 * (edition-audit single_token_competition) by re-weighting signatures.
 *
 *   node scripts/pack-rebalance.mjs pro [--dry]
 *
 * Each token gets a CAP — the most of a signature's weight it may carry:
 *   token some CORE scenario uses      best core single-token confidence
 *                                      minus AMBIGUITY_MARGIN (never below
 *                                      the inactive cap)
 *   pack-only token shared by 2+ pack  just under ACTIVATION_THRESHOLD: a
 *   scenarios                          bare shared word activates nothing
 *   token only this scenario uses      uncapped
 * Caps depend on the core catalog and on token usage only, so they are fixed
 * before any weight changes — no oscillation. Per signature, water-filling:
 * tokens over their cap are pinned at it, the remaining share goes to the
 * others in their ORIGINAL proportions, repeated until nothing exceeds its
 * cap. A signature whose caps sum below 1 is infeasible — it has no
 * distinctive token — and is reported, not forced.
 */
import fs from 'node:fs';
import path from 'node:path';
import { readCore, readPack } from '../sie/editions/tests/helpers/node-editions.js';
import { ACTIVATION_THRESHOLD, computeScenarioConfidence } from '../sie/diagnostics/hypothesis-tracker.js';
import { AMBIGUITY_MARGIN } from '../sie/ranking/ranking-engine.js';
import { scenarioTokens } from '../sie/scenarios/scenario-types.js';

const pack = process.argv[2] || 'pro';
const dry = process.argv.includes('--dry');
const core = readCore();
const packScenarios = readPack(pack).scenarios;

const INACTIVE = ACTIVATION_THRESHOLD - 0.01;
const LEADER_CAP = 0.5;
const ATOM_LEADER_CAP = 0.33;
const ATOM_LEADERS = {
    atom_balance: 'billing_whatsapp_transactions',
    atom_button: 'ticket_reopen_button_missing',
    atom_by_itself: 'ticket_opened_by_payment_request',
    atom_by_mistake: 'ticket_opened_by_mistake',
    atom_close: 'ticket_close_own',
    atom_device: 'security_2fa_asked_every_login',
    atom_follow: 'ticket_follow_on_whatsapp',
    atom_member: 'company_member_cannot_manage_members',
    atom_mode: 'chatbot_modes_compare',
    atom_register: 'api_register_webhook_how',
    atom_remove: 'subdomain_rename_or_delete',
    atom_renewal: 'billing_renew_before_expiry',
    atom_reopen: 'ticket_reopen_button_missing',
    atom_security: 'notif_security_alert',
    atom_similar: 'ticket_similar_ticket_warning',
    atom_support: 'ticket_contact_channels',
    atom_topup: 'billing_whatsapp_topup_how',
    atom_upgrade: 'subscription_upgrade_end_date_unchanged'
    // no generic reading: atom_cancel, atom_change, atom_code, atom_company,
    // atom_link, atom_open_action, atom_reply, atom_request, atom_unchanged, atom_where
};
const coreBest = new Map();
const coreTokens = new Set(core.flatMap((s) => [...scenarioTokens(s)]));
// For a core word alone: the best core confidence, and the third best among
// core CANDIDATES. A pack scenario must stay AMBIGUITY_MARGIN under the best
// (no stand-off) AND under the third (it must not push a core candidate that
// carries a clarifying question out of the top three the decision engine
// takes questions from — on «استرجاع» that turned a question into a ticket).
// Only where displacement can change the outcome: the top two core readings
// of the word already tie (R6 will look for a question) and one of the top
// three carries a discriminating question.
const coreThird = new Map();
for (const t of coreTokens) {
    const presence = new Map([[t, 1]]);
    const ranked = core.map((s) => ({ s, c: computeScenarioConfidence(s, presence).confidence }))
        .filter((x) => x.c >= ACTIVATION_THRESHOLD).sort((a, b) => b.c - a.c);
    coreBest.set(t, ranked[0]?.c || 0);
    const tied = ranked.length >= 2 && ranked[0].c - ranked[1].c < AMBIGUITY_MARGIN;
    const asks = ranked.slice(0, 3).some((x) => (x.s.discriminatingQuestions || []).length > 0);
    coreThird.set(t, tied && asks && ranked.length >= 3 ? ranked[2].c : 0);
}
// Pack scenarios get their confidence from their OWN evidence: core words
// together carry at most CORE_SHARE_MAX of any pack signature, so a message
// made only of core words never crowns a pack scenario.
const CORE_SHARE_MAX = 1; // group cap disabled: measured, not needed — see the report
const usage = new Map();
for (const s of packScenarios) for (const t of scenarioTokens(s)) usage.set(t, (usage.get(t) || 0) + 1);

// A pack-only word shared by several pack scenarios gets ONE leader: the
// scenario in which, alone, it scores highest (ties: the first authored —
// files are ordered most-valuable-first). The leader is uncapped on it; the
// others stay AMBIGUITY_MARGIN below the leader's single-word confidence, so
// a bare topic word has one reading instead of a stand-off.
// Explicit leaders: the general reading of a bare topic word. Words without
// an entry (atoms included) are led by the scenario where they score highest
// alone; a bare atom then has one weak reading, which is a clarifying
// question, never a stand-off.
const LEADERS = {
    entity_assistant: 'assistant_where_available',
    entity_company_dashboard: 'account_portal_vs_company_dashboard',
    entity_rate_service: 'ticket_rate_support',
    entity_transfer_proof: 'billing_upload_transfer_proof',
    entity_link_code: 'assistant_link_telegram',
    entity_english_language: 'ticket_reply_in_english_wanted_arabic',
    entity_article: 'helpcenter_no_article_found',
    entity_leads: 'leads_added_lead_not_saved',
    entity_ai_client: 'mcp_tool_missing_in_ai_app',
    entity_key_word: 'api_key_state_meaning',
    intent_subscribe: 'billing_subscribe_whatsapp_service',
    entity_sidebar_menu: 'account_whatsapp_menu_missing'
};
const leader = new Map(); // token -> { id, conf }
for (const [t, id] of Object.entries(LEADERS)) {
    const sc = packScenarios.find((x) => x.id === id);
    if (sc) leader.set(t, { id, conf: computeScenarioConfidence(sc, new Map([[t, 1]])).confidence, fixed: true });
}
for (const s of packScenarios) {
    for (const t of scenarioTokens(s)) {
        if (coreTokens.has(t) || (usage.get(t) || 0) < 2 || leader.get(t)?.fixed) continue;
        const conf = computeScenarioConfidence(s, new Map([[t, 1]])).confidence;
        const cur = leader.get(t);
        if (!cur || conf > cur.conf + 1e-9) leader.set(t, { id: s.id, conf });
    }
}

// Glue words: generic words that only help a combination (so their meaning
// alone is not the case). Capped under the activation bar in EVERY scenario,
// even when unique — otherwise «كبير» alone scored 0.5 for "proof file too
// large" and tied with an unrelated core reading of the rest of a message.
const GLUE = new Set([
    'entity_too_big', 'atom_request', 'entity_service_word', 'atom_link', 'entity_arabic_word',
    'entity_what_is', 'symptom_not_happening', 'atom_code', 'entity_key_word', 'entity_merge_plan', 'entity_not_accepted'
]);

function cap(t, scenarioId, authoredShare = 1) {
    // Glue never activates a scenario alone, in any scenario: a bare
    // «المفتاح» or «كبير» has no pack reading, exactly as in Free.
    if (GLUE.has(t)) return INACTIVE;
    // Atoms never decide alone. At most one GENERIC reading leads a bare atom,
    // and only weakly (ATOM_LEADER_CAP — a clarifying question, never an
    // answer); every other use is inactive. Atoms with no generic reading in
    // the pack (null) lead nothing.
    if (t.startsWith('atom_')) {
        const lead = ATOM_LEADERS[t];
        return lead === scenarioId ? ATOM_LEADER_CAP : INACTIVE;
    }
    // Pack-only TOPIC words («كود الربط», «اثبات التحويل») keep the weight
    // their author gave them: capping a non-leader's own topic word moved its
    // weight onto generic core words and created new pair stand-offs.
    if (!coreTokens.has(t)) return 1;
    if (coreTokens.has(t)) {
        let c = coreBest.get(t) - AMBIGUITY_MARGIN - 0.01;
        if (coreThird.get(t) > 0) c = Math.min(c, coreThird.get(t) - 0.01);
        return c >= ACTIVATION_THRESHOLD ? c : INACTIVE;
    }
    if ((usage.get(t) || 0) < 2) return 1;
    const l = leader.get(t);
    // The leader of a SHARED word keeps the share its author gave it — the
    // rebalancer must not INFLATE it by moving capped weight onto it (that
    // turned «المفتاح» alone into a 0.78 answer). Floor LEADER_CAP so a hub
    // authored at a lower share can still absorb a little.
    if (l.id === scenarioId) return Math.max(LEADER_CAP, authoredShare);
    const c = Math.min(l.conf, LEADER_CAP) - AMBIGUITY_MARGIN - 0.01;
    return c >= ACTIVATION_THRESHOLD ? c : INACTIVE;
}

function waterFill(entries, id) {
    const total0 = entries.reduce((a, e) => a + e.w, 0);
    const caps = entries.map((e) => cap(e.t, id, e.w / total0));
    if (caps.reduce((a, c) => a + c, 0) < 1 - 1e-9) return null;
    const pinned = new Array(entries.length).fill(false);
    const share = new Array(entries.length).fill(0);
    for (let round = 0; round < entries.length + 1; round++) {
        const free = entries.map((e, i) => (pinned[i] ? 0 : e.w));
        const freeTotal = free.reduce((a, w) => a + w, 0);
        const left = 1 - share.reduce((a, s, i) => a + (pinned[i] ? s : 0), 0);
        let violated = false;
        entries.forEach((e, i) => { if (!pinned[i]) share[i] = (free[i] / freeTotal) * left; });
        entries.forEach((e, i) => {
            if (!pinned[i] && share[i] > caps[i] + 1e-9) { pinned[i] = true; share[i] = caps[i]; violated = true; }
        });
        if (!violated) break;
    }
    // Group cap on core words, then hand the excess to non-core tokens with
    // room left under their own caps.
    const isCore = entries.map((e) => coreTokens.has(e.t));
    const coreSum = share.reduce((a, x, i) => a + (isCore[i] ? x : 0), 0);
    if (coreSum > CORE_SHARE_MAX + 1e-9) {
        const k = CORE_SHARE_MAX / coreSum;
        let excess = 0;
        entries.forEach((e, i) => { if (isCore[i]) { excess += share[i] * (1 - k); share[i] *= k; } });
        for (let pass = 0; pass < 4 && excess > 1e-9; pass++) {
            const room = entries.map((e, i) => (isCore[i] ? 0 : Math.max(0, caps[i] - share[i])));
            const totalRoom = room.reduce((a, r) => a + r, 0);
            if (totalRoom <= 1e-9) return null;
            const give = Math.min(excess, totalRoom);
            entries.forEach((e, i) => { share[i] += (room[i] / totalRoom) * give; });
            excess -= give;
        }
        if (excess > 1e-6) return null;
    }
    return share;
}

const dir = `sie/scenarios/packs/src/${pack}`;
const files = fs.readdirSync(dir).filter((f) => f.endsWith('.mjs')).map((f) => path.join(dir, f));
const texts = Object.fromEntries(files.map((f) => [f, fs.readFileSync(f, 'utf8')]));
let changed = 0;
const infeasible = [];

for (const s of packScenarios) {
    const f = files.find((file) => texts[file].includes(`S('${s.id}',`));
    const src = texts[f];
    const start = src.indexOf(`S('${s.id}',`);
    const end = Math.min(...[src.indexOf('\n        S(', start + 1), src.indexOf('\n    ]', start + 1)].filter((i) => i > 0));
    let block = src.slice(start, end);
    block = block.replace(/'((?:[a-z0-9_]+:[0-9.]+\s*)+)'/g, (m, sig) => {
        const entries = sig.trim().split(/\s+/).map((p) => { const [t, w] = p.split(':'); return { t, w: Number(w) }; });
        const total = entries.reduce((a, e) => a + e.w, 0);
        const coreShare = entries.reduce((a, e) => a + (coreTokens.has(e.t) ? e.w / total : 0), 0);
        if (coreShare <= CORE_SHARE_MAX + 1e-3 && entries.every((e) => e.w / total <= cap(e.t, s.id, e.w / total) + 1e-3)) return m;
        const share = waterFill(entries, s.id);
        if (!share) { infeasible.push(`${s.id}: ${sig}`); return m; }
        // Per-mille weights; capped tokens rounded DOWN so rounding can never
        // push a share back over its cap (whole percents oscillated).
        const caps = entries.map((e) => cap(e.t, s.id, e.w / total));
        const next = entries.map((e, i) => {
            const w = share[i] >= caps[i] - 1e-9 ? Math.floor(share[i] * 1000) : Math.round(share[i] * 1000);
            return `${e.t}:${Math.max(1, w)}`;
        }).join(' ');
        changed += 1;
        console.log(`${s.id}: ${sig} -> ${next}`);
        return `'${next}'`;
    });
    texts[f] = src.slice(0, start) + block + src.slice(end);
}
if (!dry) for (const f of files) fs.writeFileSync(f, texts[f]);
console.log(`${changed} signatures re-weighted${dry ? ' (dry run)' : ''}; ${infeasible.length} infeasible:`);
for (const x of infeasible) console.log('  ' + x);
