/**
 * vocab-probe.mjs — what the BASE glossary makes of candidate phrases.
 *   node scripts/vocab-probe.mjs "phrase one" "phrase two" …
 * Prints each word's canonical; words shown in [brackets] are OPEN — the only
 * words a pack glossary layer can claim (see normalizer applyGlossaryLayers).
 */
import { normalize } from '../sie/language/normalizer.js';
import { createRealGlossaryProvider, createRealArabiziProvider } from '../sie/language/tests/helpers/node-providers.js';
const g = createRealGlossaryProvider();
const base = new Set((await g.getEntries()).map((e) => e.canonical));
const opts = { glossaryProvider: g, arabiziProvider: createRealArabiziProvider() };
for (const phrase of process.argv.slice(2)) {
    const out = await normalize(phrase, opts);
    console.log(`${phrase}  =>  ${out.normalizedTokens.map((t) => (base.has(t.canonical) ? t.canonical : `[${t.canonical}]`)).join(' ')}`);
}
