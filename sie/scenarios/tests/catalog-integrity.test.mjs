/**
 * catalog-integrity.test.mjs
 * ------------------------------------------------------------
 * Guards the properties that make the Scenario Catalog *usable*, as
 * opposed to merely well-formed. validateScenario() already checks the
 * shape of one entry; nothing before this file checked the relationships
 * BETWEEN entries, or between an entry and the vocabulary it depends on.
 *
 * Those relationships are where a catalog of this size actually breaks,
 * and every failure mode below is silent at runtime — a scenario that
 * can never win, or can never be reached, looks exactly like a scenario
 * that simply hasn't come up yet:
 *
 *  - A token no glossary entry produces means the scenario is DEAD: the
 *    normalizer can never emit that canonical, so the hypothesis never
 *    accumulates evidence.
 *  - Two scenarios with the same token set are permanently AMBIGUOUS:
 *    identical evidence, so the Ranking Engine can only ever separate
 *    them by weight, and the Decision Engine keeps asking questions that
 *    cannot discriminate.
 *  - A discriminating question whose impliesEvidence names a token no
 *    scenario ranks on answers into the void — the customer is asked to
 *    clarify and the clarification changes nothing.
 *  - Two glossary entries claiming the same pattern silently give the
 *    match to whichever sorts first, so the loser's canonical is
 *    unreachable through that phrase.
 *  - A conversational pattern that detectSmallTalk() already matches is
 *    unreachable for a different reason: sie-chat-bridge.js short-circuits
 *    small talk BEFORE the pipeline runs, so the scenario is never
 *    consulted.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { validateCatalog } from '../scenario-types.js';
import { detectSmallTalk } from '../../language/small-talk.js';
import { normalizeArabicToken } from '../../language/dialect-normalizer.js';

const here = dirname(fileURLToPath(import.meta.url));
const readJson = (relative) => JSON.parse(readFileSync(join(here, relative), 'utf8'));

const { scenarios } = readJson('../scenario-catalog.data/scenarios.json');
const glossaryFile = readJson('../../language/data/technical-glossary.json');
const glossaryEntries = glossaryFile.entries || glossaryFile;

const glossaryCanonicals = new Set(glossaryEntries.map((e) => e.canonical));
const signatureTokens = new Set();
for (const scenario of scenarios) {
    for (const entry of scenario.evidenceSignature) signatureTokens.add(entry.token);
}

test('every scenario passes the validator the engine loads it with', () => {
    const { valid, invalid } = validateCatalog(scenarios);
    assert.deepEqual(
        invalid.map(({ scenario, errors }) => `${scenario?.id ?? 'unknown'}: ${errors.join('; ')}`),
        []
    );
    assert.equal(valid.length, scenarios.length);
});

test('scenario ids are unique', () => {
    const seen = new Set();
    const duplicates = [];
    for (const scenario of scenarios) {
        if (seen.has(scenario.id)) duplicates.push(scenario.id);
        seen.add(scenario.id);
    }
    assert.deepEqual(duplicates, []);
});

test('every evidence token is one the glossary can actually produce', () => {
    const unreachable = [];
    for (const scenario of scenarios) {
        for (const entry of scenario.evidenceSignature) {
            if (!glossaryCanonicals.has(entry.token)) {
                unreachable.push(`${scenario.id} -> ${entry.token}`);
            }
        }
    }
    assert.deepEqual(unreachable, []);
});

test('no two scenarios share the same evidence token set', () => {
    const byTokenSet = new Map();
    for (const scenario of scenarios) {
        const key = scenario.evidenceSignature
            .map((e) => e.token)
            .sort()
            .join('|');
        if (!byTokenSet.has(key)) byTokenSet.set(key, []);
        byTokenSet.get(key).push(scenario.id);
    }
    const collisions = [...byTokenSet.entries()]
        .filter(([, ids]) => ids.length > 1)
        .map(([key, ids]) => `${ids.join(' == ')}  [${key}]`);
    assert.deepEqual(collisions, []);
});

test('discriminating questions resolve into tokens some scenario ranks on', () => {
    const dangling = [];
    for (const scenario of scenarios) {
        for (const question of scenario.discriminatingQuestions) {
            for (const token of question.resolvesEvidence) {
                if (!signatureTokens.has(token)) {
                    dangling.push(`${scenario.id}/${question.id} resolvesEvidence -> ${token}`);
                }
            }
            for (const option of question.options || []) {
                for (const token of option.impliesEvidence || []) {
                    if (!signatureTokens.has(token)) {
                        dangling.push(`${scenario.id}/${question.id}/${option.value} impliesEvidence -> ${token}`);
                    }
                }
            }
        }
    }
    assert.deepEqual(dangling, []);
});

test('a discriminating question offers options that lead somewhere different', () => {
    const useless = [];
    for (const scenario of scenarios) {
        for (const question of scenario.discriminatingQuestions) {
            const options = question.options || [];
            assert.ok(options.length >= 2, `${scenario.id}/${question.id} needs at least two options`);

            const values = options.map((o) => o.value);
            assert.equal(new Set(values).size, values.length, `${scenario.id}/${question.id} has duplicate option values`);

            // Options that all imply the same evidence cannot separate
            // anything — the question costs the customer a turn and
            // teaches the engine nothing.
            const implied = options.map((o) => (o.impliesEvidence || []).slice().sort().join('|'));
            if (new Set(implied).size < 2) useless.push(`${scenario.id}/${question.id}`);
        }
    }
    assert.deepEqual(useless, []);
});

test('question ids are unique within their scenario', () => {
    const duplicates = [];
    for (const scenario of scenarios) {
        const seen = new Set();
        for (const question of scenario.discriminatingQuestions) {
            if (seen.has(question.id)) duplicates.push(`${scenario.id}/${question.id}`);
            seen.add(question.id);
        }
    }
    assert.deepEqual(duplicates, []);
});

test('no two glossary entries claim the same pattern', () => {
    const owner = new Map();
    const stolen = [];
    for (const entry of glossaryEntries) {
        for (const pattern of entry.patterns) {
            const key = normalizeArabicToken(pattern) || pattern.toLowerCase();
            if (owner.has(key) && owner.get(key) !== entry.canonical) {
                stolen.push(`"${pattern}" claimed by both ${owner.get(key)} and ${entry.canonical}`);
            }
            if (!owner.has(key)) owner.set(key, entry.canonical);
        }
    }
    assert.deepEqual(stolen, []);
});

test('the small-talk short-circuit does not swallow any new conversational pattern', () => {
    // Only the vocabulary the conversational scenarios depend on matters
    // here: a technical phrase is never short-circuited, but a chatty one
    // can be, and then its scenario can never run.
    //
    // 49 of these overlaps predate this catalog and are deliberate rather
    // than broken: small talk answers the BARE phrase ("شكرا على صبرك" on
    // its own) with a canned reply, while the scenario still fires when the
    // same words appear inside a longer message. Freezing them as a
    // baseline keeps that layering intact while making it impossible to add
    // a new phrase that is dead on arrival — which is the failure this test
    // actually exists to catch.
    const baseline = new Set(readJson('./fixtures/small-talk-overlap.baseline.json'));
    const conversationalPrefixes = ['social_', 'trigger_', 'emotion_', 'behaviour_'];
    const conversationalTokens = new Set(
        [...signatureTokens].filter((t) => conversationalPrefixes.some((p) => t.startsWith(p)))
    );

    const swallowed = [];
    const current = new Set();
    for (const entry of glossaryEntries) {
        if (!conversationalTokens.has(entry.canonical)) continue;
        for (const pattern of entry.patterns) {
            const smallTalk = detectSmallTalk(pattern);
            if (!smallTalk) continue;
            current.add(`${entry.canonical}::${pattern}`);
            if (!baseline.has(`${entry.canonical}::${pattern}`)) {
                swallowed.push(`${entry.canonical}: "${pattern}" -> small talk (${smallTalk.type})`);
            }
        }
    }
    assert.deepEqual(swallowed, [], 'a new conversational phrase can never reach its scenario');

    // A phrase leaving the overlap is fine, but the baseline should then be
    // regenerated rather than left claiming something that is no longer true.
    const stale = [...baseline].filter((k) => !current.has(k));
    assert.deepEqual(stale, [], 'baseline lists overlaps that no longer exist — regenerate it');
});

test('an auto-resolving scenario carries an answer, and an escalating one does not pretend to', () => {
    const wrong = [];
    for (const scenario of scenarios) {
        const { hasAutoResolution, text } = scenario.resolution;
        if (hasAutoResolution && !text?.ar?.trim()) wrong.push(`${scenario.id} resolves but has no Arabic answer`);
        if (!hasAutoResolution && text) wrong.push(`${scenario.id} does not resolve but carries answer text`);
        if (hasAutoResolution && scenario.requiresTicketIfUnresolved) {
            wrong.push(`${scenario.id} both answers itself and demands a ticket`);
        }
    }
    assert.deepEqual(wrong, []);
});

test('the catalog holds the expected number of scenarios', () => {
    assert.equal(scenarios.length, 500);
});
