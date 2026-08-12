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

test('القسم اسمه «السيناريوهات» مش «الحالات»', async () => {
    const [html, js] = await Promise.all([read('settings.html'), read('settings.js')]);
    // أسماء الأقسام بقت في وصف الأقسام جوه settings.js، مش مكتوبة في الـHTML.
    assert.match(js, /label: 'السيناريوهات'/);
    assert.ok(!html.includes('الحالات اللي بيفهمها'));
    assert.ok(!js.includes('الحالات اللي بيفهمها'));
});

// ── هيكل التطبيق ────────────────────────────────────────────────────
//
// نفس منطق الاختبار الأول، بس للطبقة اللي اتفصلت في إعادة التصميم:
// الشِل والعناصر المشتركة بينادوا على عناصر بالـid زي أي كود تاني،
// وفشلهم بيبقى صامت بنفس الطريقة.

const UI_FILES = ['ui/app-shell.js', 'ui/components.js'];

test('كل عنصر بينده عليه الشِل والعناصر المشتركة موجود في settings.html', async () => {
    const html = await read('settings.html');
    const declared = idsInHtml(html);

    for (const file of UI_FILES) {
        const source = await read(file);
        const used = [...source.matchAll(/getElementById\('([^']+)'\)/g)].map((m) => m[1]);
        const missing = [...new Set(used)].filter((id) => !declared.has(id));
        assert.deepEqual(missing, [], `${file}: عناصر بيتنده عليها ومش موجودة: ${missing.join(', ')}`);
    }
});

test('كل قسم في القائمة الجانبية له لوحة في الـHTML', async () => {
    const [html, js] = await Promise.all([read('settings.html'), read('settings.js')]);

    const viewIds = [...js.matchAll(/^\s*id: '([a-z]+)', label: '/gm)].map((m) => m[1]);
    assert.ok(viewIds.length >= 5, `مالقيتش وصف الأقسام (لقيت ${viewIds.length})`);

    const panels = new Set([...html.matchAll(/data-view-panel="([^"]+)"/g)].map((m) => m[1]));
    const missing = viewIds.filter((id) => !panels.has(id));
    assert.deepEqual(missing, [], `أقسام في القائمة من غير لوحة: ${missing.join(', ')}`);
});

test('الأيقونات كلها من نظام الأيقونات — مفيش إيموجي في الواجهة', async () => {
    const [html, js] = await Promise.all([read('settings.html'), read('settings.js')]);
    // نطاق الإيموجي الأساسي. الرموز العربية والعلامات مش داخلة فيه.
    const emoji = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u;
    assert.doesNotMatch(html, emoji, 'فيه إيموجي في settings.html');
    assert.doesNotMatch(js, emoji, 'فيه إيموجي في settings.js');
});

test('كل الأيقونات المطلوبة موجودة في نظام الأيقونات', async () => {
    const [js, shellSource] = await Promise.all([read('settings.js'), read('ui/app-shell.js')]);
    const { iconNames } = await import('../ui/icons.js');

    const asked = new Set([
        ...[...js.matchAll(/icon\('([a-zA-Z]+)'/g)].map((m) => m[1]),
        ...[...shellSource.matchAll(/icon\('([a-zA-Z]+)'/g)].map((m) => m[1]),
        // أيقونات الأقسام بتتكتب كـ iconName في وصف القسم.
        ...[...js.matchAll(/iconName: '([a-zA-Z]+)'/g)].map((m) => m[1])
    ]);

    const missing = [...asked].filter((name) => !iconNames.includes(name));
    assert.deepEqual(missing, [], `أيقونات مطلوبة ومش متعرّفة: ${missing.join(', ')}`);
});

test('الصفحات بتحمّل نظام التصميم مرة واحدة وبس', async () => {
    for (const page of ['settings.html', 'login.html']) {
        const html = await read(page);
        assert.ok(html.includes('./design-system.css'), `${page} مش بيحمّل نظام التصميم`);
        assert.ok(html.includes('./sie-admin.css'), `${page} مش بيحمّل ستايل الصفحات`);
        // الملف ده اتشال، وتوكناته بقت جوه design-system.css.
        assert.ok(!html.includes('base-theme.css'), `${page} لسه بيحمّل ملف اتشال`);
    }
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
    const panelStart = html.indexOf('data-view-panel="users"');
    const usersTable = html.slice(panelStart, html.indexOf('</section>', panelStart));
    const headerCount = [...usersTable.slice(usersTable.indexOf('<thead>'), usersTable.indexOf('</thead>')).matchAll(/<th\b/g)].length;

    // علامة ثابتة في المصدر: الصف بيتغيّر شكله، والاختبار مايتغيرش معاه.
    const rowStart = js.indexOf('/* USERS_ROW_TEMPLATE');
    assert.ok(rowStart > 0, 'مالقيتش علامة صف المستخدمين في settings.js');
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

// ── توحيد إدارة الحصص ────────────────────────────────────────────────

test('حساب الكوتة مستورد مش متكرر', async () => {
    const js = await read('settings.js');
    // نفس الدالة اللي صفحتَي الكوتة كانت بتستخدمها. لو اللوحة حسبت
    // «قرّب من الحد» بنفسها، الرقمين هيختلفوا ومحدش هيعرف مين الصح.
    assert.match(js, /import \{ quotaMetrics, quotaStatus \} from '\.\.\/sie\/quota-ui\/quota-metrics\.js'/);
    assert.match(js, /sieQuotaService/);
    assert.doesNotMatch(js, /percentage\s*=\s*Math\.round/, 'اللوحة بتحسب النسبة بنفسها بدل ما تستورد الحساب');
});

test('الصفحتين القديمتين بيحوّلوا مش بيشتغلوا', async () => {
    const { readFile } = await import('node:fs/promises');
    for (const rel of ['../../sie/observability/admin-ui/quota-management.html', '../../sie/quota-ui/user-quota-dashboard.html']) {
        const html = await readFile(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');
        // اتسابوا كتحويل مش اتمسحوا، عشان أي لينك محفوظ عند حد يفضل شغّال.
        assert.match(html, /http-equiv="refresh"/, `${rel} لسه صفحة شغّالة مش تحويل`);
        assert.match(html, /sie-admin\/settings\.html/, `${rel} بيحوّل لمكان غلط`);
    }
});

test('مركز المراجعة مابقاش بيوصّل لصفحة الحصص القديمة', async () => {
    const { readFile } = await import('node:fs/promises');
    const html = await readFile(fileURLToPath(new URL('../../sie/observability/admin-ui/review-center.html', import.meta.url)), 'utf8');
    assert.ok(!html.includes('quota-management.html'), 'لسه فيه لينك لصفحة اتنقلت');
});
