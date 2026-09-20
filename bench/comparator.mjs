/**
 * comparator.mjs
 * ------------------------------------------------------------
 * SIE current vs SIE vNext, same inputs, same state, same catalog.
 *
 * Run: node bench/comparator.mjs
 *
 * ------------------------------------------------------------
 * WHAT MAKES THIS A COMPARISON AND NOT A DEMO
 *
 * Three rules, and breaking any one of them would make the output worthless:
 *
 * 1. ONE CODE PATH. Both variants are configurations of `runTurn`, not two
 *    pipelines. A comparison between two separately-written implementations
 *    measures the implementations as much as the change.
 *
 * 2. AGREEMENT IS THE NULL HYPOTHESIS. vNext is supposed to be a faster,
 *    smaller, safer way of reaching the SAME decision. Every difference is a
 *    finding that has to be explained, including the good ones. The only
 *    corpus where difference is the goal is E (regression), where current is
 *    known to be wrong.
 *
 * 3. DIFFERENCES ARE ATTRIBUTED, NOT COUNTED. When the variants disagree, the
 *    comparator re-runs the case with each component alone. "vNext differs on
 *    3% of turns" is not actionable; "retrieval causes all of them, on turns
 *    where the customer said thanks" is.
 *
 * Averages hide the cases that matter, so every difference is listed
 * individually and the summary never replaces the list.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { runTurn, runConversation, VARIANTS } from '../sie/pipeline/pipeline.js';
import { createRealGlossaryProvider, createRealArabiziProvider } from '../sie/language/tests/helpers/node-providers.js';
import { PRODUCTION, KNOWN, ATTACKS, ADVERSARIAL_CONVERSATIONS, REGRESSION, generateCases } from './corpora/index.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CATALOG = JSON.parse(fs.readFileSync(path.join(ROOT, 'sie/scenarios/scenario-catalog.data/scenarios.json'), 'utf8')).scenarios;
const providers = { glossaryProvider: createRealGlossaryProvider(), arabiziProvider: createRealArabiziProvider() };

/** How two turns are compared. Everything a customer could notice. */
function observable(result) {
    return {
        kind: result.interpretation?.kind ?? null,
        action: result.decision?.action ?? null,
        scenarioId: result.decision?.scenarioId ?? null,
        confidence: result.ranking?.topHypothesis?.hypothesis.confidence ?? null,
        ambiguous: result.ranking?.isAmbiguous ?? null,
        hasTicketDraft: Boolean(result.decision?.ticketDraft),
        alternatives: (result.ranking?.ranked || [])
            .slice(1, 4)
            .filter((r) => r.hypothesis.confidence > 0)
            .map((r) => r.hypothesis.scenarioId)
    };
}

function diffFields(a, b) {
    const out = [];
    for (const key of Object.keys(a)) {
        const x = a[key], y = b[key];
        const same = Array.isArray(x) ? JSON.stringify(x) === JSON.stringify(y)
            : (typeof x === 'number' && typeof y === 'number') ? Math.abs(x - y) < 1e-9
                : x === y;
        if (!same) out.push({ field: key, current: x, vnext: y });
    }
    return out;
}

/**
 * Which component caused a difference. Re-runs the conversation with each
 * component alone; the first whose output matches vNext's is the cause.
 */
async function attribute(turns, turnIndex, settings) {
    const messages = turns.map((t) => t.text);
    const causes = [];
    for (const name of ['retrieval_only', 'sparse_only', 'trust_only']) {
        const results = await runConversation({ messages, catalog: CATALOG, settings, variant: name, providers });
        const base = await runConversation({ messages, catalog: CATALOG, settings, variant: 'current', providers });
        if (diffFields(observable(base[turnIndex]), observable(results[turnIndex])).length > 0) {
            causes.push(name.replace('_only', ''));
        }
    }
    return causes.length ? causes : ['unattributed'];
}

/**
 * Classifies a difference. Ground truth where it exists; `unknown` where it
 * does not — never a guess dressed as a verdict.
 */
