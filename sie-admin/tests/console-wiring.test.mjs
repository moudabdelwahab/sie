import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

/**
 * ------------------------------------------------------------
 * WHY THIS TEST EXISTS
 *
 * settings.js read `$('fLabelEn')` and `$('fTextEn')` for months while
 * settings.html contained neither. `document.getElementById` returns null
 * rather than throwing, so nothing failed at load — it failed the moment
 * anyone opened the scenario editor, with a TypeError and a dialog full
 * of nothing. No test could have caught it, because there was no test
 * that looked at both files at once.
 *
 * This is that test. It is deliberately crude — a regex over source text,
 * not a DOM — because the failure it prevents is crude: an id that exists
 * on one side of the pair and not the other.
 */

const read = (name) => readFile(fileURLToPath(new URL(`../${name}`, import.meta.url)), 'utf8');

/** `id="foo"` anywhere in the markup, templates and dialogs included. */
function idsInHtml(html) {
    return new Set([...html.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]));
}

/** `$('foo')` — the console's only element lookup. */
function idsUsedByJs(js) {
    return [...js.matchAll(/\$\('([^']+)'\)/g)].map((m) => m[1]);
}

test('كل عنصر بيستخدمه settings.js موجود في settings.html', async () => {
    const [html, js] = await Promise.all([read('settings.html'), read('settings.js')]);
    const declared = idsInHtml(html);

    const missing = [...new Set(idsUsedByJs(js))].filter((id) => !declared.has(id));
    assert.deepEqual(missing, [], `عناصر بيتنده عليها ومش موجودة: ${missing.join(', ')}`);
});

test('صفحة الدخول كمان', async () => {
    const [html, js] = await Promise.all([read('login.html'), read('login.js')]);
    const declared = idsInHtml(html);

    const missing = [...new Set(idsUsedByJs(js))].filter((id) => !declared.has(id));
    assert.deepEqual(missing, [], `عناصر بيتنده عليها ومش موجودة: ${missing.join(', ')}`);
});

test('كل حاجة settings.js بيستوردها من sie-runtime موجودة فعلاً', async () => {
    const js = await read('settings.js');
    const block = js.match(/import\s*\{([^}]+)\}\s*from\s*'\.\.\/sie-integration\/sie-runtime\.js'/);
    assert.ok(block, 'مالقيتش استيراد sie-runtime');

    const wanted = block[1].split(',').map((s) => s.trim()).filter(Boolean);
    const runtime = await import('../../sie-integration/sie-runtime.js');

    const missing = wanted.filter((name) => !(name in runtime));
    assert.deepEqual(missing, [], `مستورد ومش موجود في الـ runtime: ${missing.join(', ')}`);
});

test('التبويب اسمه «السيناريوهات» مش «الحالات»', async () => {
    const html = await read('settings.html');
    assert.ok(html.includes('>السيناريوهات<'));
    assert.ok(!html.includes('الحالات اللي بيفهمها'));
});

test('الصفحة الرئيسية فيها زرار دخول بيوصّل لـ sie-admin/login.html', async () => {
    const html = await readFile(fileURLToPath(new URL('../../index.html', import.meta.url)), 'utf8');
    assert.ok(html.includes('./sie-admin/login.html'), 'مافيش لينك لصفحة الدخول');
    assert.ok(html.includes('تسجيل الدخول'));
});

test('النموذج اللي زرار التنزيل بيجيبه موجود على القرص', async () => {
    const js = await read('settings.js');
    const path = js.match(/const TEMPLATE_PATH = '([^']+)'/)?.[1];
    assert.ok(path, 'مالقيتش TEMPLATE_PATH');

    // النص ده relative لـ sie-admin/، وده بالظبط اللي المتصفح هيطلبه.
    const onDisk = fileURLToPath(new URL(`../${path}`, import.meta.url));
    const contents = await readFile(onDisk, 'utf8');
    assert.ok(contents.includes('# سيناريو:'), 'النموذج مافيهوش أي مثال');
});
