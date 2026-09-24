/**
 * edition-perf.mjs
 * ------------------------------------------------------------
 * أداء الإصدارات — what each edition costs per turn, at the sizes the
 * product allows (Free 650 · Pro 1,000 · Max 1,500).
 *
 *   node --expose-gc bench/edition-perf.mjs [--json out.json]
 *
 * CATALOGS
 *   free        the real core (635)
 *   pro         the real core + real Pro pack
 *   pad-1000    real Pro + synthetic scenarios up to 1,000
 *   pad-1500    real Pro + synthetic scenarios up to 1,500
 * The synthetic scenarios are built by recombining REAL tokens, drawn with
 * the real catalog's document frequencies, so real messages hit posting lists
 * as long as a real 1,500-scenario catalog would produce. They exist to
 * measure COST; they are never shipped and never used for accuracy.
 *
 * MEASURED, per catalog, over the behaviour corpus (real language layer,
 * real trust envelope, the bridge's edition path):
 *   cold        first turn in a fresh catalog: index build + first scoring
 *   warm        per-turn wall time p50 / p95 / p99 / max
 *   memory      heap retained by catalog + indexes (after GC)
 *   candidates  scenarios actually scored per turn p50 / p95 / max
 *   state       persisted diagnostic + decision state after 3 turns, bytes
 * and the same warm latency for the full scan (no retrieval), so the report
 * can show what scoped retrieval buys at each size.
 *
 * @no-legitimate-corpus
 */
import fs from 'node:fs';
import { runTurn } from '../sie/pipeline/pipeline.js';
import { SIE_DEFAULT_SETTINGS } from '../sie/config/settings-schema.js';
import { buildBehaviorCorpus } from './corpora/behavior.mjs';
import { nodeEdition, readCore, readBaseGlossary } from '../sie/editions/tests/helpers/node-editions.js';
import { resolveEditionProfile } from '../sie/editions/editions.js';
import { scenarioSignatures } from '../sie/scenarios/scenario-types.js';

const gc = typeof global.gc === 'function' ? global.gc : null;
const heap = () => { if (gc) { gc(); gc(); } return process.memoryUsage().heapUsed; };
const pct = (xs, p) => { const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };
const r3 = (x) => Math.round(x * 1000) / 1000;

function lcg(seed) {
    let s = seed >>> 0;
    return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}

/** Synthetic scenarios from the real vocabulary at real document frequencies. */
export function padCatalog(base, target, seed = 7) {
    const df = new Map();
    for (const s of base) for (const sig of scenarioSignatures(s)) for (const e of sig) df.set(e.token, (df.get(e.token) || 0) + 1);
    const tokens = [...df.keys()];
    const cum = [];
    let acc = 0;
    for (const t of tokens) { acc += df.get(t); cum.push(acc); }
    const rand = lcg(seed);
    const draw = () => { const x = rand() * acc; let lo = 0, hi = cum.length - 1; while (lo < hi) { const m = (lo + hi) >> 1; if (cum[m] < x) lo = m + 1; else hi = m; } return tokens[lo]; };
    const out = [...base];
    for (let i = 0; out.length < target; i++) {
        const size = 2 + Math.floor(rand() * 3);
        const picked = new Set();
        while (picked.size < size) picked.add(draw());
        const sig = [...picked].map((token, k) => ({ token, weight: k === 0 ? 3 : 1 + Math.floor(rand() * 2), source: 'text' }));
        out.push({
            id: `synthetic_${i}`, intent: `synthetic/pad/${i}`, label: { ar: `اصطناعي ${i}`, en: `synthetic ${i}` }, category: 'other',
            evidenceSignature: sig, discriminatingQuestions: [], resolution: { hasAutoResolution: false }, requiresTicketIfUnresolved: true
        });
    }
    return out;
}

