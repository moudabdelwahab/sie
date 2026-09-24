/**
 * owner-editions.test.mjs — edition management is the platform owner's alone.
 *
 * The refusal itself lives in the database (migration 0010, proven by
 * sie-integration/tests/sql/owner-editions.test.sql against the production
 * authority functions). These tests prove the JavaScript half agrees with it:
 *
 *   - resolution: Free / Pro / Max work; unknown, missing or switched-off
 *     editions are Free — never a larger edition
 *   - the client sends edition changes ONLY through the owner RPCs, so there
 *     is no client path that writes an edition around them
 *   - the owner check fails closed
 *   - the one key pattern (which settings are "edition settings") is the
 *     same in JavaScript and in SQL
 *
 * @no-legitimate-corpus
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolveCustomerEdition, isEditionAvailable, isEditionSettingKey, EDITION_IDS } from '../editions.js';
import {
    isCurrentUserSieOwner, ownerSetCustomerEdition, saveSieSetting, adminSetAccess, getEditionOverview, EDITION_RPC_ERRORS
} from '../../../sie-integration/sie-entitlement.js';
import { SETTINGS } from '../../config/settings-schema.js';

const read = (rel) => readFile(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

/** A Supabase stand-in that records every call and answers from a script. */
function fakeSupabase(answers = {}) {
    const calls = [];
    return {
        calls,
        rpc: async (name, args) => {
            calls.push({ kind: 'rpc', name, args });
            const a = answers[name];
            if (a instanceof Error) throw a;
            return typeof a === 'function' ? a(args) : (a ?? { data: null, error: null });
        },
        from: (table) => ({
            upsert: async (row) => { calls.push({ kind: 'upsert', table, row }); return { error: null }; },
            select: async () => { calls.push({ kind: 'select', table }); return { data: [], error: null }; }
        })
    };
}

// ── resolution ──────────────────────────────────────────────────────────

test('resolution: Free, Pro and Max each resolve to themselves', () => {
    for (const id of EDITION_IDS) {
        assert.equal(resolveCustomerEdition({ accessRow: { edition: id }, settings: {} }), id);
        assert.equal(resolveCustomerEdition({ accessRow: { edition: null }, settings: { default_edition: id } }), id);
    }
});

test('resolution: unknown, missing or malformed editions are Free — never larger', () => {
    for (const bad of ['gold', 'MAX', 'Pro', '', ' max', 42, {}, [], undefined, null]) {
        assert.equal(resolveCustomerEdition({ accessRow: { edition: bad }, settings: {} }), 'free', `row ${JSON.stringify(bad)}`);
        assert.equal(resolveCustomerEdition({ accessRow: null, settings: { default_edition: bad } }), 'free', `default ${JSON.stringify(bad)}`);
    }
    assert.equal(resolveCustomerEdition(), 'free');
});

test('resolution: a switched-off edition is Free (not the edition below), for the row and for the default', () => {
    const off = { edition_max_enabled: false, edition_pro_enabled: false };
    assert.equal(resolveCustomerEdition({ accessRow: { edition: 'max' }, settings: { edition_max_enabled: false } }), 'free');
    assert.equal(resolveCustomerEdition({ accessRow: { edition: 'pro' }, settings: off }), 'free');
    assert.equal(resolveCustomerEdition({ accessRow: null, settings: { default_edition: 'max', edition_max_enabled: false } }), 'free');
    // Anything but true/unset is OFF: a malformed row fails closed.
    for (const v of ['yes', 'true', 1, 0, {}, 'false']) {
        assert.equal(isEditionAvailable('max', { edition_max_enabled: v }), false, `enabled=${JSON.stringify(v)}`);
    }
    assert.equal(isEditionAvailable('max', {}), true, 'not set = available (today\'s behaviour)');
    assert.equal(isEditionAvailable('free', { edition_free_enabled: false }), true, 'Free cannot be switched off');
});

// ── the owner check fails closed ────────────────────────────────────────

test('isCurrentUserSieOwner: true only for a literal true from sie_owner_authority()', async () => {
    assert.equal(await isCurrentUserSieOwner(fakeSupabase({ sie_owner_authority: { data: true, error: null } })), true);
    for (const answer of [
        { data: false, error: null }, { data: null, error: null }, { data: 'true', error: null }, { data: 1, error: null },
        { data: true, error: { message: 'function does not exist' } }, new Error('network down')
    ]) {
        const sb = fakeSupabase({ sie_owner_authority: answer });
        assert.equal(await isCurrentUserSieOwner(sb), false, JSON.stringify(answer?.data ?? String(answer)));
        assert.deepEqual(sb.calls.map((c) => c.name), ['sie_owner_authority'], 'asks the database, never compares an e-mail');
    }
});

// ── every edition write goes through the owner RPCs ─────────────────────

