/**
 * check-vocab-heldout.mjs — how many frozen held-out messages each edition
 * lands on the expected scenario (decision names it, unambiguously).
 *   node scripts/check-vocab-heldout.mjs [--list]
 * The set (sie/editions/tests/fixtures/vocabulary-heldout.json) was committed
 * before any synonym entry and is never tuned against.
 * @no-legitimate-corpus
 */
import fs from 'node:fs';
import { runTurn } from '../sie/pipeline/pipeline.js';
import { SIE_DEFAULT_SETTINGS } from '../sie/config/settings-schema.js';
import { nodeEdition } from '../sie/editions/tests/helpers/node-editions.js';

export async function vocabHeldout(editionName, set = 'vocabulary-heldout') {
    const { rows } = JSON.parse(fs.readFileSync(new URL(`../sie/editions/tests/fixtures/${set}.json`, import.meta.url), 'utf8'));
    const ed = await nodeEdition(editionName, SIE_DEFAULT_SETTINGS);
    const results = [];
    for (const [expect, text] of rows) {
        const r = await runTurn({ text, catalog: ed.scenarios, settings: SIE_DEFAULT_SETTINGS, variant: 'retrieval_only',
            providers: { glossaryProvider: ed.providers.glossaryProvider, arabiziProvider: ed.providers.arabiziProvider }, edition: ed });
        const got = r.decision?.scenarioId ?? null;
        results.push({ expect, text, got, action: r.decision?.action ?? null, kind: r.interpretation?.kind, ok: got === expect && !r.ranking?.isAmbiguous });
    }
    return { results, landed: results.filter((r) => r.ok).length };
}

if (import.meta.url === `file://${process.argv[1]}`) {
    for (const set of ['vocabulary-heldout', 'vocabulary-heldout-egyptian']) {
        for (const e of ['free', 'pro', 'max']) {
            const { results, landed } = await vocabHeldout(e, set);
            console.log(`${set} ${e}: ${landed}/${results.length}`);
            if (process.argv.includes('--list') && e === 'max') for (const r of results.filter((x) => !x.ok)) console.log(`   ✗ ${r.expect} «${r.text}» → ${r.kind}/${r.action}/${r.got}`);
        }
    }
}
