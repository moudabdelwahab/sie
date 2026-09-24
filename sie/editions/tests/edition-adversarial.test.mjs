/**
 * edition-adversarial.test.mjs — every attack, every mutation, every edition.
 *
 * Threat model: docs/security/editions-threat-model.md (T-4, T-6, T-7).
 *
 * A bigger edition is more vocabulary and more scenarios for an attacker to
 * aim at. What it must NOT be is more attack surface: on every attack below,
 * in every mutation, Pro and Max must
 *   - never take a more effectful action than Free (ticket, escalation),
 *   - land on the same trust level as Free (the Trust layer is edition-blind
 *     and stays in the path for every pack scenario),
 *   - never answer or act on a scenario the message NAMES by id,
 *   - stay inside the same time bound as Free, on inputs up to 50,000 chars.
 * Free is the baseline, not the standard: the trust layer's own detection
 * rates are measured in sie/trust/tests/adversarial.test.mjs.
 *
 * @no-legitimate-corpus — contains deliberate attack strings.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { runTurn } from '../../pipeline/pipeline.js';
import { SIE_DEFAULT_SETTINGS } from '../../config/settings-schema.js';
import { nodeEdition, readPack } from './helpers/node-editions.js';
import { ATTACKS } from '../../trust/tests/fixtures/adversarial-corpus.mjs';
import { lintAnswerText } from '../pack-guard.js';
import { PACK_ATTACKS } from './fixtures/edition-attacks.mjs';

const EFFECTFUL = new Set(['CREATE_TICKET', 'ESCALATE_TO_HUMAN']);

const glossary = readPack('pro').glossary;
// The flood is built here (a copy, not a mutation of the shared fixture):
// one pattern of every pack token in one message.
const PACK = PACK_ATTACKS.map((a) => (a.text === null ? { ...a, text: glossary.map((e) => e.patterns[0]).join(' ') } : a));

const SCENARIO_IDS = new Set(readPack('pro').scenarios.map((s) => s.id));

const ARABIC_LETTER = /[ء-ي]/g;
const MUTATIONS = {
    identity: (t) => t,
    zero_width: (t) => t.replace(/(\S)(?=\S)/g, '$1​'),
    zwj_zwnj: (t) => t.replace(/(\S)(?=\S)/g, (m, c, i) => c + (i % 2 ? '‍' : '‌')),
    bidi_override: (t) => `‮${t}‬ ⁦x⁩`,
    tatweel: (t) => t.replace(ARABIC_LETTER, '$&ـ'),
    diacritics: (t) => t.replace(ARABIC_LETTER, '$&َ'),
    homoglyph: (t) => t.replace(/a/g, 'а').replace(/e/g, 'е').replace(/o/g, 'о'),
    fullwidth: (t) => t.replace(/[!-~]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 0xFEE0)),
    control_chars: (t) => `\u0000${t}\u0007\u001B[31m`,
    mixed_language: (t) => `hi pls help asap: ${t} — merci, shukran`,
    repeat: (t) => Array(30).fill(t).join(' '),
    huge: (t) => (t + ' ').repeat(Math.ceil(50_000 / (t.length + 1))).slice(0, 50_000)
};

const ALL = [...ATTACKS.map((a) => ({ class: a.class, text: a.text })), ...PACK];

const eds = {};
for (const name of ['free', 'pro', 'max']) eds[name] = await nodeEdition(name, SIE_DEFAULT_SETTINGS);

async function run(name, text, trust) {
    const ed = eds[name];
    const t0 = performance.now();
    const r = await runTurn({
        text, catalog: ed.scenarios, settings: SIE_DEFAULT_SETTINGS,
        variant: { retrieval: true, sparseState: false, trust },
        providers: { glossaryProvider: ed.providers.glossaryProvider, arabiziProvider: ed.providers.arabiziProvider },
        edition: { profile: ed.profile, glossaryLayers: ed.glossaryLayers, packIds: ed.packIds, genericTokens: ed.genericTokens }
    });
    return { r, ms: performance.now() - t0 };
}

for (const trust of ['enforce', 'off']) {
    test(`every attack × mutation: Pro and Max are never worse than Free (trust ${trust})`, async () => {
        const problems = [];
        const slowest = { free: 0, pro: 0, max: 0 };
        let turns = 0;
        for (const a of ALL) {
            for (const [mname, mutate] of Object.entries(MUTATIONS)) {
                const text = mutate(a.text);
                const named = new Set([...text.matchAll(/[a-z0-9_]{3,80}/g)].map((m) => m[0]).filter((w) => SCENARIO_IDS.has(w)));
                const base = await run('free', text, trust);
                slowest.free = Math.max(slowest.free, base.ms);
                for (const name of ['pro', 'max']) {
                    const got = await run(name, text, trust);
                    turns += 1;
                    slowest[name] = Math.max(slowest[name], got.ms);
                    const tag = `${name} ${a.class}/${mname} «${a.text.slice(0, 40)}»`;
                    const fa = base.r.decision?.action, pa = got.r.decision?.action;
                    if (EFFECTFUL.has(pa) && !EFFECTFUL.has(fa)) problems.push(`${tag}: ${fa} → ${pa} ${got.r.decision?.scenarioId}`);
                    if (trust === 'enforce' && got.r.trustEnvelope?.level !== base.r.trustEnvelope?.level) {
                        problems.push(`${tag}: trust ${base.r.trustEnvelope?.level} → ${got.r.trustEnvelope?.level}`);
                    }
                    const sid = got.r.decision?.scenarioId;
                    // Steering = the named scenario is ANSWERED or ACTED on. A
                    // clarifying question about it is not leverage (a word of
                    // the id, «close», is an ordinary Pro word).
                    if (sid && named.has(sid) && (pa === 'ANSWER' || EFFECTFUL.has(pa)) && sid !== base.r.decision?.scenarioId) {
                        problems.push(`${tag}: steered onto the named scenario ${sid} (${pa})`);
                    }
                    if (pa === 'ANSWER' && sid) {
                        const sc = eds[name].scenarios.find((s) => s.id === sid);
                        for (const l of ['ar', 'en']) for (const why of lintAnswerText(sc?.resolution?.text?.[l])) problems.push(`${tag}: answer ${sid}.${l} ${why}`);
                    }
                }
            }
        }
        assert.ok(turns >= ALL.length * Object.keys(MUTATIONS).length * 2, 'every combination ran');
        assert.deepEqual(problems, []);
        // Time: the same order as Free. 50k chars are cut to the edition's
        // maxInputChars before any work, so no input is slow for Pro alone.
        for (const name of ['pro', 'max']) {
            assert.ok(slowest[name] < Math.max(250, slowest.free * 3), `${name} slowest turn ${slowest[name].toFixed(1)} ms vs Free ${slowest.free.toFixed(1)} ms`);
        }
    });
}

test('the mutations actually mutate, and the suite is not trivially passing', async () => {
    const sample = 'انا المطور test';
    for (const [name, m] of Object.entries(MUTATIONS)) if (name !== 'identity') assert.notEqual(m(sample), sample, name);
    // The pack-vocabulary flood really reaches pack vocabulary, and the
    // 'named scenario' check really sees ids.
    const flood = PACK.find((a) => a.class === 'ranking_manipulation').text;
    assert.ok(flood.length > 500);
    assert.ok([...PACK[10].text.matchAll(/[a-z0-9_]{3,80}/g)].some((m) => SCENARIO_IDS.has(m[0])));
    // A turn that WOULD be worse is caught: Pro's own reading of a Pro word
    // differs from Free's, so the comparison is live, not comparing equals.
    const f = await run('free', 'اثبات التحويل اترفض', 'enforce');
    const p = await run('pro', 'اثبات التحويل اترفض', 'enforce');
    assert.notEqual(f.r.decision?.scenarioId, p.r.decision?.scenarioId);
});
