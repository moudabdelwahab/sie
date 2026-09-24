/**
 * check-phrasings.mjs — runs sie/editions/tests/fixtures/pack-phrasings.json
 * through its edition and prints every miss (the test asserts the same).
 *   node scripts/check-phrasings.mjs [pack]
 */
import fs from 'node:fs';
import { checkPhrasings } from '../sie/editions/tests/helpers/phrasings.js';
const pack = process.argv[2] || 'pro';
const { results, misses } = await checkPhrasings(pack);
for (const r of results.filter((x) => !x.ok)) console.log(`✗ ${r.expect} | ${r.text}\n    ${r.action} ${r.got}${r.ambiguous ? ' AMBIGUOUS' : ''} | ${r.top}`);
console.log(`${results.length - misses}/${results.length} phrasings land`);
process.exit(misses ? 1 : 0);
