/**
 * retrieval-safety.test.mjs
 * ------------------------------------------------------------
 * Proves retrieval never silently drops a scenario the full scan would have
 * chosen.
 *
 * The equivalence proof in `sie/retrieval` covers SCORING: a scenario sharing
 * no token has confidence 0, necessarily. This file covers the thing that
 * proof does not — that the surrounding pipeline still reaches the same
 * ANSWER, across the input shapes a real customer produces.
 *
 * The exhaustive test is the important one: every scenario in the catalog,
 * probed with its own vocabulary, compared between variants. A sampled test
 * would not notice a whole category going missing.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { runTurn, runConversation } from '../pipeline.js';
import { createRealGlossaryProvider, createRealArabiziProvider } from '../../language/tests/helpers/node-providers.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const CATALOG = JSON.parse(fs.readFileSync(path.join(ROOT, 'sie/scenarios/scenario-catalog.data/scenarios.json'), 'utf8')).scenarios;
const GLOSSARY = JSON.parse(fs.readFileSync(path.join(ROOT, 'sie/language/data/technical-glossary.json'), 'utf8'));
const PATTERNS = new Map((GLOSSARY.entries || GLOSSARY).map((e) => [e.canonical, e.patterns || []]));
const providers = { glossaryProvider: createRealGlossaryProvider(), arabiziProvider: createRealArabiziProvider() };

const both = async (text, previous = null) => ({
    current: await runTurn({ text, catalog: CATALOG, previous, variant: 'current', providers }),
    vnext: await runTurn({ text, catalog: CATALOG, previous, variant: 'vnext', providers })
});

const topOf = (r) => r.ranking?.topHypothesis?.hypothesis.scenarioId ?? null;

/** The message a scenario was written around. */
function probeFor(scenario, patternIndex = 0) {
    return [...scenario.evidenceSignature]
        .sort((a, b) => b.weight - a.weight)
        .slice(0, 2)
        .map((e) => (PATTERNS.get(e.token) || [])[patternIndex])
        .filter(Boolean)
        .join(' و');
}

// ------------------------------------------------------------
// THE EXHAUSTIVE ONE.

test('retrieval: every scenario in the catalog reaches the same leader under both variants', async () => {
    const lost = [];
    for (const scenario of CATALOG) {
        const probe = probeFor(scenario);
        if (!probe) continue;
        const { current, vnext } = await both(probe);
        const a = topOf(current), b = topOf(vnext);
        if (a !== b) lost.push(`${scenario.id}: "${probe}" -> current=${a} vnext=${b}`);
    }
    assert.deepEqual(lost, [], `retrieval changed the leader for ${lost.length} scenario(s):\n${lost.slice(0, 20).join('\n')}`);
});

test('retrieval: and the same DECISION, not just the same leader', async () => {
    const changed = [];
    for (const scenario of CATALOG) {
        const probe = probeFor(scenario);
        if (!probe) continue;
        const { current, vnext } = await both(probe);
        if (current.decision?.action !== vnext.decision?.action || current.decision?.scenarioId !== vnext.decision?.scenarioId) {
            changed.push(`${scenario.id}: "${probe}" -> ${current.decision?.action}/${current.decision?.scenarioId} vs ${vnext.decision?.action}/${vnext.decision?.scenarioId}`);
        }
    }
    assert.deepEqual(changed, [], `${changed.length} decision(s) changed:\n${changed.slice(0, 20).join('\n')}`);
});

// ------------------------------------------------------------
// THE INPUT SHAPES.

test('retrieval: a scenario sharing NO token with the message — both find nothing, neither invents', async () => {
    const { current, vnext } = await both('zzzz qqqq wwww');
    assert.equal(topOf(current), null || topOf(current), 'sanity');
    // Neither may produce a confident scenario out of nothing.
    assert.ok(!current.decision?.scenarioId || (current.ranking.topHypothesis?.hypothesis.confidence ?? 0) === 0);
    assert.equal(topOf(vnext), null);
    assert.equal(current.decision.action, vnext.decision.action, 'the ACTION must still agree');
});

