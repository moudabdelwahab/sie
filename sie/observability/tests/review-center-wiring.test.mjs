import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

/**
 * ------------------------------------------------------------
 * WHY THIS TEST EXISTS
 *
 * Same failure this codebase has already shipped once: settings.js read
 * two element ids that settings.html did not contain, and because
 * getElementById returns null instead of throwing, nothing broke at load
 * — it broke the first time a human opened the dialog. sie-admin has a
 * console-wiring test guarding that pair; the Review Center had none,
 * and it just grew a whole rate-limit panel whose every control is
 * reached by id.
 *
 * Crude on purpose — regex over source text rather than a DOM — because
 * the bug it catches is crude: an id on one side of the pair only.
 */

const read = (name) => readFile(fileURLToPath(new URL(`../admin-ui/${name}`, import.meta.url)), 'utf8');

/** `id="foo"` anywhere in the markup, including <template> contents. */
function idsInHtml(html) {
    return new Set([...html.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]));
}

/** `getElementById('foo')` — how review-center.js reaches the DOM. */
function idsUsedByJs(js) {
    return new Set([...js.matchAll(/getElementById\(\s*['"]([^'"]+)['"]\s*\)/g)].map((m) => m[1]));
}

test('every id the Review Center script reads exists in its markup', async () => {
    const [html, js] = await Promise.all([read('review-center.html'), read('review-center.js')]);
    const present = idsInHtml(html);
    const missing = [...idsUsedByJs(js)].filter((id) => !present.has(id));
    assert.deepEqual(missing, [], 'review-center.js reads ids that review-center.html does not define');
});

test('the rate-limit panel is wired end to end', async () => {
    const [html, js] = await Promise.all([read('review-center.html'), read('review-center.js')]);
    const present = idsInHtml(html);
    const used = idsUsedByJs(js);

    // The controls an admin actually needs to manage a limit. Listed
    // explicitly rather than derived, so deleting one from the HTML fails
    // here instead of silently removing a capability from the page.
    const required = [
        'cust-rl-effective', 'cust-rl-remaining', 'cust-rl-window',
        'cust-rl-meter', 'cust-rl-pressure',
        'cust-rl-enabled', 'cust-rl-rpm', 'cust-rl-burst', 'cust-rl-notes',
        'cust-rl-save-btn', 'cust-rl-reset-btn', 'cust-rl-saved-flag'
    ];
    for (const id of required) {
        assert.ok(present.has(id), `markup is missing #${id}`);
        assert.ok(used.has(id), `review-center.js never reads #${id}`);
    }
});

test('rate limits are reached through the runtime, not a deeper import', async () => {
    const js = await read('review-center.js');
    // The architecture rule: sie-runtime.js is the only public surface.
    // A console that reached into sie-entitlement.js directly would work
    // today and break the next time that file is reorganised.
    for (const fn of ['getRateLimitStatus', 'adminSetRateLimit', 'adminResetRateLimit', 'describeRateLimitPressure']) {
        assert.match(js, new RegExp(`\\b${fn}\\b`), `${fn} is not used by the Review Center`);
    }
    assert.match(js, /from '\/sie-integration\/sie-runtime\.js'/);
    assert.doesNotMatch(js, /from '.*sie-entitlement\.js'/, 'must not import the internal module directly');
});

test('the customers table header and body row have the same column count', async () => {
    const html = await read('review-center.html');
    // Adding the rate-limit column to one and not the other silently
    // shears every cell in the table one place to the left.
    const customersPanel = html.slice(html.indexOf('id="panel-customers"'), html.indexOf('id="panel-ai-fallback"'));
    const headerBlock = customersPanel.slice(customersPanel.indexOf('<thead>'), customersPanel.indexOf('</thead>'));
    const headerCount = [...headerBlock.matchAll(/<th\b/g)].length;

    const js = await readFile(fileURLToPath(new URL('../admin-ui/review-center.js', import.meta.url)), 'utf8');
    const rowTemplate = js.slice(js.indexOf('<tr data-id="${escapeHtml(c.id)}">'), js.indexOf('</tr>', js.indexOf('<tr data-id="${escapeHtml(c.id)}">')));
    const cellCount = [...rowTemplate.matchAll(/<td\b/g)].length;

    assert.equal(cellCount, headerCount, `header has ${headerCount} columns but each row renders ${cellCount}`);
});
