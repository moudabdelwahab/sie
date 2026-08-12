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

// ── حد معدل الطلبات ─────────────────────────────────────────────────
//
// The limit is managed here, in the same dialog as the customer's quota:
// quota answers "how many messages in total", the rate limit answers "how
// fast", and they are the same customer. These guard the parts that fail
// silently — a control the script reads but the markup never defines, or
// a table header with no matching cell.

test('نافذة الصلاحية فيها كل عناصر حد المعدل', async () => {
    const [html, js] = await Promise.all([read('settings.html'), read('settings.js')]);
    const ids = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]));
    const used = new Set([...js.matchAll(/\$\(\s*'([^']+)'\s*\)/g)].map((m) => m[1]));

    // كل دي بيقراها السكربت فعلاً — أي واحدة ناقصة من الـ HTML معناها
    // TypeError أول ما حد يفتح النافذة، من غير أي فشل وقت التحميل.
    for (const id of ['rlEffective', 'rlRemaining', 'rlWindow', 'rlMeter', 'rlPressure',
                      'rlEnabled', 'rlRpm', 'rlBurst', 'rlNotes', 'resetRateLimitBtn']) {
        assert.ok(ids.has(id), `العنصر #${id} مش موجود في settings.html`);
        assert.ok(used.has(id), `settings.js مابيقراش #${id}`);
    }
    // ده حاوية شكلية بس، فمطلوب وجودها من غير ما السكربت يقراها.
    assert.ok(ids.has('rlLive'), 'العنصر #rlLive مش موجود في settings.html');
});

test('عمود حد المعدل موجود في الترويسة وفي الصف', async () => {
    const [html, js] = await Promise.all([read('settings.html'), read('settings.js')]);
    // زيادة <th> من غير <td> بتزحلق كل خانة في الجدول مكان واحد.
    const usersTable = html.slice(html.indexOf('id="tab-users"'), html.indexOf('</section>', html.indexOf('id="tab-users"')));
    const headerCount = [...usersTable.slice(usersTable.indexOf('<thead>'), usersTable.indexOf('</thead>')).matchAll(/<th\b/g)].length;

    const rowStart = js.indexOf('<tr>\n          <td><b>${esc(u.name)}</b>');
    const rowTemplate = js.slice(rowStart, js.indexOf('</tr>', rowStart));
    const cellCount = [...rowTemplate.matchAll(/<td\b/g)].length;

    assert.equal(cellCount, headerCount, `الترويسة فيها ${headerCount} عمود والصف بيرسم ${cellCount}`);
});

test('حد المعدل بيتقرا من الـ runtime مش من ملف داخلي', async () => {
    const js = await read('settings.js');
    for (const fn of ['getRateLimitStatus', 'adminSetRateLimit', 'adminResetRateLimit', 'describeRateLimitPressure']) {
        assert.match(js, new RegExp(`\\b${fn}\\b`), `${fn} مش مستخدم في اللوحة`);
    }
    assert.doesNotMatch(js, /from\s+['"][^'"]*sie-entitlement\.js['"]/, 'ممنوع الاستيراد المباشر من الملف الداخلي');
});

test('الخانة الفاضية معناها «ورث» مش صفر', async () => {
    const js = await read('settings.js');
    const fn = js.slice(js.indexOf('async function saveRateLimitFields'));
    // لو الفاضي اتحوّل لصفر، كل حفظ هيحط للعميل حد صفر بدل ما يسيبه يورث.
    assert.match(fn, /rpmRaw === '' \? null/);
    assert.match(fn, /burstRaw === '' \? null/);
    assert.match(fn, /choice === 'inherit' \? null/);
});

test('مركز المراجعة مابقاش فيه أي تحكم في حد المعدل', async () => {
    const rc = await readFile(fileURLToPath(new URL('../../sie/observability/admin-ui/review-center.js', import.meta.url)), 'utf8');
    for (const fn of ['adminSetRateLimit', 'adminResetRateLimit', 'getRateLimitStatus']) {
        assert.ok(!rc.includes(fn), `${fn} لسه موجود في مركز المراجعة — المفروض التحكم في مكان واحد بس`);
    }
});

test('الأرقام تتكتب مش تتسحب بس', async () => {
    const js = await read('settings.js');
    const render = js.slice(js.indexOf("if (def.type === 'number')"), js.indexOf('// enum'));

    // خانة رقم حقيقية جنب الشريط. من غيرها الرقم بيتحدد بالمؤشر بس،
    // والشريط اللي مداه بالآلاف مستحيل يوصّل لرقم بعينه.
    assert.match(render, /type="number" class="num-box"/);
    assert.match(render, /min="\$\{def\.min\}" max="\$\{def\.max\}"/);

    const wire = js.slice(js.indexOf("if (type === 'number')"), js.indexOf("row.querySelectorAll('input[type=radio]')"));
    assert.match(wire, /const box = row\.querySelector\('\.num-box'\)/);
    // الشريط والخانة لازم يفضلوا متطابقين في الاتجاهين.
    assert.match(wire, /range\.addEventListener\('input'/);
    assert.match(wire, /box\.addEventListener\('input'/);
    // الحفظ على change مش على كل حرف: «١» في طريقها لـ«١٠٠» قيمة
    // حقيقية المحرك كان هيطيعها للحظة.
    assert.match(wire, /box\.addEventListener\('change', commitBox\)/);
    assert.match(wire, /if \(e\.key === 'Enter'\)/);
    // الحد بيتقصّ هنا: رقم بره المدى بيفضل شكله سليم في المتصفح
    // والقاعدة هي اللي بترفضه برسالة محدش هيربطها باللي كتبه.
    assert.match(wire, /Math\.min\(Math\.max\(n, def\.min\), def\.max\)/);
});

test('مدى الشريط للأرقام يقدر يوصّل للقيمة الافتراضية', async () => {
    const { SETTINGS } = await import('../../sie/config/settings-schema.js');
    // شريط من ١ لـ١٠٠٠٠٠ مستحيل يختار ١٠٠. الافتراضي لازم يكون على
    // خطوة صحيحة من الحد الأدنى، وإلا السحب عمره ما هيقف عليه.
    for (const def of SETTINGS.filter((d) => d.type === 'number')) {
        const steps = (def.default - def.min) / (def.step || 1);
        assert.ok(Number.isInteger(Number(steps.toFixed(6))),
            `${def.key}: القيمة الافتراضية ${def.default} مش على خطوة من ${def.min} بمقدار ${def.step}`);
        assert.ok(def.default >= def.min && def.default <= def.max, `${def.key}: الافتراضي بره المدى`);
    }
});
