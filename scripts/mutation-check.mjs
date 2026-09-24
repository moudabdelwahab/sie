/**
 * mutation-check.mjs — do the tests fail when what they guard is broken?
 *
 *   node scripts/mutation-check.mjs            # all mutations
 *   node scripts/mutation-check.mjs M3 M7      # some
 *
 * Each mutation breaks ONE guard with a one-line source change, runs the
 * tests that claim to protect it, and requires them to FAIL. The source is
 * restored in a finally block whatever happens. A mutation the tests do not
 * notice is a hole in the tests, reported as SURVIVED (exit 1).
 *
 * Slow (a minute or two): run before a release and whenever a guard or its
 * tests change. The fast complement is sie/editions/tests/audit-rules.test.mjs.
 *
 * @no-legitimate-corpus
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const T = (f) => `sie/editions/tests/${f}`;

export const MUTATIONS = [
    { id: 'M1', what: 'Free floor (pack stand-off) disabled',
      file: 'sie/editions/edition-turn.js',
      find: "    if (!top.some((e) => packIds.has(e.hypothesis?.scenarioId))) return unchanged;",
      replace: '    return unchanged;',
      tests: [T('edition-adversarial.test.mjs'), T('edition-floor.test.mjs')] },
    { id: 'M2', what: 'generic-word guard disabled',
      file: 'sie/editions/edition-turn.js',
      find: "    if (decision?.action === 'ANSWER' && packIds.has(decision.scenarioId) && genericTokens && genericTokens.size) {",
      replace: '    if (false) {',
      tests: [T('edition-floor.test.mjs')] },
    { id: 'M3', what: 'stand-off rule checks presence 1.0 only',
      file: 'sie/editions/stand-off.js',
      find: 'export const OBSERVED_PRESENCE_MIN = Math.min(...Object.values(BASE_WEIGHT_BY_SOURCE));',
      replace: 'export const OBSERVED_PRESENCE_MIN = 1;',
      tests: [T('stand-off.test.mjs'), T('audit-rules.test.mjs')] },
    { id: 'M4', what: 'content lint accepts everything',
      file: 'sie/editions/pack-guard.js',
      find: '    const reasons = [];\n    const t = String(text ?? \'\').replace(ICONS, \'\');',
      replace: '    return [];\n    const reasons = [];\n    const t = String(text ?? \'\').replace(ICONS, \'\');',
      tests: [T('pack-security.test.mjs'), 'sie/scenarios/tests/scenario-catalog-resolver.test.mjs'] },
    { id: 'M5', what: 'pack guard skips nothing',
      file: 'sie/editions/edition-catalog.js',
      find: '                    const why = checkPackScenario(sc);',
      replace: '                    const why = [];',
      tests: [T('pack-security.test.mjs')] },
    { id: 'M6', what: 'word-set audit rule removed',
      file: 'sie/editions/edition-audit.js',
      find: '                        if (!edRank.isAmbiguous) continue;',
      replace: '                        continue;',
      tests: [T('audit-rules.test.mjs')] },
    { id: 'M7', what: 'console allows Pro smaller than Free',
      file: 'sie/editions/edition-guards.js',
      find: '            if (n < floor) {',
      replace: '            if (false) {',
      tests: [T('edition-guards.test.mjs')] },
    { id: 'M8', what: 'edition message bound not applied in the pipeline',
      file: 'sie/pipeline/pipeline.js',
      find: "glossaryLayers: edition.glossaryLayers || [], maxInputChars: edition.profile.maxMessageChars }",
      replace: 'glossaryLayers: edition.glossaryLayers || [] }',
      tests: [T('edition-turn.test.mjs'), 'sie-integration/tests/editions-bridge.test.mjs'] },
    { id: 'M9', what: 'distinct-evidence-token bound not applied',
      file: 'sie/editions/edition-turn.js',
      find: '            if (kept.size >= max) { dropped += 1; continue; }',
      replace: '',
      tests: [T('edition-turn.test.mjs')] },
    { id: 'M10', what: 'a pack may replace a core scenario by id',
      file: 'sie/editions/edition-catalog.js',
      find: "                        if (seen.has(s.id)) { warnings.push(`Skipped ${name} scenario \"${s.id}\": id already defined by an earlier pack`); continue; }",
      replace: '',
      tests: [T('pack-security.test.mjs')] },
    { id: 'M11', what: 'a synonym may name a token the base does not have',
      file: 'sie/language/normalizer.js',
      find: '            if (isSynonym && !baseCanonicals.has(entry.canonical)) continue;',
      replace: '',
      tests: [T('pack-security.test.mjs')] },
    { id: 'M12', what: 'audit rule synonym_unknown_target removed',
      file: 'sie/editions/edition-audit.js',
      find: "            if (!baseCanonicals.has(e.canonical)) add('synonym_unknown_target', { pack: name, token: e.canonical });",
      replace: '',
      tests: [T('audit-rules.test.mjs')] },
    // Two edits: with only the first, resolved tokens are keyed on their
    // canonical («entity_agent»), which no pattern spells — an inert mutation.
    { id: 'M13', what: 'layers rewrite words the base already resolved',
      file: 'sie/language/normalizer.js',
      edits: [
          { find: '    const open = (t) => t && LAYER_OPEN_SOURCES.has(t.source) && !baseCanonicals.has(t.canonical);',
            replace: '    const open = (t) => !!t;' },
          { find: "                const words = window.map((t) => (t.source === 'unrecognized-latin' ? t.canonical : normalizeArabicToken(t.canonical))).filter(Boolean);",
            replace: "                const words = window.map((t) => (/[\\u0600-\\u06FF]/.test(t.raw) ? normalizeArabicToken(t.raw) : String(t.raw).toLowerCase())).filter(Boolean);" }
      ],
      tests: [T('layers-invariant.test.mjs')] }
];

function run(m) {
    const file = path.join(ROOT, m.file);
    const original = fs.readFileSync(file, 'utf8');
    const edits = m.edits || [{ find: m.find, replace: m.replace }];
    for (const e of edits) {
        const count = original.split(e.find).length - 1;
        if (count !== 1) return { ...m, verdict: 'STALE', detail: `anchor found ${count}× — update the mutation` };
    }
    const tests = m.tests.filter((t) => fs.existsSync(path.join(ROOT, t)));
    try {
        fs.writeFileSync(file, edits.reduce((src, e) => src.replace(e.find, () => e.replace), original));
        const r = spawnSync(process.execPath, ['--test', ...tests], { cwd: ROOT, encoding: 'utf8', timeout: 600000 });
        const failed = (r.stdout.match(/^# fail (\d+)/m) || [])[1];
        return { ...m, tests, verdict: r.status !== 0 ? 'KILLED' : 'SURVIVED', detail: `${failed ?? '?'} failing` };
    } finally {
        fs.writeFileSync(file, original);
    }
}

if (import.meta.url === `file://${process.argv[1]}`) {
    const pick = process.argv.slice(2);
    const rows = [];
    for (const m of MUTATIONS.filter((x) => !pick.length || pick.includes(x.id))) {
        const r = run(m);
        rows.push(r);
        console.log(`${r.verdict.padEnd(8)} ${r.id.padEnd(4)} ${r.what} — ${r.detail}${r.tests ? ` [${r.tests.map((t) => path.basename(t)).join(', ')}]` : ''}`);
    }
    process.exit(rows.some((r) => r.verdict !== 'KILLED') ? 1 : 0);
}
