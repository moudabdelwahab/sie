/**
 * scenario-catalog-resolver.test.mjs
 * ------------------------------------------------------------
 * Regression tests for the catalog resolution bug.
 *
 * THE BUG: `use_published_scenarios = true` made the engine diagnose
 * against the published database rows INSTEAD of the shipped catalog. In
 * production that meant 7 rows replacing 650 reviewed scenarios, with no
 * error, no warning, and a health check that kept reporting 650.
 *
 * The invariant that makes it impossible to happen again is the first
 * test here: the effective catalog can never be smaller than the base.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    mergeScenarioCatalogs,
    resolveScenarioCatalog,
    loadPublishedScenarioOverlay
} from '../scenario-catalog.resolver.js';

/** A minimally valid scenario, so these tests exercise merging rather than the schema. */
function scenario(id, tokenCount = 2, label = id) {
    return {
        id,
        label: { ar: label, en: label },
        category: 'inquiry',
        // No `knowledgeSource` key at all: the schema accepts it absent or
        // as a non-empty string, and rejects null.
        resolution: {
            text: { ar: 'نص', en: 'text' },
            hasAutoResolution: false
        },
        evidenceSignature: Array.from({ length: tokenCount }, (_, i) => ({
            token: `${id}_token_${i}`,
            source: 'text',
            weight: 1
        })),
        discriminatingQuestions: [],
        requiresTicketIfUnresolved: false
    };
}

function baseProviderOf(scenarios) {
    return {
        getAllScenarios: async () => scenarios,
        getLoadWarnings: async () => []
    };
}

const SETTINGS_ON = { use_published_scenarios: true };
const SETTINGS_OFF = { use_published_scenarios: false };
const FAKE_CLIENT = {};

// ===================================================================
// The invariant
// ===================================================================

test('THE INVARIANT: the effective catalog is never smaller than the base', async () => {
    const base = Array.from({ length: 650 }, (_, i) => scenario(`base_${i}`));
    // The exact shape of the production bug: a tiny overlay, mostly ids
    // the base has never heard of.
    const overlay = [
        scenario('category_login'),
        scenario('category_other'),
        scenario('category_subscription'),
        scenario('category_tickets'),
        scenario('category_whatsapp'),
        scenario('base_0', 16),
        scenario('base_1', 20)
    ];

    const { provider, resolution } = await resolveScenarioCatalog({
        supabase: FAKE_CLIENT,
        settings: SETTINGS_ON,
        baseProvider: baseProviderOf(base),
        loadOverlay: async () => overlay
    });

    const effective = await provider.getAllScenarios();
    assert.ok(
        effective.length >= base.length,
        `catalog shrank from ${base.length} to ${effective.length} — this is the production bug`
    );
    assert.equal(effective.length, 655, '650 base + 5 genuinely new ids');
    assert.equal(resolution.baseCount, 650);
    assert.equal(resolution.overlayCount, 7);
    assert.equal(resolution.effectiveCount, 655);
    assert.deepEqual(resolution.overriddenIds.sort(), ['base_0', 'base_1']);
    assert.equal(resolution.addedIds.length, 5);
    assert.equal(resolution.overlayStatus, 'applied');
});

test('an overlay row overrides the base entry with the same id, in place', () => {
    const base = [scenario('a'), scenario('b', 2), scenario('c')];
    const overlay = [scenario('b', 20)];

    const { scenarios, addedIds, overriddenIds } = mergeScenarioCatalogs(base, overlay);

    assert.equal(scenarios.length, 3, 'an override adds nothing');
    assert.deepEqual(scenarios.map((s) => s.id), ['a', 'b', 'c'], 'position is preserved');
    assert.equal(scenarios[1].evidenceSignature.length, 20, 'the richer overlay signature won');
    assert.deepEqual(overriddenIds, ['b']);
    assert.deepEqual(addedIds, []);
});

test('an overlay row with an unknown id is appended', () => {
    const { scenarios, addedIds, overriddenIds } = mergeScenarioCatalogs(
        [scenario('a')],
        [scenario('z')]
    );
    assert.deepEqual(scenarios.map((s) => s.id), ['a', 'z']);
    assert.deepEqual(addedIds, ['z']);
    assert.deepEqual(overriddenIds, []);
});

