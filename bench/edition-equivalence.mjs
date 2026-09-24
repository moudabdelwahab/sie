/**
 * edition-equivalence.mjs
 * ------------------------------------------------------------
 * هل «المجاني» بعد الإصدارات = المحرك النهارده؟ — the proof required before
 * the bridge may run Free through the edition path.
 *
 * Production today scores EVERY scenario on every turn, with no evidence
 * cap and no retrieval limit (pipeline variant `current`). With editions the
 * bridge runs Free through scoped retrieval (top-K by exact confidence, plus
 * every scenario the conversation remembers or references), a per-turn
 * distinct-token cap, and the edition's message bound. This bench runs both
 * on the same messages and conversations and compares, per turn:
 *
 *   kind · action · scenarioId · ambiguous · the top three candidates
 *
 * Any difference fails the run (exit 1) and is printed with its message.
 *
 *   node bench/edition-equivalence.mjs [--edition free] [--conversations 1500]
 *
 * @no-legitimate-corpus
 */
import { runTurn } from '../sie/pipeline/pipeline.js';
import { SIE_DEFAULT_SETTINGS } from '../sie/config/settings-schema.js';
import { buildBehaviorCorpus } from './corpora/behavior.mjs';
import { ADVERSARIAL_CONVERSATIONS, KNOWN, REGRESSION } from './corpora/index.mjs';
import { nodeEdition, readCore, readBaseGlossary } from '../sie/editions/tests/helpers/node-editions.js';
import { createRealArabiziProvider } from '../sie/language/tests/helpers/node-providers.js';

function arg(name, fallback) {
    const i = process.argv.indexOf(`--${name}`);
    return i > 0 ? process.argv[i + 1] : fallback;
}

function lcg(seed) {
    let s = seed >>> 0;
    return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}

const FOLLOW_UPS = ['لسه مش شغال', 'تمام اتحلت شكرا', 'مش فاهم', 'ايوه', 'لا', 'جربت ومنفعش', 'عايز اكلم حد', 'طب وبعدين'];

const view = (r) => ({
    kind: r.interpretation?.kind ?? null,
    action: r.decision?.action ?? null,
    scenarioId: r.decision?.scenarioId ?? null,
    ambiguous: r.ranking ? r.ranking.isAmbiguous : null,
    top: r.ranking ? r.ranking.ranked.filter((e) => e.hypothesis.confidence > 0).slice(0, 3).map((e) => e.hypothesis.scenarioId).join(',') : ''
});

const nextPrevious = (r, text) => ({
    diagnosticState: r.diagnosticState, decisionState: r.decisionState,
    turnCount: r.turn, language: r.responseLanguage, lastCustomerText: String(text).slice(0, 500)
});

export async function runEquivalence({ edition = 'free', conversations = 1500, settings = SIE_DEFAULT_SETTINGS, log = console.log } = {}) {
    const core = readCore();
    const glossary = readBaseGlossary();
    const baseProviders = { glossaryProvider: { getEntries: async () => glossary }, arabiziProvider: createRealArabiziProvider() };
    const ed = await nodeEdition(edition, settings);
    const edProviders = { glossaryProvider: baseProviders.glossaryProvider, arabiziProvider: baseProviders.arabiziProvider };
    const edArg = { profile: ed.profile, glossaryLayers: ed.glossaryLayers };

    const corpus = buildBehaviorCorpus({ catalog: core, glossary });
    const rnd = lcg(20260924);
    const convs = [];
    for (let i = 0; i < conversations; i++) {
        const a = corpus[Math.floor(rnd() * corpus.length)].text;
        const b = corpus[Math.floor(rnd() * corpus.length)].text;
        const f = FOLLOW_UPS[Math.floor(rnd() * FOLLOW_UPS.length)];
        convs.push(rnd() < 0.5 ? [a, f, b] : [a, b, f]);
    }
    for (const c of ADVERSARIAL_CONVERSATIONS) convs.push(c.turns.map((t) => t.text));
    // Diagnostic messages that share no word with any scenario — the turns
    // where "score everything" and "score what matches" differ most.
    for (const t of ['zxq wvb', 'كلام ملوش علاقة خالص بأي حاجة', 'ﻻﻻﻻ ؟؟؟ ...', '١٢٣٤٥', 'ok ok ok']) convs.push([t], ['عندي مشكلة في الفاتورة', t]);
    const singles = [...corpus.map((m) => m.text), ...KNOWN.map((k) => k.text || k.message || k), ...REGRESSION.map((k) => k.text || k.message || k)]
        .filter((t) => typeof t === 'string');
    for (const t of singles) convs.push([t]);

    const diffs = [];
    let turns = 0;
    const timeA = [], timeB = [];
    const scopeSizes = [];
    for (const messages of convs) {
        let pa = null, pb = null;
        for (const text of messages) {
            let t0 = performance.now();
            const ra = await runTurn({ text, catalog: core, previous: pa, settings: SIE_DEFAULT_SETTINGS, variant: 'current', providers: baseProviders });
            timeA.push(performance.now() - t0);
            t0 = performance.now();
            const rb = await runTurn({ text, catalog: ed.scenarios, previous: pb, settings: SIE_DEFAULT_SETTINGS, variant: 'retrieval_only', providers: edProviders, edition: edArg });
            timeB.push(performance.now() - t0);
            if (rb.scope) scopeSizes.push(rb.scope.total);
            turns += 1;
            const va = view(ra), vb = view(rb);
            const same = Object.keys(va).every((k) => va[k] === vb[k]);
            if (!same) diffs.push({ messages, text, current: va, edition: vb });
            pa = nextPrevious(ra, text);
            pb = nextPrevious(rb, text);
        }
    }

    const pct = (xs, p) => { const s = [...xs].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };
    const summary = {
        edition, catalog: ed.scenarios.length, conversations: convs.length, turns, differences: diffs.length,
        latencyMs: {
            current: { p50: pct(timeA, 0.5), p95: pct(timeA, 0.95), p99: pct(timeA, 0.99) },
            edition: { p50: pct(timeB, 0.5), p95: pct(timeB, 0.95), p99: pct(timeB, 0.99) }
        },
        scopeSize: scopeSizes.length ? { p50: pct(scopeSizes, 0.5), p95: pct(scopeSizes, 0.95), max: Math.max(...scopeSizes) } : null
    };
    log(JSON.stringify(summary, (k, v) => (typeof v === 'number' && !Number.isInteger(v) ? Number(v.toFixed(3)) : v), 2));
    for (const d of diffs.slice(0, 20)) log('DIFF', JSON.stringify(d));
    return { summary, diffs };
}

if (import.meta.url === `file://${process.argv[1]}`) {
    const { diffs } = await runEquivalence({ edition: arg('edition', 'free'), conversations: Number(arg('conversations', 1500)) });
    process.exit(diffs.length ? 1 : 0);
}
