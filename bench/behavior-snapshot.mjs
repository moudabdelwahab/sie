/**
 * behavior-snapshot.mjs
 * ------------------------------------------------------------
 * لقطة سلوك — what one engine configuration decides for every message in
 * the behaviour corpus, recorded so two configurations can be diffed.
 *
 * Runs the real pipeline (`sie/pipeline/pipeline.js`, the same one the shadow
 * run uses) turn by turn, single-turn per message, with default settings. The
 * record per message is deliberately small — what a customer would see
 * change — so a diff reads as behaviour, not as internals:
 *
 *   kind        interpretation (diagnostic / small_talk / …)
 *   action      the decision engine's action
 *   scenarioId  what it answered, asked about, or ticketed
 *   ambiguous   whether R6 saw a stand-off
 *   top         the three leading candidates (ids), for explaining a change
 *   ms          wall time of the turn, for the performance report
 */
import { runTurn } from '../sie/pipeline/pipeline.js';
import { SIE_DEFAULT_SETTINGS } from '../sie/config/settings-schema.js';

export async function snapshotBehavior({ messages, catalog, providers, settings = SIE_DEFAULT_SETTINGS, variant = 'current', rankingOptions = {} }) {
    const rows = [];
    for (const m of messages) {
        const t0 = performance.now();
        const r = await runTurn({ text: m.text, catalog, settings, variant, providers, rankingOptions });
        const ms = performance.now() - t0;
        const ranking = r.ranking;
        rows.push({
            id: m.id,
            stratum: m.stratum,
            expect: m.expect ?? null,
            kind: r.interpretation?.kind ?? null,
            action: r.decision?.action ?? null,
            scenarioId: r.decision?.scenarioId ?? null,
            ambiguous: ranking ? ranking.isAmbiguous : null,
            top: ranking ? ranking.ranked.filter((e) => e.hypothesis.confidence > 0).slice(0, 3).map((e) => e.hypothesis.scenarioId) : [],
            topConfidence: ranking?.topHypothesis?.hypothesis.confidence ?? null,
            scope: r.scope?.total ?? null,
            ms
        });
    }
    return rows;
}

/**
 * Classifies every message's change between two snapshots of the SAME
 * corpus. The categories are what the comparison report is built from.
 */
export function diffSnapshots(before, after, { scenarioAlias = new Map() } = {}) {
    const byId = new Map(after.map((r) => [r.id, r]));
    const out = { same: 0, changed: [], counts: {} };
    const bump = (k) => { out.counts[k] = (out.counts[k] || 0) + 1; };
    for (const b of before) {
        const a = byId.get(b.id);
        if (!a) { bump('missing'); continue; }
        const bScenario = scenarioAlias.get(b.scenarioId) || b.scenarioId;
        if (a.action === b.action && a.scenarioId === bScenario && a.ambiguous === b.ambiguous && a.kind === b.kind) {
            out.same += 1; bump('same'); continue;
        }
        const category = classify(b, a, bScenario);
        bump(category);
        out.changed.push({ id: b.id, stratum: b.stratum, expect: b.expect, category, before: pick(b), after: pick(a) });
    }
    return out;
}

function pick(r) { return { kind: r.kind, action: r.action, scenarioId: r.scenarioId, ambiguous: r.ambiguous, top: r.top }; }

const ANSWERING = new Set(['ANSWER']);

function classify(b, a, bScenario) {
    if (a.kind !== b.kind) return 'interpretation_changed';
    const hitB = b.expect && (bScenario === b.expect);
    const hitA = a.expect && a.scenarioId === a.expect;
    if (b.expect) {
        if (!hitB && hitA) return 'improved_now_correct';
        if (hitB && !hitA) return 'regressed_lost_correct';
    }
    if (b.ambiguous && !a.ambiguous) return 'ambiguity_resolved';
    if (!b.ambiguous && a.ambiguous) return 'ambiguity_introduced';
    if (!ANSWERING.has(b.action) && ANSWERING.has(a.action)) return 'now_answers';
    if (ANSWERING.has(b.action) && !ANSWERING.has(a.action)) return 'stopped_answering';
    if (a.scenarioId !== bScenario) return 'different_scenario';
    return 'action_changed';
}