test('saving an edition setting calls the owner RPC, never writes sie_settings directly', async () => {
    const editionKeys = SETTINGS.filter((s) => isEditionSettingKey(s.key));
    assert.ok(editionKeys.length >= 24, `edition keys found: ${editionKeys.length}`);
    for (const def of editionKeys) {
        const sb = fakeSupabase({ sie_owner_set_edition_setting: { data: { ok: true }, error: null } });
        const value = def.type === 'boolean' ? true : def.type === 'enum' ? 'free' : def.default;
        const { error } = await saveSieSetting(sb, def.key, value);
        assert.equal(error, null, def.key);
        assert.deepEqual(sb.calls.map((c) => `${c.kind}:${c.name || c.table}`), ['rpc:sie_owner_set_edition_setting'], def.key);
    }
    // ...and a non-edition setting still goes straight to the table (unchanged).
    const sb = fakeSupabase();
    await saveSieSetting(sb, 'engine_enabled', true);
    assert.deepEqual(sb.calls.map((c) => `${c.kind}:${c.table}`), ['upsert:sie_settings']);
});

test('a refused edition setting surfaces the database\'s reason in Arabic', async () => {
    for (const [code, text] of Object.entries(EDITION_RPC_ERRORS)) {
        const sb = fakeSupabase({ sie_owner_set_edition_setting: { data: { ok: false, error: code }, error: null } });
        const { error } = await saveSieSetting(sb, 'default_edition', 'pro');
        assert.equal(error?.message, text, code);
    }
});

test('ownerSetCustomerEdition: one RPC; ok, refusal and transport error are all distinguishable', async () => {
    const ok = fakeSupabase({ sie_owner_set_customer_edition: { data: { ok: true, changed: true, edition: 'max' }, error: null } });
    const r1 = await ownerSetCustomerEdition(ok, 'u1', 'max');
    assert.equal(r1.error, null);
    assert.deepEqual(ok.calls, [{ kind: 'rpc', name: 'sie_owner_set_customer_edition', args: { p_user_id: 'u1', p_edition: 'max' } }]);

    const denied = fakeSupabase({ sie_owner_set_customer_edition: { data: { ok: false, error: 'forbidden' }, error: null } });
    assert.equal((await ownerSetCustomerEdition(denied, 'u1', 'max')).error?.message, EDITION_RPC_ERRORS.forbidden);

    const broken = fakeSupabase({ sie_owner_set_customer_edition: { data: null, error: { message: 'permission denied for function' } } });
    assert.match((await ownerSetCustomerEdition(broken, 'u1', 'max')).error?.message, /permission denied/);

    assert.ok((await ownerSetCustomerEdition(fakeSupabase(), '', 'max')).error, 'no user, no call');
});

test('adminSetAccess does not send an edition unless one is explicitly passed', async () => {
    const sb = fakeSupabase();
    await adminSetAccess(sb, { userId: 'u1', isEnabled: true, accessMode: 'unlimited' });
    assert.equal('p_edition' in sb.calls[0].args, false);
});

test('getEditionOverview never throws', async () => {
    assert.deepEqual((await getEditionOverview(fakeSupabase({ sie_owner_edition_overview: new Error('down') }))).rows, []);
    assert.deepEqual((await getEditionOverview(fakeSupabase({ sie_owner_edition_overview: { data: null, error: { message: 'x' } } }))).rows, []);
});

// ── one definition of "edition setting", in JS and SQL ─────────────────

test('the edition-key pattern is the same in JavaScript and in migration 0010', async () => {
    const sql = await read('../../../sie-integration/migrations/0010_sie_editions_owner_only.sql');
    assert.ok(sql.includes("p_key = 'default_edition' or p_key ~ '^edition_(free|pro|max)_[a-z_]+$'"), 'SQL pattern changed — update isEditionSettingKey too');
    for (const key of ['default_edition', 'edition_pro_enabled', 'edition_max_monthly_messages', 'edition_free_max_scenarios'])
        assert.equal(isEditionSettingKey(key), true, key);
    for (const key of ['edition_gold_enabled', 'editions', 'engine_enabled', 'rate_limit_enabled', 'xdefault_edition', 'edition_pro_', 'edition_pro_Enabled'])
        assert.equal(isEditionSettingKey(key), false, key);
});

// ── the console: no edition write that bypasses the owner path ─────────

test('the console writes editions only through the owner RPCs and gates edition controls on the owner check', async () => {
    const js = (await read('../../../sie-admin/settings.js'))
        .replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1');
    assert.match(js, /isCurrentUserSieOwner\(supabase\)/, 'the console asks the database who the owner is');
    assert.doesNotMatch(js, /mahmoud@|@mad3oom\.com/i, 'no owner e-mail in the console');
    assert.doesNotMatch(js, /\.from\(['"]customer_sie_access['"]\)\s*\.(update|upsert|insert)/, 'no direct write of the access table');
    assert.doesNotMatch(js, /edition:\s*\$\('aEdition'\)/, 'the access editor no longer sends the edition through sie_admin_set_access');
    assert.match(js, /isEditionSettingKey\(key\) \? state\.isOwner : state\.isStaff/, 'edition settings are editable by the owner only');
    assert.match(js, /\$\('editionAssignForm'\)\.hidden = !owner/, 'the assignment form is the owner\'s only');
    assert.match(js, /\$\('aEdition'\)\.disabled = !state\.isOwner/, 'the access editor\'s edition field is the owner\'s only');
});
