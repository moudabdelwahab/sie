/**
 * edition-compare.mjs — Free vs Pro vs Max on the same messages.
 *
 * Every message of the behaviour corpus (bench/corpora/behavior.mjs, built
 * from the CORE catalog so `expect` is always a core scenario) runs through
 * each edition exactly as the bridge runs it. Differences are classified by
 * bench/behavior-snapshot.mjs diffSnapshots, so a regression on a core
 * message in a bigger edition is counted and listed, never averaged away.
 *
 *   node bench/edition-compare.mjs [--from free] [--to pro] [--list regressed_lost_correct,…] [--json out.json]
 *
 * @no-legitimate-corpus
 */
import fs from 'node:fs';
import { snapshotBehavior, diffSnapshots } from './behavior-snapshot.mjs';
import { buildBehaviorCorpus } from './corpora/behavior.mjs';
import { SIE_DEFAULT_SETTINGS } from '../sie/config/settings-schema.js';
import { nodeEdition, readCore, readBaseGlossary } from '../sie/editions/tests/helpers/node-editions.js';

function arg(name, fallback) {
    const i = process.argv.indexOf(`--${name}`);
    return i > 0 ? process.argv[i + 1] : fallback;
}

export async function snapshotEdition(edition, messages) {
    const ed = await nodeEdition(edition, SIE_DEFAULT_SETTINGS);
    return snapshotBehavior({
        messages,
        catalog: ed.scenarios,
        providers: { glossaryProvider: ed.providers.glossaryProvider, arabiziProvider: ed.providers.arabiziProvider },
        variant: 'retrieval_only',
        edition: { profile: ed.profile, glossaryLayers: ed.glossaryLayers, packIds: ed.packIds, genericTokens: ed.genericTokens }
    });
}

export function summarize(rows) {
    const probes = rows.filter((r) => r.expect);
    const pct = (n, d) => (d ? Math.round((n / d) * 1000) / 10 : 0);
    const ms = rows.map((r) => r.ms).sort((a, b) => a - b);
    const q = (p) => ms[Math.min(ms.length - 1, Math.floor(p * ms.length))];
    return {
        messages: rows.length,
        answeredCorrect: pct(probes.filter((r) => r.scenarioId === r.expect && r.action === 'ANSWER').length, probes.length),
        targetedCorrect: pct(probes.filter((r) => r.scenarioId === r.expect).length, probes.length),
        ambiguous: rows.filter((r) => r.ambiguous).length,
        answers: rows.filter((r) => r.action === 'ANSWER').length,
        tickets: rows.filter((r) => r.action === 'CREATE_TICKET').length,
        fallbacks: rows.filter((r) => r.action === 'FALLBACK').length,
        latencyMs: { p50: q(0.5), p95: q(0.95), p99: q(0.99) }
    };
}

if (import.meta.url === `file://${process.argv[1]}`) {
    const from = arg('from', 'free');
    const to = arg('to', 'pro');
    const messages = buildBehaviorCorpus({ catalog: readCore(), glossary: readBaseGlossary() });
    const a = await snapshotEdition(from, messages);
    const b = await snapshotEdition(to, messages);
    const d = diffSnapshots(a, b);
    console.log(JSON.stringify({ [from]: summarize(a), [to]: summarize(b), changes: d.counts }, null, 2));
    const list = (arg('list', 'regressed_lost_correct,ambiguity_introduced,stopped_answering,interpretation_changed') || '').split(',');
    for (const c of d.changed.filter((x) => list.includes(x.category))) {
        const m = messages.find((x) => x.id === c.id);
        console.log(`${c.category} | ${m.stratum} | ${m.text.slice(0, 70)} | ${c.before.action} ${c.before.scenarioId} => ${c.after.action} ${c.after.scenarioId} ${c.after.ambiguous ? 'AMB' : ''} [${c.after.top.join(' ')}]`);
    }
    const out = arg('json', null);
    if (out) fs.writeFileSync(out, JSON.stringify({ from, to, a, b, diff: d }));
}
