/**
 * sie-shadow.js
 * ------------------------------------------------------------
 * تشغيل الظل — runs vNext beside the live engine on real traffic, and records
 * what it WOULD have done.
 *
 * ------------------------------------------------------------
 * WHY THE SAFETY IS STRUCTURAL, NOT A PROMISE
 *
 * A shadow run is only worth doing if it cannot affect a customer, and
 * "cannot" has to mean more than "the code does not call sendMessage".
 *
 * The guarantee here comes from what `runTurn` IS rather than from how it is
 * called: the pipeline stops at the Decision. Dialogue and Action — the two
 * stages that render a reply, write the session, open a ticket, spend quota,
 * or touch the database — are not in it and are not reachable from it. The
 * shadow cannot send a message for the same reason a calculator cannot: it
 * has no such function.
 *
 * That is why the comparison lives here and not inside the bridge's own flow.
 * A shadow implemented as "run the bridge with a doNotSend flag" would be one
 * forgotten branch away from answering a customer twice.
 *
 * Three further properties, each load-bearing:
 *
 *   FAILS SILENT. Any throw inside the shadow is caught and recorded. A
 *   measurement harness that can break the thing it measures is worse than no
 *   measurement.
 *
 *   BUDGETED. If the shadow exceeds its time budget the turn is recorded as
 *   timed-out and abandoned. Real traffic is not a benchmark, and a customer
 *   must never wait on an experiment.
 *
 *   READ-ONLY STATE. The shadow receives the live state and returns its own;
 *   the caller persists the LIVE one. vNext's state is threaded only between
 *   shadow turns, in memory, so a divergence in state cannot leak into the
 *   session that answers the customer.
 *
 * ------------------------------------------------------------
 * WHAT IT RECORDS
 *
 * Enough to classify a difference later without re-running anything, and
 * nothing that would make the trace a second copy of the conversation. The
 * customer's text is NOT recorded here — it is already in the trace's
 * `normalized_tokens.rawText`, and duplicating it would double the retention
 * surface for no analytic gain.
 */
import { runTurn } from '../sie/pipeline/pipeline.js';

/** A shadow turn that outruns this is abandoned. Real traffic is not a bench. */
const SHADOW_BUDGET_MS = 250;

/**
 * The fields a difference is classified on. Deliberately the same projection
 * `bench/comparator.mjs` uses, so an offline analysis of production shadow
 * records and an offline analysis of the corpora are directly comparable.
 */
function observable(result) {
    if (!result) return null;
    return {
        kind: result.interpretation?.kind ?? null,
        action: result.decision?.action ?? null,
        scenarioId: result.decision?.scenarioId ?? null,
        confidence: result.ranking?.topHypothesis?.hypothesis.confidence ?? null,
        ambiguous: result.ranking?.isAmbiguous ?? null,
        hasTicketDraft: Boolean(result.decision?.ticketDraft)
    };
}

function diffFields(a, b) {
    if (!a || !b) return [{ field: '*', live: a, shadow: b }];
    const out = [];
    for (const key of Object.keys(a)) {
        const x = a[key], y = b[key];
        const same = (typeof x === 'number' && typeof y === 'number') ? Math.abs(x - y) < 1e-9 : x === y;
        if (!same) out.push({ field: key, live: x, shadow: y });
    }
    return out;
}

/**
 * Runs vNext on a turn the live engine has already decided, and returns the
 * comparison. Never throws.
 *
 * @param {Object} params
 * @param {string} params.text                the customer's message
 * @param {Array} params.catalog
 * @param {Object} params.liveResult          what the live engine decided, in the
 *        shape `observable()` reads: { interpretation, decision, ranking }
 * @param {Object} [params.shadowPrevious]    vNext's own previous state, threaded
 *        between shadow turns only — never the live session's
 * @param {Object} [params.settings]
 * @param {Object} [params.providers]
 * @param {number} [params.budgetMs]
 * @returns {Promise<{record: Object, shadowState: Object|null}>}
 */
