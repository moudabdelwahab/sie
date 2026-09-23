/**
 * build-packs.mjs
 * ------------------------------------------------------------
 * Compiles sie/scenarios/packs/src/<pack>/*.mjs into the two runtime files
 * per pack:
 *
 *   sie/scenarios/scenario-catalog.data/pack-<pack>.json   { pack, scenarios }
 *   sie/language/data/glossary-pack-<pack>.json            { pack, entries }
 *
 * Source files are read in name order, and within a file in written order,
 * which is the order the edition assembler truncates from the end of — so
 * files are numbered most-valuable-first.
 *
 *   node scripts/build-packs.mjs            write
 *   node scripts/build-packs.mjs --check    exit 1 if any output is stale
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'sie/scenarios/packs/src');

export async function compilePack(pack) {
    const dir = path.join(SRC, pack);
    const files = fs.readdirSync(dir).filter((f) => f.endsWith('.mjs')).sort();
    const scenarios = [];
    const entries = [];
    for (const file of files) {
        const mod = await import(pathToFileURL(path.join(dir, file)).href);
        const { tokens = [], scenarios: list = [] } = mod.default || {};
        for (const t of tokens) entries.push({ ...t, source: `${pack}/${file}` });
        for (const s of list) scenarios.push(s);
    }
    return {
        catalog: { pack, scenarios },
        glossary: { pack, entries: entries.map(({ source, ...e }) => e) }
    };
}

export function packOutputs(pack) {
    return {
        catalog: path.join(ROOT, `sie/scenarios/scenario-catalog.data/pack-${pack}.json`),
        glossary: path.join(ROOT, `sie/language/data/glossary-pack-${pack}.json`)
    };
}

const serialize = (x) => JSON.stringify(x, null, 2) + '\n';

async function main() {
    const check = process.argv.includes('--check');
    const packs = fs.readdirSync(SRC, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort();
    let stale = 0;
    for (const pack of packs) {
        const { catalog, glossary } = await compilePack(pack);
        const out = packOutputs(pack);
        for (const [file, data] of [[out.catalog, catalog], [out.glossary, glossary]]) {
            const text = serialize(data);
            const current = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null;
            if (current === text) continue;
            if (check) { console.error(`stale: ${path.relative(ROOT, file)}`); stale += 1; }
            else fs.writeFileSync(file, text);
        }
        console.log(`${pack}: ${catalog.scenarios.length} scenarios, ${glossary.entries.length} tokens`);
    }
    if (stale) process.exit(1);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