async function measure(name, catalog, edition, messages, providers) {
    const profile = { ...edition.profile, maxScenarios: catalog.length };
    const ed = { profile, glossaryLayers: edition.glossaryLayers };
    const before = heap();
    // Cold: a fresh array identity forces index construction on first use.
    const fresh = catalog.map((s) => s);
    let t0 = performance.now();
    await runTurn({ text: messages[0].text, catalog: fresh, settings: SIE_DEFAULT_SETTINGS, variant: 'retrieval_only', providers, edition: ed });
    const cold = performance.now() - t0;
    const memory = heap() - before;

    // Warm-up pass: JIT and caches, so "warm" means warm for every catalog
    // alike (the first catalog measured in a process otherwise pays for it).
    for (const m of messages.slice(0, 800)) {
        await runTurn({ text: m.text, catalog: fresh, settings: SIE_DEFAULT_SETTINGS, variant: 'retrieval_only', providers, edition: ed });
        await runTurn({ text: m.text, catalog: fresh, settings: SIE_DEFAULT_SETTINGS, variant: 'current', providers, edition: ed });
    }
    const warm = [], full = [], candidates = [];
    for (const m of messages) {
        t0 = performance.now();
        const r = await runTurn({ text: m.text, catalog: fresh, settings: SIE_DEFAULT_SETTINGS, variant: 'retrieval_only', providers, edition: ed });
        warm.push(performance.now() - t0);
        if (r.scope) candidates.push(r.scope.total);
    }
    for (const m of messages.slice(0, 1500)) {
        t0 = performance.now();
        await runTurn({ text: m.text, catalog: fresh, settings: SIE_DEFAULT_SETTINGS, variant: 'current', providers, edition: ed });
        full.push(performance.now() - t0);
    }
    // State size after 3-turn conversations.
    const states = [];
    for (let i = 0; i + 2 < Math.min(messages.length, 1200); i += 3) {
        let previous = null;
        for (const m of messages.slice(i, i + 3)) {
            const r = await runTurn({ text: m.text, catalog: fresh, previous, settings: SIE_DEFAULT_SETTINGS, variant: 'retrieval_only', providers, edition: ed });
            previous = { diagnosticState: r.diagnosticState, decisionState: r.decisionState, turnCount: r.turn, language: r.responseLanguage, lastCustomerText: m.text };
        }
        states.push(Buffer.byteLength(JSON.stringify({ d: previous.diagnosticState, s: previous.decisionState })));
    }
    return {
        catalog: name, size: catalog.length,
        coldMs: r3(cold), memoryMB: r3(memory / 1048576),
        warmMs: { p50: r3(pct(warm, 0.5)), p95: r3(pct(warm, 0.95)), p99: r3(pct(warm, 0.99)), max: r3(Math.max(...warm)) },
        fullScanMs: { p50: r3(pct(full, 0.5)), p95: r3(pct(full, 0.95)), p99: r3(pct(full, 0.99)) },
        candidates: { p50: pct(candidates, 0.5), p95: pct(candidates, 0.95), max: Math.max(...candidates) },
        stateBytes: { p50: pct(states, 0.5), p95: pct(states, 0.95), max: Math.max(...states) }
    };
}

export async function runEditionPerf({ log = console.log } = {}) {
    const core = readCore();
    const messages = buildBehaviorCorpus({ catalog: core, glossary: readBaseGlossary() });
    const free = await nodeEdition('free', SIE_DEFAULT_SETTINGS);
    const pro = await nodeEdition('pro', SIE_DEFAULT_SETTINGS);
    const maxProfile = resolveEditionProfile('max', SIE_DEFAULT_SETTINGS);
    const providers = (ed) => ({ glossaryProvider: ed.providers.glossaryProvider, arabiziProvider: ed.providers.arabiziProvider });
    const all = {
        free: () => measure('free (real)', free.scenarios, free, messages, providers(free)),
        pro: () => measure('pro (real)', pro.scenarios, pro, messages, providers(pro)),
        pad1000: () => measure('pro + synthetic → 1000', padCatalog(pro.scenarios, 1000), pro, messages, providers(pro)),
        pad1500: () => measure('pro + synthetic → 1500', padCatalog(pro.scenarios, 1500), { ...pro, profile: maxProfile }, messages, providers(pro))
    };
    const i = process.argv.indexOf('--only');
    const names = i > 0 ? [process.argv[i + 1]] : Object.keys(all);
    const rows = [];
    for (const n of names) rows.push(await all[n]());
    for (const r of rows) log(JSON.stringify(r));
    return rows;
}

if (import.meta.url === `file://${process.argv[1]}`) {
    const rows = await runEditionPerf();
    const i = process.argv.indexOf('--json');
    if (i > 0) fs.writeFileSync(process.argv[i + 1], JSON.stringify(rows, null, 2));
}
