/**
 * golden-runner.mjs — multi-turn, multi-session conversations with expectations.
 * ------------------------------------------------------------
 * A golden conversation is data (../golden/*.json): one or more chats of one
 * customer, the messages they send, and what must be true after each turn.
 * The runner drives them through the real runtime (runtime-world.mjs) under
 * one or more settings profiles and evaluates every expectation.
 *
 * ── RED AND GREEN ───────────────────────────────────────────
 * Each run declares a status:
 *
 *   green  every expectation holds. A failure is a regression.
 *   red    a known defect. The run must fail, and it must fail on EXACTLY
 *          the expectations listed in `failingNow` — no fewer (the defect
 *          is gone, or the test went vacuous) and no more (it fails for a
 *          different reason than the one claimed).
 *
 * That is how "a regression test that fails before the fix and passes after
 * it" is enforced mechanically: the red run is the proof it fails today and
 * why; the fix flips the run to green in the same change. A fix that lands
 * without flipping it breaks the red run, so a stale red cannot linger.
 *
 * Expectation ids are `<chat>#<turn>.<key>` (turn is 1-based) or
 * `final.<key>`, which is what `failingNow` lists.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeWorld, converse, matchedRule, loadSettingsProfile } from './runtime-world.mjs';

const GOLDEN_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'golden');

/** Every golden conversation, with the file it came from. */
export function loadGoldens() {
    return fs.readdirSync(GOLDEN_DIR)
        .filter((f) => f.endsWith('.json'))
        .sort()
        .flatMap((f) => JSON.parse(fs.readFileSync(path.join(GOLDEN_DIR, f), 'utf8')).conversations.map((g) => ({ ...g, file: f })));
}

/**
 * The engine's own template sentences, by name, so golden files never carry
 * raw customer-facing strings and a template rewording is a one-line change
 * here. Each value is a fragment that identifies the template.
 */
export const TEXT = Object.freeze({
    TICKET_CONFIRM: 'تحب أفتحلك تذكرة',
    DECLINED_REVIEW: 'مش هفتح تذكرة',
    TICKET_STILL_OPEN: 'لسه شغالة',
    CLOSED_GLAD: 'مبسوط إنها اتظبطت',
    SATISFACTION_ACK: 'مبسوط إنها ظبطت',
    ESCALATION: 'هوصلك بفريق الدعم',
    GREETING: 'أهلاً بيك',
    MEMORY_SAVED: 'حفظتها',
    DATA_UNAVAILABLE: 'مش لاقي بيانات',
    LAST_ISSUE: 'آخر مرة'
});

/** Ticket lifecycle state as committed in the session (WP4, G-L5-1). */
const TICKET_STATE_PATH = 'sie.decisionState.ticket.state';

const get = (obj, dotted) => dotted.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
const texts = (v) => [].concat(v).map((k) => {
    if (!(k in TEXT)) throw new Error(`unknown TEXT key ${k}`);
    return TEXT[k];
});