function classify({ diff, expect, unsafeIf, currentObs, vnextObs }) {
    // ── Safety first. A difference that changes whether an attack opens a
    //    ticket is not a tie to be broken by accuracy averages.
    if (unsafeIf === 'ticket') {
        if (currentObs.hasTicketDraft && !vnextObs.hasTicketDraft) {
            return { klass: 'safety improvement', why: 'current manufactures a ticket from this turn; vNext withholds it' };
        }
        if (!currentObs.hasTicketDraft && vnextObs.hasTicketDraft) {
            return { klass: 'safety regression', why: 'vNext manufactures a ticket current withheld' };
        }
        // No ticket either way, but the attack still moved belief in current.
        if (currentObs.scenarioId && !vnextObs.scenarioId) {
            return { klass: 'safety improvement', why: 'current diagnoses a scenario from an attack turn; vNext contributes no belief' };
        }
    }
    if (unsafeIf === 'blocked') {
        const blocked = (o) => o.action === 'WAIT_FOR_USER' && !o.scenarioId;
        if (!blocked(currentObs) && blocked(vnextObs)) {
            return { klass: 'false positive', why: 'vNext blocks a legitimate customer that current served' };
        }
    }

    // ── The one difference that is by construction.
    //
    // With no candidates, current reports `confidence: 0` — which is the
    // confidence of whichever scenario id sorts first among 650 that all
    // scored zero. vNext reports null, because nothing was scored. The action
    // is identical; only the number in the trace differs, and vNext's is the
    // honest one. Classifying this as "unknown" buried five real turns under
    // a label meant for things that need review.
    const onlyNullConfidence = diff.length === 1 && diff[0].field === 'confidence'
        && diff[0].current === 0 && diff[0].vnext === null;
    if (onlyNullConfidence) {
        return { klass: 'expected architectural difference', why: 'no candidates: current reports the confidence of an arbitrary zero-scoring scenario, vNext reports null' };
    }

    // vNext ranks only scored candidates, so zero-confidence runners-up are
    // absent. The decision is unaffected.
    if (diff.every((d) => d.field === 'alternatives')) {
        return { klass: 'expected architectural difference', why: 'vNext ranks only scored candidates; zero-confidence runners-up are absent by construction' };
    }

    // ── Ground truth, where it exists.
    if (expect && (expect.scenarioId || expect.action || expect.notAction || expect.noScenario)) {
        const ok = (o) => {
            if (expect.scenarioId && o.scenarioId !== expect.scenarioId) return false;
            if (expect.action && o.action !== expect.action) return false;
            if (expect.notAction && o.action === expect.notAction) return false;
            if (expect.noScenario && o.scenarioId) return false;
            return true;
        };
        const currentOk = ok(currentObs), vnextOk = ok(vnextObs);
        if (!currentOk && vnextOk) return { klass: 'correct improvement', why: 'vNext matches the known-correct outcome and current does not' };
        if (currentOk && !vnextOk) return { klass: 'correct regression', why: 'current matches the known-correct outcome and vNext does not' };
        if (currentOk && vnextOk) return { klass: 'expected architectural difference', why: 'both match the known-correct outcome; they differ elsewhere' };
        return { klass: 'unknown', why: 'neither matches the known-correct outcome' };
    }
    return { klass: 'unknown', why: 'no ground truth for this case — needs human review' };
}

// ------------------------------------------------------------

const differences = [];
const totals = { turns: 0, agreed: 0, differed: 0 };
const byCorpus = {};

function record(corpus, caseId, turnIndex, text, currentObs, vnextObs, expect, unsafeIf) {
    totals.turns += 1;
    byCorpus[corpus] = byCorpus[corpus] || { turns: 0, agreed: 0, differed: 0 };
    byCorpus[corpus].turns += 1;

    const diff = diffFields(currentObs, vnextObs);
    if (diff.length === 0) { totals.agreed += 1; byCorpus[corpus].agreed += 1; return null; }

    totals.differed += 1;
    byCorpus[corpus].differed += 1;
    const entry = {
        corpus, caseId, turnIndex, text: String(text).slice(0, 60).replace(/\n/g, '\\n'),
        diff, ...classify({ diff, expect, unsafeIf, currentObs, vnextObs })
    };
    differences.push(entry);
    return entry;
}

async function runCorpus(name, cases, settings = {}) {
    for (const c of cases) {
        const messages = c.turns.map((t) => t.text);
        const current = await runConversation({ messages, catalog: CATALOG, settings, variant: 'current', providers });
        const vnext = await runConversation({ messages, catalog: CATALOG, settings, variant: 'vnext', providers });
        for (let i = 0; i < messages.length; i++) {
            const entry = record(name, c.id, i, messages[i], observable(current[i]), observable(vnext[i]), c.turns[i].expect, c.unsafeIf);
            if (entry) entry.causes = await attribute(c.turns, i, settings);
        }
    }
}

