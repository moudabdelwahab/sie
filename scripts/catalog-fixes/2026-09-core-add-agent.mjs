/**
 * 2026-09-core-add-agent.mjs
 * ------------------------------------------------------------
 * «إزاي أضيف موظف» — the label of the core scenario howto_add_agent — did not
 * reach it. The Egyptian development probe (report §18) found it:
 *
 *   • «ازاي اضيف» is a phrase pattern of intent_add, so the «ازاي» that
 *     howto_add_agent keys on (intent_how_to) is consumed by the phrase and
 *     the scenario scores entity_agent alone (0.40).
 *   • «موظف» / «موظفين» (singular, no article) were open in the base: only
 *     «الموظف» / «الموظفين» were entity_agent. So Free saw intent_add alone and
 *     opened an ambiguous ticket between reports, departments and WhatsApp
 *     numbers; «ازاي اضيف الموظفين» answered team_department_setup.
 *
 * Same discipline as 2026-09-core-standoffs.mjs: named, re-runnable (applied
 * twice changes nothing), measured on a FROZEN behaviour corpus before and
 * after (bench/results/core-add-agent-*.txt). No scenario is added and no
 * answer text changes.
 *
 * The alternative has two tokens at EQUAL weight, deliberately. The lesson
 * of the stand-offs was that with two tokens one alone carries ≥ half the
 * weight; at 1:1 each alone scores 0.50 here — below what intent_add alone
 * already scores on its three existing scenarios (0.67), and entity_agent
 * alone already scored 0.40 on the primary signature — so a bare «عايز اضيف»
 * or a bare «الموظف» keeps its old leader (measured: frozen corpus).
 *
 * @no-legitimate-corpus
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const CATALOG = path.join(ROOT, 'sie/scenarios/scenario-catalog.data/scenarios.json');
const GLOSSARY = path.join(ROOT, 'sie/language/data/technical-glossary.json');

const catalogFile = JSON.parse(fs.readFileSync(CATALOG, 'utf8'));
const glossaryFile = JSON.parse(fs.readFileSync(GLOSSARY, 'utf8'));
const byId = new Map(catalogFile.scenarios.map((s) => [s.id, s]));
const log = [];

const sig = (pairs) => pairs.map(([token, weight]) => ({ token, weight, source: 'text' }));
const sameSig = (a, b) => JSON.stringify(a) === JSON.stringify(b);

function addAlternative(id, pairs, why) {
    const s = byId.get(id);
    if (!s) throw new Error(`no scenario ${id}`);
    const alt = sig(pairs);
    s.alternativeSignatures = s.alternativeSignatures || [];
    if (s.alternativeSignatures.some((a) => sameSig(a, alt))) return;
    s.alternativeSignatures.push(alt);
    log.push(`alt ${id}: ${pairs.map(([t, w]) => `${t}:${w}`).join(' ')} — ${why}`);
}

function addPatterns(canonical, patterns, why) {
    const e = glossaryFile.entries.find((x) => x.canonical === canonical);
    if (!e) throw new Error(`no glossary token ${canonical}`);
    const added = patterns.filter((p) => !e.patterns.includes(p));
    if (!added.length) return;
    e.patterns.push(...added);
    log.push(`glossary ${canonical}: +${added.join(' | ')} — ${why}`);
}

addPatterns('entity_agent', ['موظف جديد', 'موظفين جداد', 'موظفين جدد', 'موظفه جديده', 'موظفة جديدة', 'اضافه موظف', 'اضافة موظف'],
    '"a new employee" / "adding an employee" — not bare «موظف» (measured: see header)');

addAlternative('howto_add_agent', [['intent_add', 1], ['entity_agent', 1]],
    '«ازاي اضيف موظف» — the phrase «ازاي اضيف» is intent_add, so intent_how_to never forms');

if (log.length) {
    fs.writeFileSync(CATALOG, JSON.stringify(catalogFile, null, 2) + '\n');
    fs.writeFileSync(GLOSSARY, JSON.stringify(glossaryFile, null, 2) + '\n');
}
console.log(log.length ? log.join('\n') : 'already applied — nothing to do');
