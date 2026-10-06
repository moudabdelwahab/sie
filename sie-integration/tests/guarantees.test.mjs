/**
 * guarantees.test.mjs — the guarantee registry is true.
 * ------------------------------------------------------------
 * docs/SIE-GUARANTEES.md lists every behavioural guarantee and every P0 with
 * a status. This test makes "every important guarantee is explicitly tested"
 * something CI checks rather than something a document claims:
 *
 *   - no test references an unregistered id;
 *   - an enforced guarantee has passing evidence (a tagged test, a green
 *     golden run, or an existing test file named in the registry);
 *   - a pending guarantee names the work package that will enforce it;
 *   - every open P0 is pinned by a red regression that really exists, and a
 *     closed P0 has a green golden run in every golden-backed category it
 *     requires.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadGoldens } from './helpers/golden-runner.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const REGISTRY = fs.readFileSync(path.join(ROOT, 'docs/SIE-GUARANTEES.md'), 'utf8');

const cells = (line) => line.split('|').slice(1, -1).map((c) => c.trim());

const guarantees = new Map(
    REGISTRY.split('\n').filter((l) => /^\| (G|T)-/.test(l)).map((l) => {
        const [id, layer, statement, status, wp, evidence] = cells(l);
        return [id, { id, layer, statement, status, wp, evidence }];
    })
);
const p0s = new Map(
    REGISTRY.split('\n').filter((l) => /^\| P0-\d+ \|/.test(l)).map((l) => {
        const [id, issue, categories, status, wp, red] = cells(l);
        return [id, { id, issue, categories: categories.split(',').map((s) => s.trim()), status, wp, red }];
    })
);

/** Every *.test.mjs file the suite runs, as [relativePath, source]. */
function testSources() {
    const out = [];
    const walk = (dir) => {
        for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
            if (e.name === 'node_modules' || e.name === '.git') continue;
            const p = path.join(dir, e.name);
            if (e.isDirectory()) walk(p);
            else if (e.name.endsWith('.test.mjs')) out.push([path.relative(ROOT, p), fs.readFileSync(p, 'utf8')]);
        }
    };
    walk(ROOT);
    return out;
}

const TAG = /\[(pending:)?((?:G|T)-[A-Z0-9]+(?:-[0-9]+)?)\]/g;
const tagged = new Map(); // id -> {proving: files[], pending: files[]}
for (const [file, src] of testSources()) {
    if (file.endsWith('guarantees.test.mjs')) continue;
    for (const m of src.matchAll(TAG)) {
        const entry = tagged.get(m[2]) || { proving: new Set(), pending: new Set() };
        (m[1] ? entry.pending : entry.proving).add(file);
        tagged.set(m[2], entry);
    }
}
const GOLDENS = loadGoldens();
const goldenRefs = new Map(); // id -> {green: n, red: n}
for (const g of GOLDENS) {
    for (const id of g.guarantees || []) {
        const r = goldenRefs.get(id) || { green: 0, red: 0 };
        for (const run of g.runs) r[run.status]++;
        goldenRefs.set(id, r);
    }
}

test('the registry parses and is non-trivial', () => {
    assert.ok(guarantees.size >= 60, `only ${guarantees.size} guarantees parsed`);
    for (let n = 1; n <= 17; n++) assert.ok(p0s.has(`P0-${n}`), `P0-${n} missing from the registry`);
});

test('every guarantee row has a valid status, and pending ones name their work package', () => {
    for (const g of guarantees.values()) {
        assert.ok(['enforced', 'pending'].includes(g.status), `${g.id}: status "${g.status}"`);
        if (g.status === 'pending') assert.match(g.wp, /^WP[2-9]$/, `${g.id}: pending without a work package`);
        assert.ok(g.statement.length > 20, `${g.id}: statement too short`);
    }
});

test('no test or golden conversation references an unregistered guarantee', () => {
    const unknown = [...new Set([...tagged.keys(), ...goldenRefs.keys()])].filter((id) => !guarantees.has(id));
    assert.deepEqual(unknown, []);
});

test('every enforced guarantee has passing evidence', () => {
    const missing = [];
    for (const g of guarantees.values()) {
        if (g.status !== 'enforced') continue;
        const proving = tagged.get(g.id)?.proving.size || 0;
        const green = goldenRefs.get(g.id)?.green || 0;
        const files = [...g.evidence.matchAll(/`([^`]+\.test\.mjs)`/g)].map((m) => m[1]);
        for (const f of files) assert.ok(fs.existsSync(path.join(ROOT, f)), `${g.id}: evidence file ${f} does not exist`);
        if (proving + green + files.length === 0) missing.push(g.id);
        if (g.evidence === 'tagged') assert.ok(proving + green > 0, `${g.id}: marked "tagged" but no test carries [${g.id}]`);
    }
    assert.deepEqual(missing, [], 'enforced guarantees without evidence');
});

test('a guarantee pinned only as a violation ([pending:ID]) is not marked enforced', () => {
    for (const [id, refs] of tagged) {
        if (refs.pending.size && !refs.proving.size) {
            assert.equal(guarantees.get(id)?.status, 'pending', `${id} is only pinned as a violation but registered as enforced`);
        }
    }
});

test('every open P0 is pinned by a red regression that exists; closed P0s are green in every golden-backed category', () => {
    const byId = new Map(GOLDENS.map((g) => [g.id, g]));
    const goldenCats = new Set(['E2E', 'MT', 'MS', 'PS', 'ADV']);
    for (const p of p0s.values()) {
        const n = Number(p.id.slice(3));
        const refs = p.red.split(',').map((s) => s.trim()).filter((s) => s && s !== '—' && !s.startsWith('— ('));
        if (p.status.startsWith('closed')) {
            for (const cat of p.categories.filter((c) => goldenCats.has(c))) {
                const ok = GOLDENS.some((g) => (g.p0 || []).includes(n) && (g.categories || []).includes(cat) && g.runs.some((r) => r.status === 'green' && r.profile.startsWith('production')));
                assert.ok(ok, `${p.id} is closed but has no green production-profile golden run in category ${cat}`);
            }
            continue;
        }
        if (n === 16) continue; // the test infrastructure itself; evidenced by T-1 and T-4
        assert.ok(refs.length > 0, `${p.id} is open but names no red regression`);
        for (const ref of refs) {
            if (ref.endsWith('.test.mjs')) {
                assert.ok(fs.existsSync(path.join(ROOT, 'sie-integration/tests', ref)), `${p.id}: ${ref} missing`);
                continue;
            }
            const g = byId.get(ref);
            assert.ok(g, `${p.id}: golden ${ref} does not exist`);
            assert.ok((g.p0 || []).includes(n), `${p.id}: golden ${ref} is not tagged with P0-${n}`);
            assert.ok(g.runs.some((r) => r.status === 'red'), `${p.id}: golden ${ref} has no red run — if the defect is fixed, close the P0`);
        }
    }
});

test('every golden conversation that names a P0 points at a registered P0', () => {
    for (const g of GOLDENS) for (const n of g.p0 || []) assert.ok(p0s.has(`P0-${n}`), `${g.id}: P0-${n} not registered`);
});