test('merging an empty overlay is exactly the base', () => {
    const base = [scenario('a'), scenario('b')];
    const { scenarios, addedIds, overriddenIds } = mergeScenarioCatalogs(base, []);
    assert.deepEqual(scenarios.map((s) => s.id), ['a', 'b']);
    assert.deepEqual(addedIds, []);
    assert.deepEqual(overriddenIds, []);
});

// ===================================================================
// Failure posture — every path degrades to the reviewed catalog
// ===================================================================

test('the overlay is not even read when the setting is off', async () => {
    const base = [scenario('a'), scenario('b')];
    let reads = 0;

    const { provider, resolution } = await resolveScenarioCatalog({
        supabase: FAKE_CLIENT,
        settings: SETTINGS_OFF,
        baseProvider: baseProviderOf(base),
        loadOverlay: async () => {
            reads += 1;
            return [scenario('z')];
        }
    });

    assert.equal(reads, 0, 'a disabled overlay must cost no query');
    assert.equal((await provider.getAllScenarios()).length, 2);
    assert.equal(resolution.overlayStatus, 'disabled');
    assert.equal(resolution.effectiveCount, 2);
});

test('a failing overlay read degrades to the base and records why', async () => {
    const base = [scenario('a'), scenario('b')];

    const { provider, resolution } = await resolveScenarioCatalog({
        supabase: FAKE_CLIENT,
        settings: SETTINGS_ON,
        baseProvider: baseProviderOf(base),
        loadOverlay: async () => {
            throw new Error('connection reset');
        }
    });

    assert.equal((await provider.getAllScenarios()).length, 2, 'still the full base');
    assert.equal(resolution.overlayStatus, 'unavailable');
    assert.match(resolution.overlayError, /connection reset/);
});

test('no supabase client means the overlay is reported unchecked, not applied', async () => {
    const base = [scenario('a')];
    const { resolution } = await resolveScenarioCatalog({
        settings: SETTINGS_ON,
        baseProvider: baseProviderOf(base)
    });
    assert.equal(resolution.overlayStatus, 'unavailable');
    assert.equal(resolution.effectiveCount, 1);
});

test('an invalid published row is skipped and counted, not fatal', async () => {
    const base = [scenario('a')];
    const overlay = [scenario('good'), { id: 'broken' /* no signature, no label */ }];

    const { provider, resolution } = await resolveScenarioCatalog({
        supabase: FAKE_CLIENT,
        settings: SETTINGS_ON,
        baseProvider: baseProviderOf(base),
        loadOverlay: async () => overlay
    });

    const ids = (await provider.getAllScenarios()).map((s) => s.id);
    assert.deepEqual(ids, ['a', 'good']);
    assert.equal(resolution.overlayInvalid, 1);
    assert.equal(resolution.overlayCount, 1);
});

test('an overlay that validates to nothing leaves the base untouched', async () => {
    const base = [scenario('a'), scenario('b')];
    const { provider, resolution } = await resolveScenarioCatalog({
        supabase: FAKE_CLIENT,
        settings: SETTINGS_ON,
        baseProvider: baseProviderOf(base),
        loadOverlay: async () => [{ id: 'broken' }]
    });
    assert.equal((await provider.getAllScenarios()).length, 2);
    assert.equal(resolution.overlayStatus, 'empty');
    assert.equal(resolution.overlayInvalid, 1);
});

// ===================================================================
// The resolved provider satisfies the same interface as the base
// ===================================================================

