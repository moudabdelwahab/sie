/**
 * audit-editions.mjs — the edition audit as a readable report.
 *   node scripts/audit-editions.mjs            summary + every finding
 *   node scripts/audit-editions.mjs --json     machine-readable
 * The same checks gate CI in sie/scenarios/tests/catalog-uniqueness.test.mjs.
 */
import fs from 'node:fs';
import { auditEditions } from '../sie/editions/edition-audit.js';
import { readCore, readBaseGlossary, readPack, PACK_NAMES } from '../sie/editions/tests/helpers/node-editions.js';
import { createRealArabiziProvider } from '../sie/language/tests/helpers/node-providers.js';

const reviewedPath = new URL('../sie/scenarios/tests/fixtures/reviewed-pairs.json', import.meta.url);
const reviewed = fs.existsSync(reviewedPath) ? JSON.parse(fs.readFileSync(reviewedPath, 'utf8')).pairs : {};
const packs = Object.fromEntries(PACK_NAMES.map((n) => [n, readPack(n)]));
const t0 = Date.now();
const { findings, stats } = await auditEditions({
    core: readCore(), baseGlossary: readBaseGlossary(), packs,
    providers: { arabiziProvider: createRealArabiziProvider() }, reviewed
});
if (process.argv.includes('--json')) { console.log(JSON.stringify({ stats, findings }, null, 2)); process.exit(0); }
console.log(JSON.stringify(stats));
const byKind = {};
for (const f of findings) (byKind[f.kind] ||= []).push(f);
for (const [kind, list] of Object.entries(byKind)) {
    console.log(`\n## ${kind} (${list.length})`);
    for (const f of list.slice(0, Number(process.env.LIMIT || 60))) { const { kind: _, ...rest } = f; console.log('  ' + JSON.stringify(rest)); }
}
console.log(`\n${findings.length} findings in ${Date.now() - t0} ms`);
