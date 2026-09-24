import test from 'node:test';
import assert from 'node:assert/strict';
import { editionSettingGuard, editionWarnings, parseEditionKey } from '../edition-guards.js';
import { validateSetting, SETTINGS, SIE_DEFAULT_SETTINGS } from '../../config/settings-schema.js';

const base = { ...SIE_DEFAULT_SETTINGS };

test('parseEditionKey maps every edition setting and nothing else', () => {
    for (const def of SETTINGS) {
        const parsed = parseEditionKey(def.key);
        if (def.edition) assert.deepEqual(parsed, { edition: def.edition, knob: def.knob });
        else assert.equal(parsed, null, def.key);
    }
});

test('Pro cannot be configured below Free, nor Free above Pro', () => {
    const r = editionSettingGuard('edition_pro_max_scenarios', 600, base);
    assert.ok(r.error, 'Pro 600 < Free 650 must be refused');
    assert.ok(editionSettingGuard('edition_max_max_scenarios', 900, base).error, 'Max 900 < Pro 1000 must be refused');
});

test('a lower edition can never end up above a higher one, whatever is stored', async () => {
    const { resolveEditionProfile } = await import('../editions.js');
    for (const free of [100, 400, 650, 9999]) {
        for (const pro of [0, 100, 500, 1000, 5000]) {
            for (const max of [0, 700, 1500]) {
                const s = { edition_free_max_scenarios: free, edition_pro_max_scenarios: pro, edition_max_max_scenarios: max };
                const f = resolveEditionProfile('free', s).maxScenarios;
                const p = resolveEditionProfile('pro', s).maxScenarios;
                const m = resolveEditionProfile('max', s).maxScenarios;
                assert.ok(f <= p && p <= m, JSON.stringify({ s, f, p, m }));
            }
        }
    }
});

test('lowering a scenario limit asks first and names the loss', () => {
    const r = editionSettingGuard('edition_free_max_scenarios', 500, base);
    assert.ok(r.confirm);
    assert.match(r.confirm.body, /150/);
    assert.deepEqual(editionSettingGuard('edition_max_max_scenarios', 1500, base), {}, 'the default needs no confirmation');
});

test('changing the default edition asks, and names from/to', () => {
    const r = editionSettingGuard('default_edition', 'max', base);
    assert.match(r.confirm.title, /ماكس/);
    assert.match(r.confirm.body, /المجاني/);
    assert.deepEqual(editionSettingGuard('default_edition', 'free', base), {}, 'no change, no question');
});

test('values that hurt customers ask; ordinary values pass silently', () => {
    assert.ok(editionSettingGuard('edition_pro_max_message_chars', 500, base).confirm);
    assert.deepEqual(editionSettingGuard('edition_pro_max_message_chars', 4000, base), {});
    assert.ok(editionSettingGuard('edition_pro_retrieval_max_candidates', 15, base).confirm);
    assert.ok(editionSettingGuard('edition_pro_rate_limit_per_minute', 20, base).confirm);
    assert.deepEqual(editionSettingGuard('edition_pro_rate_limit_per_minute', 0, base), {}, '0 = inherit, nothing to confirm');
    assert.ok(editionSettingGuard('edition_free_monthly_messages', 50, base).confirm);
    assert.deepEqual(editionSettingGuard('edition_free_monthly_messages', 0, base), {}, 'removing a cap needs no question');
});

test('the validator: 0 is a meaning, 1–9 is refused, the hard limits hold', () => {
    assert.equal(validateSetting('edition_pro_rate_limit_per_minute', 0).ok, true);
    const small = validateSetting('edition_pro_rate_limit_per_minute', 5);
    assert.equal(small.ok, false);
    assert.match(small.error, /صفر/);
    assert.equal(validateSetting('edition_pro_rate_limit_per_minute', 10).ok, true);
    assert.equal(validateSetting('edition_free_monthly_messages', 1).ok, true);
    assert.equal(validateSetting('edition_free_max_scenarios', 651).ok, false, 'Free is capped at its ceiling');
    assert.equal(validateSetting('edition_free_max_scenarios', 99).ok, false, 'below the floor');
    assert.equal(validateSetting('edition_max_max_message_chars', 8001).ok, false);
    assert.equal(validateSetting('default_edition', 'gold').ok, false);
});

test('warnings name a value the resolver adjusted', () => {
    // A row written before the guard existed (or by hand): Pro below Free.
    const w = editionWarnings({ ...base, edition_pro_max_scenarios: 600 });
    assert.ok(w.some((x) => /برو/.test(x) && /650/.test(x)), w.join('\n'));
    assert.deepEqual(editionWarnings(base), [], 'defaults produce no warning');
});