test('the resolved provider implements the full catalog provider contract', async () => {
    const base = [scenario('a', 2)];
    const { provider } = await resolveScenarioCatalog({
        supabase: FAKE_CLIENT,
        settings: SETTINGS_ON,
        baseProvider: baseProviderOf(base),
        loadOverlay: async () => [scenario('z', 3)]
    });

    assert.equal(typeof provider.getAllScenarios, 'function');
    assert.equal(typeof provider.getScenarioById, 'function');
    assert.equal(typeof provider.getEvidenceVocabulary, 'function');
    assert.equal(typeof provider.getLoadWarnings, 'function');

    assert.equal((await provider.getScenarioById('z')).id, 'z');
    assert.equal(await provider.getScenarioById('nope'), null);

    const vocabulary = await provider.getEvidenceVocabulary();
    assert.equal(vocabulary.length, 5, '2 tokens from the base + 3 from the overlay');
    assert.ok(vocabulary.includes('z_token_0'));
});

// ===================================================================
// The database read itself
// ===================================================================

test('only the latest published version of each scenario_key is taken', async () => {
    const rows = [
        { scenario_key: 'a', version: 3, definition: scenario('a', 3) },
        { scenario_key: 'a', version: 1, definition: scenario('a', 1) },
        { scenario_key: 'b', version: 2, definition: scenario('b', 2) }
    ];
    const supabase = {
        from: () => ({
            select: () => ({
                eq: () => ({
                    order: async () => ({ data: rows, error: null })
                })
            })
        })
    };

    const definitions = await loadPublishedScenarioOverlay(supabase);
    assert.equal(definitions.length, 2);
    assert.equal(definitions[0].evidenceSignature.length, 3, 'version 3 won, not version 1');
});

test('a database error propagates so the resolver can report it', async () => {
    const supabase = {
        from: () => ({
            select: () => ({
                eq: () => ({
                    order: async () => ({ data: null, error: { message: 'permission denied' } })
                })
            })
        })
    };
    await assert.rejects(() => loadPublishedScenarioOverlay(supabase), /permission denied/);
});

// ===================================================================
// Phase 1.5 — the eight invariants, stated as the reviewer stated them.
// Several are covered above; these pin the ones that were implicit, and
// the two that use the REAL production data rather than a fixture.
// ===================================================================

/** The seven rows exactly as they sit in production, warts included. */
function productionOverlayRows() {
    const sig = (tokens) => tokens.map((t) => ({ token: t, source: 'text', weight: 1 }));
    const router = (id, ar, category, tokens) => ({
        id, label: { ar, en: '' }, category,
        resolution: { hasAutoResolution: false },
        evidenceSignature: sig(tokens), discriminatingQuestions: [], requiresTicketIfUnresolved: true
    });
    const inquiry = (id, ar, ks, tokens) => ({
        id, label: { ar, en: '' }, category: 'inquiry',
        resolution: { text: { ar: 'نص', en: '' }, knowledgeSource: ks, hasAutoResolution: true },
        evidenceSignature: sig(tokens), discriminatingQuestions: [], requiresTicketIfUnresolved: false
    });
    return [
        router('category_login', 'تسجيل الدخول', 'login', ['دخول', 'login']),
        router('category_other', 'حاجة تانية', 'other', ['اخرى', 'other']),
        router('category_subscription', 'الاشتراك', 'subscription', ['اشتراك', 'subscription']),
        router('category_tickets', 'التذاكر', 'tickets', ['تذكره', 'ticket']),
        router('category_whatsapp', 'واتساب', 'whatsapp', ['واتساب', 'whatsapp']),
        inquiry('subscription_status_inquiry', 'استفسار عن حالة الاشتراك', 'subscription_status', ['اشتراكي']),
        inquiry('ticket_status_inquiry', 'استفسار عن حالة التذكرة', 'ticket_status', ['تذاكري'])
    ];
}

test('INVARIANT F: 650 base + the 7 real production rows (all invalid) = 650 effective', async () => {
    const base = Array.from({ length: 650 }, (_, i) => scenario(`base_${i}`));
    const { provider, resolution } = await resolveScenarioCatalog({
        supabase: FAKE_CLIENT,
        settings: SETTINGS_ON,
        baseProvider: baseProviderOf(base),
        loadOverlay: async () => productionOverlayRows()
    });

    assert.equal((await provider.getAllScenarios()).length, 650, 'the production overlay must not shrink the catalog');
    assert.equal(resolution.effectiveCount, 650);
    assert.equal(resolution.overlayCount, 0, 'none of the seven validate');
    assert.equal(resolution.overlayInvalid, 7, 'and all seven are reported, not silently dropped');
    assert.equal(resolution.overlayStatus, 'empty');
});

