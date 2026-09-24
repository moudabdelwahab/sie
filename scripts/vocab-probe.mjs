/**
 * vocab-probe.mjs — what the glossary makes of candidate phrases.
 *   node scripts/vocab-probe.mjs "phrase one" "phrase two" …
 *   node scripts/vocab-probe.mjs --layers pro "phrase"      also apply pack layers (pro, or pro,max)
 * Prints each word's canonical; words shown in [brackets] are OPEN — the only
 * words a pack glossary layer can claim (see normalizer applyGlossaryLayers).
 * With --layers, layer tokens are shown as {token}.
 */
import { normalize } from '../sie/language/normalizer.js';
import { createRealGlossaryProvider, createRealArabiziProvider } from '../sie/language/tests/helpers/node-providers.js';
import { readPack } from '../sie/editions/tests/helpers/node-editions.js';

const args = process.argv.slice(2);
let layers = [];
const li = args.indexOf('--layers');
if (li >= 0) {
    layers = args[li + 1].split(',').map((n) => readPack(n).glossary);
    args.splice(li, 2);
}
const g = createRealGlossaryProvider();
const base = new Set((await g.getEntries()).map((e) => e.canonical));
const layerTokens = new Set(layers.flat().map((e) => e.canonical));
const opts = { glossaryProvider: g, arabiziProvider: createRealArabiziProvider(), glossaryLayers: layers };
for (const phrase of args) {
    const out = await normalize(phrase, opts);
    const show = (t) => (layerTokens.has(t.canonical) ? `{${t.canonical}}` : base.has(t.canonical) ? t.canonical : `[${t.canonical}]`);
    console.log(`${phrase}  =>  ${out.normalizedTokens.map(show).join(' ')}`);
}