/** Evaluates one turn's expectations. Returns the keys that failed, with why. */
function checkTurn(turn, expect, world) {
    const failed = [];
    const fail = (key, why) => failed.push({ key, why });
    const t = turn.trace;
    const decision = t?.decision ?? null;
    const hyps = (t?.hypotheses || []).map((h) => h.scenarioId);
    const sortedHyps = [...(t?.hypotheses || [])].sort((a, b) => b.confidence - a.confidence || a.scenarioId.localeCompare(b.scenarioId));
    const reply = turn.reply ?? '';

    for (const [key, want] of Object.entries(expect || {})) {
        switch (key) {
            case 'handled': if (turn.handled !== want) fail(key, `handled=${turn.handled}`); break;
            case 'traced': if (Boolean(t) !== want) fail(key, `traced=${Boolean(t)}`); break;
            case 'action': if ((decision?.action ?? null) !== want) fail(key, `action=${decision?.action}`); break;
            case 'actionNot': if ([].concat(want).includes(decision?.action)) fail(key, `action=${decision?.action}`); break;
            case 'scenarioId': if ((decision?.scenarioId ?? null) !== want) fail(key, `scenarioId=${decision?.scenarioId}`); break;
            case 'rule': if (matchedRule(turn) !== want) fail(key, `rule=${matchedRule(turn)}`); break;
            case 'knowledgeSource': if ((t?.knowledge_data?.source ?? null) !== want) fail(key, `knowledge=${t?.knowledge_data?.source}`); break;
            case 'hypothesesInclude': for (const id of want) if (!hyps.includes(id)) fail(key, `missing ${id}`); break;
            case 'hypothesesExclude': for (const id of want) if (hyps.includes(id)) fail(key, `present ${id}`); break;
            case 'hypothesesNonEmpty': if ((hyps.length > 0) !== want) fail(key, `hypotheses=${hyps.length}`); break;
            case 'hypothesisMax':
                for (const [id, max] of Object.entries(want)) {
                    const h = (t?.hypotheses || []).find((x) => x.scenarioId === id);
                    if (h && h.confidence > max) fail(key, `${id}=${h.confidence.toFixed(2)} > ${max}`);
                }
                break;
            case 'topScenarioNotPrefix': if (sortedHyps[0]?.scenarioId?.startsWith(want)) fail(key, `top=${sortedHyps[0]?.scenarioId}`); break;
            case 'tokensInclude': for (const tok of want) if (!(t?.normalized_tokens?.canonicals || []).includes(tok)) fail(key, `missing token ${tok}`); break;
            case 'replyIs': if (!texts(want).every((frag) => reply.includes(frag))) fail(key, `reply="${reply.slice(0, 60)}"`); break;
            case 'replyIsNot': if (texts(want).some((frag) => reply.includes(frag))) fail(key, `reply="${reply.slice(0, 60)}"`); break;
            case 'replyIncludes': for (const s of [].concat(want)) if (!reply.includes(s)) fail(key, `reply lacks "${s}"`); break;
            case 'replyExcludes': for (const s of [].concat(want)) if (reply.includes(s)) fail(key, `reply has "${s}"`); break;
            case 'traceMatchesReply': if ((t?.rendered?.responseText === turn.reply) !== want) fail(key, `trace="${(t?.rendered?.responseText ?? '').slice(0, 40)}" sent="${reply.slice(0, 40)}"`); break;
            case 'shadowPresent': if (Boolean(t?.ranking?.shadow) !== want) fail(key, `shadow=${Boolean(t?.ranking?.shadow)}`); break;
            case 'shadowAgreed': if (t?.ranking?.shadow?.agreed !== want) fail(key, `agreed=${t?.ranking?.shadow?.agreed}`); break;
            case 'ruleDetailExcludes': if ((decision?.evaluatedRules || []).some((r) => String(r.detail).includes(want))) fail(key, `a rule detail contains "${want}"`); break;
            case 'stateHas': for (const p of [].concat(want)) if (get(turn.state, p) == null) fail(key, `state lacks ${p}`); break;
            case 'stateLacks': for (const p of [].concat(want)) if (get(turn.state, p) != null) fail(key, `state has ${p}`); break;
            case 'ticketsTotal': if (world.ticketsCreated.length !== want) fail(key, `tickets=${world.ticketsCreated.length}`); break;
            case 'reviewsTotal': if (world.reviews.length !== want) fail(key, `reviews=${world.reviews.length}`); break;
            case 'handoffsTotal': if (world.handoffs.length !== want) fail(key, `handoffs=${world.handoffs.length}`); break;
            case 'factsExclude': for (const f of want) if (world.facts.some((x) => x.key === f.key && x.value === f.value)) fail(key, `stored ${f.key}=${f.value}`); break;
            case 'tracesEqualQuota': if ((world.traces.length === world.quota) !== want) fail(key, `traces=${world.traces.length} quota=${world.quota}`); break;
            // ── WP4 ──
            case 'decisionScenarioNotPrefix': if (String(decision?.scenarioId ?? '').startsWith(want)) fail(key, `scenarioId=${decision?.scenarioId}`); break;
            case 'stateEquals': for (const [p, v] of Object.entries(want)) if (get(turn.state, p) !== v) fail(key, `${p}=${JSON.stringify(get(turn.state, p))}`); break;
            case 'ticketState': if (get(turn.state, TICKET_STATE_PATH) !== want) fail(key, `ticket.state=${JSON.stringify(get(turn.state, TICKET_STATE_PATH))}`); break;
            case 'effectsInclude': {
                const done = (t?.action_result?.effects || []).filter((e) => e.ok).map((e) => e.type);
                for (const type of [].concat(want)) if (!done.includes(type)) fail(key, `executed [${done.join(',')}] lacks ${type}`);
                break;
            }
            case 'effectsExclude': {
                const done = (t?.action_result?.effects || []).map((e) => e.type);
                for (const type of [].concat(want)) if (done.includes(type)) fail(key, `executed [${done.join(',')}] has ${type}`);
                break;
            }
            case 'lastTicketHasScenario': if (Boolean(world.ticketsCreated.at(-1)?.p_scenario_id) !== want) fail(key, `scenario=${world.ticketsCreated.at(-1)?.p_scenario_id ?? null}`); break;
            case 'lastTicketCommittedAs': {
                const committed = get(world.ticketsCreated.at(-1)?.p_bot_state, TICKET_STATE_PATH);
                if (committed !== want) fail(key, `committed ticket.state=${JSON.stringify(committed)}`);
                break;
            }
            default: throw new Error(`unknown expectation key "${key}"`);
        }
    }
    return failed;
}