test('INVARIANT G: a valid overlay adds exactly its new ids and nothing else', async () => {
    const base = Array.from({ length: 650 }, (_, i) => scenario(`base_${i}`));
    const overlay = [scenario('brand_new_a'), scenario('brand_new_b'), scenario('base_5', 9)];

    const { provider, resolution } = await resolveScenarioCatalog({
        supabase: FAKE_CLIENT,
        settings: SETTINGS_ON,
        baseProvider: baseProviderOf(base),
        loadOverlay: async () => overlay
    });

    assert.equal(resolution.effectiveCount, 652, '650 + 2 new; the override adds nothing');
    assert.deepEqual(resolution.addedIds.sort(), ['brand_new_a', 'brand_new_b']);
    assert.deepEqual(resolution.overriddenIds, ['base_5']);
    assert.equal((await provider.getScenarioById('base_5')).evidenceSignature.length, 9);
});

test('INVARIANT H: an override replaces a base scenario, it can never delete one', async () => {
    const base = [scenario('a'), scenario('b'), scenario('c')];
    // Every hostile shape an overlay row could take against an existing id.
    const overlay = [
        { id: 'a' },                                   // schema-invalid
        { id: 'b', label: null },                      // schema-invalid
        scenario('c', 1)                               // valid override
    ];

    const { provider, resolution } = await resolveScenarioCatalog({
        supabase: FAKE_CLIENT,
        settings: SETTINGS_ON,
        baseProvider: baseProviderOf(base),
        loadOverlay: async () => overlay
    });

    const ids = (await provider.getAllScenarios()).map((s) => s.id);
    assert.deepEqual(ids, ['a', 'b', 'c'], 'all three base ids survive');
    assert.equal(resolution.effectiveCount, 3);
    assert.equal(resolution.overlayInvalid, 2);
    assert.deepEqual(resolution.overriddenIds, ['c']);
    // There is no deletion semantic, by design: no overlay shape removes an id.
    assert.ok(
        !Object.keys(resolution).includes('removedIds'),
        'the resolution has no removal channel, because the merge has no deletion rule'
    );
});

test('a duplicate id inside one overlay batch is rejected, not applied twice', async () => {
    const base = [scenario('a')];
    const { provider, resolution } = await resolveScenarioCatalog({
        supabase: FAKE_CLIENT,
        settings: SETTINGS_ON,
        baseProvider: baseProviderOf(base),
        loadOverlay: async () => [scenario('dup', 2), scenario('dup', 5)]
    });
    const ids = (await provider.getAllScenarios()).map((s) => s.id);
    assert.deepEqual(ids, ['a', 'dup']);
    assert.equal(resolution.overlayInvalid, 1, 'validateCatalog rejects the second as a duplicate id');
    assert.equal((await provider.getScenarioById('dup')).evidenceSignature.length, 2, 'the first wins');
});

test('unreadable settings report "unknown", never "disabled"', async () => {
    const base = [scenario('a'), scenario('b')];
    for (const settings of [null, undefined]) {
        const { provider, resolution } = await resolveScenarioCatalog({
            supabase: FAKE_CLIENT,
            settings,
            baseProvider: baseProviderOf(base),
            loadOverlay: async () => { throw new Error('should not be reached'); }
        });
        assert.equal(resolution.overlayStatus, 'unknown',
            'an unauthenticated health check knows nothing about the overlay and must say so');
        assert.notEqual(resolution.overlayStatus, 'disabled');
        assert.equal((await provider.getAllScenarios()).length, 2);
    }
});

test('an explicitly-false setting still reports "disabled", not "unknown"', async () => {
    const { resolution } = await resolveScenarioCatalog({
        supabase: FAKE_CLIENT,
        settings: SETTINGS_OFF,
        baseProvider: baseProviderOf([scenario('a')]),
        loadOverlay: async () => []
    });
    assert.equal(resolution.overlayStatus, 'disabled');
});
