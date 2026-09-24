/**
 * edition-probe.mjs — what an edition decides for natural phrasings.
 *   node scripts/edition-probe.mjs [--edition pro] "message" …
 *   node scripts/edition-probe.mjs --expect id "message" …    exit 1 on a miss
 * Prints action, scenario, ambiguity and the top three for each message,
 * running the same pipeline the bridge runs for that edition.
 */
import { runTurn } from '../sie/pipeline/pipeline.js';
import { SIE_DEFAULT_SETTINGS } from '../sie/config/settings-schema.js';
import { nodeEdition } from '../sie/editions/tests/helpers/node-editions.js';

const args = process.argv.slice(2);
const take = (flag, fallback) => { const i = args.indexOf(flag); if (i < 0) return fallback; const v = args[i + 1]; args.splice(i, 2); return v; };
const edition = take('--edition', 'pro');
const ed = await nodeEdition(edition, SIE_DEFAULT_SETTINGS);
const providers = { glossaryProvider: ed.providers.glossaryProvider, arabiziProvider: ed.providers.arabiziProvider };
let misses = 0;
const pairs = [];
for (let i = 0; i < args.length; i++) {
    if (args[i] === '--expect') { pairs.push([args[i + 1], args[i + 2]]); i += 2; } else pairs.push([null, args[i]]);
}
for (const [expect, text] of pairs) {
    const r = await runTurn({ text, catalog: ed.scenarios, settings: SIE_DEFAULT_SETTINGS, variant: 'retrieval_only', providers, edition: { profile: ed.profile, glossaryLayers: ed.glossaryLayers, packIds: ed.packIds, genericTokens: ed.genericTokens } });
    const top = r.ranking ? r.ranking.ranked.filter((e) => e.hypothesis.confidence > 0).slice(0, 3).map((e) => `${e.hypothesis.scenarioId}(${e.hypothesis.confidence.toFixed(2)})`).join(' ') : '';
    const got = r.decision?.scenarioId ?? null;
    const ok = expect ? got === expect && r.decision?.action === 'ANSWER' : null;
    if (ok === false) misses += 1;
    console.log(`${ok === null ? ' ' : ok ? '✓' : '✗'} ${text}\n    ${r.interpretation?.kind} ${r.decision?.action ?? '-'} ${got ?? '-'}${r.ranking?.isAmbiguous ? ' AMBIGUOUS' : ''} | ${top}`);
}
process.exit(misses ? 1 : 0);