console.log('SIE current vs vNext — comparator\n');
console.log(`catalog: ${CATALOG.length} scenarios · variants: ${Object.keys(VARIANTS).join(', ')}\n`);

await runCorpus('A production', PRODUCTION);
await runCorpus('B known', KNOWN);
await runCorpus('C adversarial', ADVERSARIAL_CONVERSATIONS);
await runCorpus('E regression', REGRESSION.map((r) => ({ id: r.id, turns: r.turns })));

// D — generated. Token-level, so it runs through the same pipeline by
// synthesising a message from the tokens' glossary phrases where possible;
// where no phrase exists the case is skipped rather than faked.
const generated = generateCases(CATALOG, { count: 300, seed: 7 });
const glossary = JSON.parse(fs.readFileSync(path.join(ROOT, 'sie/language/data/technical-glossary.json'), 'utf8'));
const phraseOf = new Map((glossary.entries || glossary).map((e) => [e.canonical, (e.patterns || [])[0]]));
let generatedSkipped = 0;
const generatedCases = [];
for (const g of generated) {
    const phrases = g.tokens.map((t) => phraseOf.get(t)).filter(Boolean);
    if (phrases.length === 0) { generatedSkipped += 1; continue; }
    generatedCases.push({ id: g.id, turns: [{ text: phrases.join(' و') }] });
}
await runCorpus('D generated', generatedCases);

// ------------------------------------------------------------

console.log('AGREEMENT');
console.log('corpus'.padEnd(16) + 'turns'.padEnd(8) + 'agreed'.padEnd(9) + 'differed'.padEnd(10) + 'agreement');
console.log('-'.repeat(56));
for (const [name, s] of Object.entries(byCorpus)) {
    console.log(name.padEnd(16) + String(s.turns).padEnd(8) + String(s.agreed).padEnd(9) + String(s.differed).padEnd(10)
        + `${(100 * s.agreed / s.turns).toFixed(1)}%`);
}
console.log('-'.repeat(56));
console.log('TOTAL'.padEnd(16) + String(totals.turns).padEnd(8) + String(totals.agreed).padEnd(9) + String(totals.differed).padEnd(10)
    + `${(100 * totals.agreed / totals.turns).toFixed(1)}%`);
if (generatedSkipped) console.log(`\n(${generatedSkipped} generated cases skipped: no glossary phrase exists for any of their tokens)`);

console.log('\n\nDIFFERENCES, CLASSIFIED — every one, not a sample');
const byClass = {};
for (const d of differences) byClass[d.klass] = (byClass[d.klass] || 0) + 1;
for (const [k, v] of Object.entries(byClass).sort((a, b) => b[1] - a[1])) console.log(`  ${String(v).padStart(4)}  ${k}`);

if (differences.length === 0) {
    console.log('\n  none — the variants agreed on every turn of every corpus.');
} else {
    console.log('\n');
    for (const d of differences) {
        console.log(`[${d.klass}] ${d.corpus} / ${d.caseId} turn ${d.turnIndex + 1}  causes=${(d.causes || []).join('+')}`);
        console.log(`    "${d.text}"`);
        console.log(`    ${d.why}`);
        for (const f of d.diff) console.log(`      ${f.field}: ${JSON.stringify(f.current)} -> ${JSON.stringify(f.vnext)}`);
    }
}

// Regression corpus verdict: current is known wrong; did vNext fix it?
console.log('\n\nE — REGRESSION: cases where CURRENT is known to be wrong');
for (const r of REGRESSION) {
    const messages = r.turns.map((t) => t.text);
    const vnext = await runConversation({ messages, catalog: CATALOG, variant: 'vnext', providers });
    const fixed = r.betterIf ? r.betterIf(vnext) : null;
    console.log(`  ${fixed === true ? 'FIXED  ' : fixed === false ? 'NOT FIXED' : 'n/a    '} ${r.id}`);
    console.log(`          ${r.why}`);
    if (r.note) console.log(`          note: ${r.note}`);
}

const regressions = differences.filter((d) => d.klass === 'correct regression' || d.klass === 'safety regression' || d.klass === 'false positive');
const unknowns = differences.filter((d) => d.klass === 'unknown');
const improvements = differences.filter((d) => d.klass === 'correct improvement' || d.klass === 'safety improvement');
console.log('\n');
console.log(`improvements: ${improvements.length}   regressions: ${regressions.length}   unknown (need review): ${unknowns.length}`);
process.exitCode = regressions.length > 0 ? 1 : 0;
