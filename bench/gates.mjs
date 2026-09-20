/**
 * gates.mjs
 * ------------------------------------------------------------
 * The conditions vNext must meet before it is allowed near a customer.
 *
 * Run: node --expose-gc bench/gates.mjs    (exit 0 = all gates pass)
 *
 * ------------------------------------------------------------
 * WHAT A GATE IS, AND WHAT IT IS NOT
 *
 * A gate is a measured threshold with a stated reason, checked automatically,
 * that BLOCKS activation when it fails. It is not a dashboard and not a
 * checklist someone ticks.
 *
 * Three rules this file obeys:
 *
 *   1. EVERY GATE NAMES ITS EVIDENCE. A gate whose source you cannot re-run
 *      is an opinion with a green tick next to it.
 *   2. SAFETY GATES ARE NOT RATES. "99.9% of attacks blocked" is not a gate;
 *      an attack that manufactures a ticket is a failure at any rate, so
 *      those gates count events, not percentages.
 *   3. A FAILING GATE IS NOT FIXED DURING ACTIVATION. It sends the work back
 *      to the stage that produced it. That is a process rule this file cannot
 *      enforce, so it is written down here where the failure appears.
 *
 * Note what is deliberately NOT gated: production shadow agreement. No
 * shadow run has happened, so there is no number, and inventing a threshold
 * for evidence that does not exist would make this file dishonest. It is
 * listed as a BLOCKING PREREQUISITE instead.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const results = [];

function gate(name, { reason, evidence }, check) {
    let verdict;
    try {
        verdict = check();
    } catch (err) {
        verdict = { pass: false, detail: `gate threw: ${err?.message || err}` };
    }
    results.push({ name, reason, evidence, ...verdict });
}

function run(cmd, args) {
    try {
        return { ok: true, out: execFileSync(cmd, args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 1 << 26, stdio: ['ignore', 'pipe', 'pipe'] }) };
    } catch (err) {
        return { ok: false, out: `${err.stdout || ''}${err.stderr || ''}` };
    }
}

console.log('SIE vNext — activation gates\n');
console.log('Running the suite and the comparator. This takes a couple of minutes.\n');

const suite = run('npm', ['test']);
const comparator = run('node', ['bench/comparator.mjs']);

// ------------------------------------------------------------

gate('1. No regression in known-correct cases', {
    reason: 'A case the current engine gets right must not become wrong. This is the whole null hypothesis.',
    evidence: 'bench/comparator.mjs — corpus B (known cases) and the classifier'
}, () => {
    const regressions = (comparator.out.match(/correct regression/g) || []).length;
    const line = comparator.out.match(/improvements: (\d+)\s+regressions: (\d+)\s+unknown \(need review\): (\d+)/);
    const reported = line ? Number(line[2]) : null;
    return {
        pass: regressions === 0 && reported === 0,
        detail: line ? `improvements ${line[1]}, regressions ${line[2]}, unknown ${line[3]}` : 'comparator output not parsed'
    };
});

gate('2. No unexplained difference in important decisions', {
    reason: 'Every difference must be classified. "Unknown" means nobody has decided whether it is a bug.',
    evidence: 'bench/comparator.mjs — the classifier, which refuses to guess without ground truth'
}, () => {
    const line = comparator.out.match(/unknown \(need review\): (\d+)/);
    const unknown = line ? Number(line[1]) : null;
    return { pass: unknown === 0, detail: unknown === null ? 'not parsed' : `${unknown} unclassified difference(s)` };
});

gate('3. No increase in unsafe actions', {
    reason: 'An attack turn must not gain the ability to open a ticket. Counted, not rated: one is a failure.',
    evidence: 'bench/comparator.mjs — corpus C, `unsafeIf` classification'
}, () => {
    const regressions = (comparator.out.match(/safety regression/g) || []).length;
    const improvements = (comparator.out.match(/safety improvement/g) || []).length;
    return { pass: regressions === 0, detail: `${improvements} safety improvement(s), ${regressions} safety regression(s)` };
});

gate('4. Trust blocks the required adversarial cases', {
    reason: 'The layer is only worth its false positives if it catches what it claims to.',
    evidence: 'sie/trust/tests/adversarial.test.mjs — 18 attacks at or above their required level'
}, () => {
    const pass = suite.ok && !/not ok .*adversarial: every attack/.test(suite.out);
    return { pass, detail: pass ? '18/18 attacks caught' : 'one or more attacks not caught' };
});

gate('5. No unacceptable increase in false positives', {
    reason: 'A security layer that inconveniences customers gets switched off, and a switched-off control is worse than none.',
    evidence: 'sie/trust/tests/adversarial.test.mjs — 0/327 legitimate corpus messages escalated'
}, () => {
    const pass = suite.ok && !/not ok .*false-positive rate/.test(suite.out);
    return { pass, detail: pass ? '0.00% on the reference corpus (a LOWER BOUND — see gate P1)' : 'false-positive rate above 0' };
});

gate('6. Retrieval drops no correct case', {
    reason: 'Retrieval is claimed to be exact. If it changes one leader, the claim is false and the speedup is irrelevant.',
    evidence: 'sie/pipeline/tests/retrieval-safety.test.mjs — all 650 scenarios, leader AND decision'
}, () => {
    const pass = suite.ok && !/not ok .*retrieval:/.test(suite.out);
    return { pass, detail: pass ? 'all 650 scenarios reach the same leader and the same decision' : 'retrieval changed an outcome' };
});

gate('7. Sparse state preserves behaviour', {
    reason: 'Smaller state is worthless if a conversation driven through it diverges.',
    evidence: 'sie/pipeline/tests/sparse-equivalence.test.mjs — 1, 2, 3, 10, 50, 100 turns'
}, () => {
    const pass = suite.ok && !/not ok .*sparse state:/.test(suite.out);
    return { pass, detail: pass ? 'identical behaviour on every turn at every length' : 'behaviour diverged' };
});

gate('8. No loss of context across turns', {
    reason: 'Retrieval narrows the scope, and the scope is what a later turn refers back to.',
    evidence: 'retrieval-safety: the committed-scenario label test; sparse-equivalence: continuation from storage'
}, () => {
    const pass = suite.ok
        && !/not ok .*committed to stays reachable/.test(suite.out)
        && !/not ok .*session continuation/.test(suite.out);
    return { pass, detail: pass ? 'labels and session continuation survive the narrowed scope' : 'context lost' };
});

gate('9. Every failure mode produces safe behaviour', {
    reason: 'Malformed input must not be able to take down a turn. Three crashes were found this way.',
    evidence: 'sie/pipeline/tests/robustness.test.mjs — 16 deliberate failure cases'
}, () => {
    const pass = suite.ok && !/not ok .*robustness:/.test(suite.out);
    return { pass, detail: pass ? '16/16 hostile inputs produced a valid decision' : 'a hostile input crashed or produced an invalid decision' };
});

gate('10. CPU stays inside the edge budget at the target size', {
    reason: 'The engine runs in a Supabase Edge Function. Steady-state latency at 10,000 scenarios must leave room for everything else in a turn.',
    evidence: 'bench/scaling-bench.mjs — measured p50 0.120 ms, p95 1.230 ms, max 2.30 ms at N=10,000'
}, () => {
    // Re-measured live rather than quoted, so the gate cannot pass on a stale
    // number in a comment.
    const out = run('node', ['--expose-gc', 'bench/scaling-bench.mjs']);
    const row = out.out.split('\n').find((l) => /^10000\s+vnext/.test(l));
    if (!row) return { pass: false, detail: 'could not find the 10,000 vnext row' };
    const [, , p50, p95] = row.split(/\s+/);
    const ok = Number(p50) < 5 && Number(p95) < 25;
    return { pass: ok, detail: `N=10,000 vnext p50=${p50}ms p95=${p95}ms (budget p50<5ms, p95<25ms)` };
});

gate('11. Memory growth is bounded and independent of catalog size', {
    reason: 'Session state at 100,000 scenarios was 28 MB per conversation. That, not CPU, is the wall.',
    evidence: 'bench/scaling-bench.mjs — persisted state per turn, both variants'
}, () => {
    const out = run('node', ['--expose-gc', 'bench/scaling-bench.mjs']);
    const rows = out.out.split('\n').filter((l) => /^\d+\s+vnext/.test(l));
    if (rows.length === 0) return { pass: false, detail: 'no vnext rows found' };
    const worst = Math.max(...rows.map((r) => Number(r.split(/\s+/)[8])));
    // 1 MB per session is already generous; the measured worst case is ~99 KB
    // at 100,000, and ~11 KB at the 10,000 target.
    return { pass: worst < 1048576, detail: `largest persisted state across all sizes: ${(worst / 1024).toFixed(1)} KB` };
});

gate('12. Flags default off, and off is a no-op', {
    reason: 'A deployment must change nothing on its own. This is what makes the whole plan reversible.',
    evidence: 'sie-integration/tests/trust-integration.test.mjs — defaults and the off-is-identical tests'
}, () => {
    const pass = suite.ok
        && !/not ok .*flags off:/.test(suite.out)
        && !/not ok .*the defaults really are off/.test(suite.out);
    return { pass, detail: pass ? 'all three flags default off and off is byte-identical' : 'a flag is on by default or off is not a no-op' };
});

// ------------------------------------------------------------

const W = 52;
console.log('GATE'.padEnd(W) + 'VERDICT   DETAIL');
console.log('-'.repeat(120));
for (const r of results) {
    console.log(r.name.padEnd(W) + (r.pass ? 'PASS      ' : 'FAIL      ') + r.detail);
}
console.log('-'.repeat(120));

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} gates pass.\n`);

if (failed.length) {
    console.log('FAILING GATES — do not activate, and do not fix these during activation:');
    for (const r of failed) console.log(`  ${r.name}\n      why it exists: ${r.reason}\n      evidence:      ${r.evidence}\n      result:        ${r.detail}`);
}

console.log(`
BLOCKING PREREQUISITES — not gates, because there is no measurement yet

  P1. SHADOW RUN ON REAL TRAFFIC. Every number above comes from corpora, and
      the largest corpus of real messages available is 19 production traces.
      The 0.00% false-positive rate is measured against test-suite text and
      is a LOWER BOUND, not an estimate. sie-integration/sie-shadow.js exists
      to replace it; until it has run, gate 5 is passing on a proxy.

  P2. A DECISION ON THE 5 EXPECTED DIFFERENCES. The comparator classifies
      them as architectural (confidence 0 -> null where no scenario scored).
      That classification is mine, not the product owner's.

  P3. VOCABULARY GROWTH, if the catalog is to grow. Measured: discriminability
      falls from 77% at 650 to 46% at 10,000 with today's 516 tokens. That is
      not a vNext regression — it is true of the current engine too — but
      activating vNext to enable catalog growth without it would ship a known
      cliff.
`);

process.exitCode = failed.length > 0 ? 1 : 0;