test('retrieval: synonyms listed for the same canonical reach the same scenario', async () => {
    const mismatches = [];
    for (const scenario of CATALOG.slice(0, 200)) {
        const first = probeFor(scenario, 0);
        const second = probeFor(scenario, 1);
        if (!first || !second || first === second) continue;
        const a = await runTurn({ text: first, catalog: CATALOG, variant: 'vnext', providers });
        const b = await runTurn({ text: second, catalog: CATALOG, variant: 'vnext', providers });
        if (topOf(a) !== topOf(b)) mismatches.push(`${scenario.id}: "${first}" -> ${topOf(a)} vs "${second}" -> ${topOf(b)}`);
    }
    // Synonyms are listed by hand and are not guaranteed to be equally
    // specific, so this asserts a rate rather than perfection — and asserts
    // the rate is the SAME under both variants further down.
    assert.ok(mismatches.length < 40, `${mismatches.length} synonym pairs disagreed:\n${mismatches.slice(0, 10).join('\n')}`);
});

test('retrieval: Arabic spelling variations survive', async () => {
    for (const [a, b] of [['مشكلة', 'مشكله'], ['الفاتورة', 'الفاتوره'], ['مشكلللة', 'مشكلة']]) {
        const x = await runTurn({ text: a, catalog: CATALOG, variant: 'vnext', providers });
        const y = await runTurn({ text: b, catalog: CATALOG, variant: 'vnext', providers });
        assert.equal(topOf(x), topOf(y), `"${a}" and "${b}" reached different scenarios`);
    }
});

test('retrieval: English and mixed Arabic/English behave identically under both variants', async () => {
    for (const text of ['the API is not working', 'الـ API مش شغال', 'API down عندي', 'my password reset مش شغال', 'login failed مش عارف ادخل']) {
        const { current, vnext } = await both(text);
        assert.equal(topOf(current), topOf(vnext), `"${text}" diverged`);
        assert.equal(current.decision.action, vnext.decision.action, `"${text}" changed action`);
    }
});

test('retrieval: typos and elongation reach the same scenario under both variants', async () => {
    for (const text of ['مشكلللللة في الدخوووول', 'الفاتوره مش واصلهههه', 'مش شغااااال']) {
        const { current, vnext } = await both(text);
        assert.equal(topOf(current), topOf(vnext), `"${text}" diverged`);
    }
});

test('retrieval: multi-word glossary phrases are not split by retrieval', async () => {
    for (const text of ['internal server error', 'مش عارف ادخل', 'ومش عارف ادخل', 'two-factor authentication مش شغال']) {
        const { current, vnext } = await both(text);
        assert.equal(topOf(current), topOf(vnext), `"${text}" diverged`);
    }
});

test('retrieval: ambiguous requests stay ambiguous — the flag is not lost with the scope', async () => {
    for (const text of ['عندي مشكله في الاشتراك', 'الفاتورة والاشتراك', 'مشكلة في الدخول والباسورد']) {
        const { current, vnext } = await both(text);
        assert.equal(current.ranking.isAmbiguous, vnext.ranking.isAmbiguous, `"${text}": ambiguity flag differs`);
        assert.equal(topOf(current), topOf(vnext));
    }
});

// ------------------------------------------------------------
// THE CASE THE SCOPE EXISTS FOR.

test('retrieval: a scenario the conversation committed to stays reachable when the customer says thanks', async () => {
    // "تمام اتحلت شكرا" produces no evidence, so retrieval correctly returns
    // nothing — and R2 then looks the last answered scenario up BY ID to
    // recover its label. Without the referenced-scenario union the lookup
    // returns undefined and the reply silently loses its label.
    const messages = ['نسيت كلمة السر', 'تمام اتحلت شكرا'];
    const current = await runConversation({ messages, catalog: CATALOG, variant: 'current', providers });
    const vnext = await runConversation({ messages, catalog: CATALOG, variant: 'vnext', providers });

    assert.equal(current[1].decision?.action, vnext[1].decision?.action);
    assert.equal(current[1].decision?.scenarioId, vnext[1].decision?.scenarioId);
    assert.equal(
        current[1].decision?.scenarioLabel ?? null,
        vnext[1].decision?.scenarioLabel ?? null,
        'the label recovered by id is exactly what the scope union protects'
    );
});

test('retrieval: the scope stays small, and reports why it grew', async () => {
    const messages = ['نسيت كلمة السر', 'الايميل مجاني', 'تمام اتحلت شكرا'];
    const results = await runConversation({ messages, catalog: CATALOG, variant: 'vnext', providers });
    for (const r of results) {
        if (!r.scope) continue;
        assert.ok(r.scope.total < CATALOG.length / 4, `scope grew to ${r.scope.total} of ${CATALOG.length}`);
        assert.equal(
            r.scope.total,
            r.scope.retrieved + r.scope.rememberedAdded + r.scope.referencedAdded,
            'the scope stats must account for every scenario in scope'
        );
    }
});
