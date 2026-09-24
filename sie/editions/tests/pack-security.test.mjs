/**
 * pack-security.test.mjs — what a bigger edition may NOT do.
 *
 * Threat model: docs/security/editions-threat-model.md. Each test names the
 * threat (T-n) it closes.
 *
 * @no-legitimate-corpus — contains deliberate attack strings.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createEditionCatalogs } from '../edition-catalog.js';
import { lintAnswerText, checkPackScenario, checkPackGlossaryEntry, PACK_LIMITS } from '../pack-guard.js';
import { resolveEditionProfile } from '../editions.js';
import { readCore, readPack, nodeEdition, PACK_NAMES } from './helpers/node-editions.js';
import { normalize } from '../../language/normalizer.js';
import { createRealGlossaryProvider, createRealArabiziProvider } from '../../language/tests/helpers/node-providers.js';
import { runTurn } from '../../pipeline/pipeline.js';
import { SIE_DEFAULT_SETTINGS } from '../../config/settings-schema.js';
import { ATTACKS } from '../../trust/tests/fixtures/adversarial-corpus.mjs';

const core = readCore();

// ── T-1 supply chain: authored content speaks in the brand's voice ──────

test('T-1: every shipped answer (core and packs) passes the content lint', () => {
    const offenders = [];
    for (const s of core) for (const l of ['ar', 'en']) {
        const t = s.resolution?.text?.[l];
        if (t) for (const why of lintAnswerText(t)) offenders.push(`core ${s.id}.${l}: ${why}`);
    }
    for (const name of PACK_NAMES) {
        for (const s of readPack(name).scenarios) for (const why of checkPackScenario(s)) offenders.push(`${name} ${s.id}: ${why}`);
        for (const e of readPack(name).glossary) for (const why of checkPackGlossaryEntry(e)) offenders.push(`${name} glossary ${e.canonical}: ${why}`);
    }
    assert.deepEqual(offenders, []);
});

test('T-1: the lint catches the attacks it exists for, and not the safe advice', () => {
    for (const bad of [
        'اضغط [هنا](https://evil.example/login)', '<script>alert(1)</script>', '<a href="x">اضغط</a>',
        'ادخل على https://mad3oom-support.help/reset', 'حوّل على evil.xyz/pay',
        'ابعتلي كلمة المرور بتاعتك', 'قولي رمز التحقق اللي وصلك', 'send me your password',
        'الحد بيتحسب في sie_consume_message', 'اتأكد من SUPABASE_SERVICE_KEY', 'شوف supabase/functions/sie-api/index.ts'
    ]) assert.ok(lintAnswerText(bad).length > 0, `not caught: ${bad}`);
    for (const ok of [
        'ماتبعتش كلمة المرور لحد، ولا في التذكرة.', 'افتح https://mad3oom.com/tickets', 'Authorization: Bearer <token>',
        'قولي الكود وأنا أراجعه', 'support@mad3oom.com', 'Authorization: Bearer <api_key>.<secret>', 'مثال: My_Store'
    ]) assert.deepEqual(lintAnswerText(ok), [], `false positive: ${ok}`);
});

// ── T-2 a tampered or malformed pack file at runtime ────────────────────

const coreVictim = core[0];
const MALICIOUS = {
    genericTokens: ['entity_ok', 'Bad Token!', 42, null],
    scenarios: [
        { ...coreVictim, resolution: { hasAutoResolution: true, text: { ar: 'مخترق', en: 'owned' } } },  // steals a core id
        mk('phish', 'اضغط [هنا](https://evil.example/login) عشان تكمل'),
        mk('huge_sig', 'ok', { evidenceSignature: Array.from({ length: 5000 }, (_, i) => ({ token: `entity_x${i}`, weight: 1, source: 'text' })) }),
        mk('nan_weight', 'ok', { evidenceSignature: [{ token: 'entity_ticket', weight: Number.NaN, source: 'text' }] }),
        mk('huge_weight', 'ok', { evidenceSignature: [{ token: 'entity_ticket', weight: 1e9, source: 'text' }] }),
        mk('huge_answer', 'أ'.repeat(1_000_000)),
        mk('Bad Id!', 'ok'),
        mk('asks_password', 'عشان أساعدك ابعتلي كلمة المرور بتاعتك'),
        mk('fine_one', 'إجابة عادية.')
    ],
    glossary: [
        { canonical: 'entity_ok', labels: { ar: 'x', en: 'x' }, patterns: ['كلمه نادره جدا'] },
        { canonical: 'Bad Canon', labels: { ar: 'x', en: 'x' }, patterns: ['x'] },
        { canonical: 'entity_flood', labels: { ar: 'x', en: 'x' }, patterns: Array.from({ length: 10000 }, (_, i) => `p${i}`) },
        { canonical: 'entity_longpat', labels: { ar: 'x', en: 'x' }, patterns: ['كلمة '.repeat(40)] }
    ]
};
function mk(id, ar, extra = {}) {
    return {
        id, intent: `test/${id}`, label: { ar: id, en: id }, category: 'other',
        evidenceSignature: [{ token: 'entity_ticket', weight: 2, source: 'text' }, { token: `entity_${id.toLowerCase().replace(/[^a-z_]/g, '')}_x`, weight: 3, source: 'text' }],
        discriminatingQuestions: [], resolution: { hasAutoResolution: true, text: { ar, en: 'x' } },
        requiresTicketIfUnresolved: false, ...extra
    };
}

test('T-2: a malicious pack loses every bad item and cannot touch the core', async () => {
    const catalogs = createEditionCatalogs({ coreScenarios: async () => core, pack: async () => MALICIOUS });
    const a = await catalogs.forProfile(resolveEditionProfile('pro', {}));
    const ids = new Set(a.scenarios.map((s) => s.id));
    // The core scenario is the core's, byte for byte — and there is exactly
    // one of it (find() alone would pass with a second copy appended; the
    // mutation check showed that).
    const copies = a.scenarios.filter((s) => s.id === coreVictim.id);
    assert.equal(copies.length, 1);
    assert.equal(copies[0].resolution.text?.ar, coreVictim.resolution.text?.ar);
    for (const bad of ['phish', 'huge_sig', 'nan_weight', 'huge_weight', 'huge_answer', 'Bad Id!', 'asks_password']) {
        assert.ok(!ids.has(bad), `${bad} should have been skipped`);
    }
    assert.ok(ids.has('fine_one'), 'a valid item in the same pack still loads');
    assert.deepEqual(a.glossaryLayers.flat().map((e) => e.canonical), ['entity_ok'], 'only the valid glossary entry survives');
    assert.ok(a.warnings.length >= 9, 'every rejection is recorded');
    assert.deepEqual([...a.genericTokens], ['entity_ok'], 'a tampered generic-word list keeps only plain token names');
});

test('T-2: a pack file that is not even a pack degrades to nothing, not to a crash', async () => {
    for (const garbage of [null, 42, 'x', { scenarios: 'no' }, { scenarios: [null, 1, 'x'] }, { glossary: {} }]) {
        const catalogs = createEditionCatalogs({ coreScenarios: async () => core, pack: async () => garbage });
        const a = await catalogs.forProfile(resolveEditionProfile('pro', {}));
        assert.equal(a.scenarios.length, core.length);
    }
});

// ── T-3 vocabulary hijack through a glossary layer ──────────────────────

test('T-3: a layer cannot redefine or capture words the base glossary owns', async () => {
    const g = createRealGlossaryProvider();
    const opts = { glossaryProvider: g, arabiziProvider: createRealArabiziProvider() };
    const text = 'عايز الغي الاشتراك';
    const base = (await normalize(text, opts)).normalizedTokens.map((t) => t.canonical);
    const hijack = [
        { canonical: 'intent_cancel', labels: { ar: 'x', en: 'x' }, patterns: ['عايز'] },            // a base canonical
        { canonical: 'entity_hijack', labels: { ar: 'x', en: 'x' }, patterns: ['الغي الاشتراك', 'الغي', 'الاشتراك'] }
    ];
    const layered = (await normalize(text, { ...opts, glossaryLayers: [hijack] })).normalizedTokens.map((t) => t.canonical);
    for (const t of base.filter((x) => !/^[؀-ۿ]/.test(x))) assert.ok(layered.includes(t), `base token ${t} lost`);
    assert.ok(!layered.includes('entity_hijack'), 'a layer must not capture base-owned words');
});

test('T-3: a synonym gives meaning to an open word only — never captures a base word, never names a non-base token', async () => {
    const opts = { glossaryProvider: createRealGlossaryProvider(), arabiziProvider: createRealArabiziProvider() };
    const canon = async (text, layers) => (await normalize(text, { ...opts, glossaryLayers: layers })).normalizedTokens.map((t) => t.canonical);
    const syn = (canonical, patterns) => ({ canonical, synonym: true, labels: { ar: 'x', en: 'x' }, patterns });

    // 1. Aimed at base-owned words: the base reading is untouched. («عايز» is
    //    left out on purpose: the base does NOT resolve it, so a synonym may.)
    const owned = 'الغي الاشتراك';
    const capture = [[syn('entity_whatsapp', ['الغي', 'الاشتراك', 'الغي الاشتراك'])]];
    const before = await canon(owned, null);
    assert.ok(before.includes('intent_cancel'), 'the fixture must be base-resolved words');
    assert.deepEqual(await canon(owned, capture), before);

    // 2. Aimed at a token the base does not have: dropped entirely.
    const open = 'زززززكلمه';
    const rogue = [[syn('entity_rogue_token', ['زززززكلمه'])]];
    assert.ok(!(await canon(open, rogue)).includes('entity_rogue_token'));
    assert.deepEqual(await canon(open, rogue), await canon(open, null));

    // 3. The legitimate case, so 1 and 2 are not passing by doing nothing.
    const legit = [[syn('entity_login', ['زززززكلمه'])]];
    assert.ok((await canon(open, legit)).includes('entity_login'));
});

// ── T-4 attacks through a bigger catalog ────────────────────────────────

const EFFECTFUL = new Set(['CREATE_TICKET', 'ESCALATE_TO_HUMAN']);

for (const variantName of ['enforce', 'off']) {
    test(`T-4: no attack gets a more effectful outcome in Pro than in Free (trust ${variantName})`, async () => {
        const variant = { retrieval: true, sparseState: false, trust: variantName };
        const run = async (edition, text) => {
            const ed = await nodeEdition(edition, SIE_DEFAULT_SETTINGS);
            return runTurn({ text, catalog: ed.scenarios, settings: SIE_DEFAULT_SETTINGS, variant,
                providers: { glossaryProvider: ed.providers.glossaryProvider, arabiziProvider: ed.providers.arabiziProvider },
                edition: { profile: ed.profile, glossaryLayers: ed.glossaryLayers, packIds: ed.packIds, genericTokens: ed.genericTokens } });
        };
        const worse = [];
        for (const a of ATTACKS) {
            const f = await run('free', a.text);
            const p = await run('pro', a.text);
            const fe = EFFECTFUL.has(f.decision?.action);
            const pe = EFFECTFUL.has(p.decision?.action);
            if (pe && !fe) worse.push(`${a.class}: «${a.text.slice(0, 60)}» ${f.decision?.action} → ${p.decision?.action} ${p.decision?.scenarioId}`);
            if (variantName === 'enforce') assert.equal(p.trustEnvelope?.level, f.trustEnvelope?.level, `trust level differs for «${a.text.slice(0, 40)}»`);
        }
        assert.deepEqual(worse, []);
    });
}

test('T-5: pack limits are real limits', () => {
    assert.ok(PACK_LIMITS.maxSignatureTokens <= 8 && PACK_LIMITS.maxAnswerChars <= 4000 && PACK_LIMITS.maxPatterns <= 60);
});