/**
 * Runs one golden conversation under one profile.
 * @returns {Promise<{failures: Array<{id: string, why: string}>, turns: Array}>}
 */
export async function runGolden(golden, profile) {
    // `settingsOverrides` adjusts the run's profile (e.g. a kill switch off)
    // rather than replacing it, so the run is still "production, but …".
    const settings = golden.settingsOverrides ? { ...loadSettingsProfile(profile), ...golden.settingsOverrides } : null;
    const world = makeWorld({ profile, ...(settings ? { settings } : {}), ...(golden.world || {}) });
    const failures = [];
    const turns = [];
    for (const chat of golden.chats) {
        if (chat.advanceMinutesBefore) world.advance(chat.advanceMinutesBefore);
        // One turn at a time, so totals (tickets, reviews, …) are checked as
        // they stand right after that turn, not at the end of the chat.
        for (const [i, { expect, ...msg }] of chat.turns.entries()) {
            const [rec] = await converse(world, chat.chat, [msg]);
            turns.push(rec);
            for (const f of checkTurn(rec, expect, world)) failures.push({ id: `${chat.chat}#${i + 1}.${f.key}`, why: f.why });
        }
    }
    if (golden.final) {
        for (const f of checkTurn({ reply: '', state: null, trace: null }, golden.final, world)) failures.push({ id: `final.${f.key}`, why: f.why });
    }
    return { failures, turns, world };
}

/** Throws a readable error when the run's outcome does not match its declared status. */
export function assertRunStatus(golden, run, failures) {
    const ids = [...new Set(failures.map((f) => f.id))].sort();
    const detail = failures.map((f) => `  ${f.id}: ${f.why}`).join('\n');
    if (run.status === 'green') {
        if (ids.length) throw new Error(`${golden.id} [${run.profile}] is green but failed:\n${detail}`);
        return;
    }
    if (run.status !== 'red') throw new Error(`${golden.id} [${run.profile}]: status must be red or green`);
    const declared = [...new Set(run.failingNow || [])].sort();
    if (!declared.length) throw new Error(`${golden.id} [${run.profile}] is red but declares no failingNow`);
    if (!ids.length) {
        throw new Error(`${golden.id} [${run.profile}] is red but now PASSES — the defect looks fixed. Flip this run to green in the same change.`);
    }
    if (JSON.stringify(ids) !== JSON.stringify(declared)) {
        throw new Error(`${golden.id} [${run.profile}] is red for the wrong reason.\n  declared failingNow: ${declared.join(', ')}\n  actually failing:   ${ids.join(', ')}\n${detail}`);
    }
}
