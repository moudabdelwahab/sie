/**
 * settings-profiles.test.mjs — the settings the tests run under are real.
 * ------------------------------------------------------------
 * Every runtime and golden test names a profile from fixtures/settings/.
 * These checks keep the profiles honest: only known keys, only values the
 * console itself would accept, and the production profile reflecting the
 * configuration actually deployed (including the 2026-10-06 mitigations).
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { SETTINGS_PROFILES, readSettingsFixture, loadSettingsProfile } from './helpers/runtime-world.mjs';
import { SETTINGS_BY_KEY, validateSetting, SIE_DEFAULT_SETTINGS, BEHAVIOR_PROFILES } from '../../sie/config/settings-schema.js';

test('[T-1] the expected profiles exist', () => {
    for (const name of ['defaults', 'production', 'production-audit-2026-10', 'conservative', 'bold']) {
        assert.ok(SETTINGS_PROFILES.includes(name), `missing profile ${name}`);
    }
});

for (const name of SETTINGS_PROFILES) {
    test(`[T-1] profile ${name}: every key is a real setting and every value is one the console accepts`, () => {
        const fixture = readSettingsFixture(name);
        assert.ok(typeof fixture.description === 'string' && fixture.description.length > 10, 'a profile says what it is');
        for (const [key, value] of Object.entries(fixture.overrides || {})) {
            assert.ok(SETTINGS_BY_KEY[key], `${name}: unknown setting ${key}`);
            const check = validateSetting(key, value);
            assert.equal(check.ok, true, `${name}: ${key}=${JSON.stringify(value)} rejected: ${check.error}`);
        }
        if (fixture.behaviorProfile) assert.ok(BEHAVIOR_PROFILES[fixture.behaviorProfile], `${name}: unknown behaviour profile`);
    });
}

test('[T-1] production carries the approved mitigations: no past-conversation import, no shadow run', () => {
    const prod = loadSettingsProfile('production');
    assert.equal(prod.memory_use_past_conversations, false);
    assert.equal(prod.shadow_run_enabled, false);
});

test('[T-1] the audited configuration differs from current production in exactly the two mitigated settings', () => {
    const audit = readSettingsFixture('production-audit-2026-10').overrides;
    const prod = readSettingsFixture('production').overrides;
    const keys = new Set([...Object.keys(audit), ...Object.keys(prod)]);
    const differing = [...keys].filter((k) => JSON.stringify(audit[k]) !== JSON.stringify(prod[k])).sort();
    assert.deepEqual(differing, ['memory_use_past_conversations', 'shadow_run_enabled']);
    assert.equal(audit.memory_use_past_conversations, true);
    assert.equal(audit.shadow_run_enabled, true);
});

test('[T-1] production differs from the code defaults where the audit found it does (the risky flags are covered)', () => {
    const prod = loadSettingsProfile('production');
    for (const key of ['trust_boundary_enabled', 'trust_boundary_enforce', 'sparse_diagnostic_state', 'search_past_tickets', 'allow_smart_guess']) {
        assert.notEqual(prod[key], SIE_DEFAULT_SETTINGS[key], `${key} should differ from its default in production`);
    }
});

test('[T-1] profile precedence: defaults, then behaviour profile, then stored overrides', () => {
    const bold = loadSettingsProfile('bold');
    assert.equal(bold.answer_confidence, BEHAVIOR_PROFILES.bold.answer_confidence);
    assert.equal(bold.engine_enabled, SIE_DEFAULT_SETTINGS.engine_enabled);
    assert.deepEqual(loadSettingsProfile('defaults'), { ...SIE_DEFAULT_SETTINGS });
});