export async function runShadowComparison({
    text, catalog, liveResult, shadowPrevious = null, settings = {}, providers = {}, budgetMs = SHADOW_BUDGET_MS
}) {
    const started = Date.now();
    try {
        const shadow = await Promise.race([
            runTurn({ text, catalog, previous: shadowPrevious, settings, variant: 'vnext', providers }),
            new Promise((resolve) => setTimeout(() => resolve({ __timedOut: true }), budgetMs))
        ]);

        if (shadow?.__timedOut) {
            return { record: { status: 'timeout', budgetMs, elapsedMs: Date.now() - started }, shadowState: null };
        }

        const live = observable(liveResult);
        const shade = observable(shadow);
        const diff = diffFields(live, shade);

        return {
            record: {
                status: 'ok',
                agreed: diff.length === 0,
                diff,
                elapsedMs: Date.now() - started,
                // Cost signals, which are the other half of what a shadow run
                // is for: agreement says vNext is correct, these say whether
                // it is worth switching to.
                scoped: shadow.scope?.total ?? null,
                catalogSize: catalog.length,
                stateBytes: shadow.diagnosticState ? JSON.stringify(shadow.diagnosticState).length : null,
                trust: shadow.trace?.trust ?? null,
                evidenceDropped: shadow.evidenceDropped ?? 0
            },
            shadowState: {
                diagnosticState: shadow.diagnosticState,
                decisionState: shadow.decisionState,
                turnCount: shadow.turn,
                language: shadow.responseLanguage,
                lastCustomerText: String(text ?? '').slice(0, 500)
            }
        };
    } catch (err) {
        // A shadow that throws must not be able to fail the turn it shadows.
        return {
            record: { status: 'error', error: String(err?.message || err).slice(0, 200), elapsedMs: Date.now() - started },
            shadowState: null
        };
    }
}

/**
 * Aggregates shadow records into the numbers the gates read.
 *
 * Kept separate from the recording so it can run over production records
 * offline, and so the aggregation can be reviewed without reading the engine.
 *
 * @param {Object[]} records
 */
export function summariseShadow(records) {
    const list = Array.isArray(records) ? records : [];
    const ok = list.filter((r) => r?.status === 'ok');
    const agreed = ok.filter((r) => r.agreed).length;

    const byField = new Map();
    for (const r of ok) {
        for (const d of r.diff || []) byField.set(d.field, (byField.get(d.field) || 0) + 1);
    }

    // The differences that matter regardless of rate: a ticket appearing or
    // disappearing is never averaged into an agreement percentage.
    const ticketDifferences = ok.filter((r) => (r.diff || []).some((d) => d.field === 'hasTicketDraft'));
    const actionDifferences = ok.filter((r) => (r.diff || []).some((d) => d.field === 'action'));

    const ms = ok.map((r) => r.elapsedMs).filter((n) => typeof n === 'number').sort((a, b) => a - b);
    const p = (q) => (ms.length ? ms[Math.min(ms.length - 1, Math.floor(ms.length * q))] : null);

    return {
        total: list.length,
        ok: ok.length,
        errors: list.filter((r) => r?.status === 'error').length,
        timeouts: list.filter((r) => r?.status === 'timeout').length,
        agreed,
        agreementRate: ok.length ? agreed / ok.length : null,
        differencesByField: Object.fromEntries([...byField].sort((a, b) => b[1] - a[1])),
        actionDifferences: actionDifferences.length,
        ticketDifferences: ticketDifferences.length,
        latencyP50: p(0.5),
        latencyP95: p(0.95),
        scopedMedian: median(ok.map((r) => r.scoped).filter((n) => typeof n === 'number')),
        stateBytesMedian: median(ok.map((r) => r.stateBytes).filter((n) => typeof n === 'number'))
    };
}

function median(values) {
    if (!values.length) return null;
    const s = [...values].sort((a, b) => a - b);
    return s[Math.floor(s.length / 2)];
}
