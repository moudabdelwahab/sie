/**
 * public-api-sql.test.mjs — هجرة الـAPI العام على Postgres حقيقي
 * ============================================================
 * الاختبار ده بيطبّق `0009_add_public_api.sql` **حرفيًا** على قاعدة
 * Postgres حقيقية وبيشغّل عليها الحالات اللي بتفرق: مين يقدر ينشئ مفتاح،
 * إيه اللي بيتخزن منه، والمفتاح الملغي/المنتهي بيترفض إزاي.
 *
 * ── ليه SQL حقيقي مش محاكاة ──────────────────────────────────
 * أخطر حاجة في الملف ده هي `security definer` وسطور المنع والمنح. حاجة
 * زي دي مابتفشلش وقت الكتابة — بتفشل يوم ما حد ينادي الدالة من دور
 * مالوش حق، وساعتها بتبقى تسريب. محاكاة قاعدة البيانات مش هتكتشف ده
 * أبدًا لأنها مافيهاش أدوار أصلاً.
 *
 * ── التشغيل ─────────────────────────────────────────────────
 * محتاج `psql` + سيرفر Postgres. بيتخطى نفسه لو مفيش:
 *
 *   PGHOST=/var/tmp/siepg/sock PGUSER=postgres \
 *     node --test sie-integration/tests/public-api-sql.test.mjs
 *
 * الاتصال بيتقرا من متغيرات البيئة العادية بتاعة libpq (PGHOST/PGUSER/…)
 * أو من DATABASE_URL. بينشئ قاعدة مؤقتة وبيمسحها في الآخر.
 */
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const REPO = fileURLToPath(new URL('../..', import.meta.url));
const DB = `sie_api_test_${process.pid}`;

/** بيتنفذ استعلام ويرجّع النص الخام (tuples only). */
function psql(sql, { db = DB, expectError = false } = {}) {
    try {
        // -q عشان psql مايطبعش «INSERT 0 1» جنب نتيجة الـRETURNING.
        return execFileSync('psql', ['-tAqX', '-v', 'ON_ERROR_STOP=1', '-d', db, '-c', sql], {
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'pipe']
        }).trim();
    } catch (err) {
        if (expectError) return `ERROR: ${err.stderr || err.message}`;
        throw new Error(`${err.stderr || err.message}\n--- sql ---\n${sql}`);
    }
}

function psqlFile(path, { db = DB } = {}) {
    execFileSync('psql', ['-qX', '-v', 'ON_ERROR_STOP=1', '-d', db, '-f', `${REPO}${path}`], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe']
    });
}

/**
 * بيشغّل SQL كأنه متصل معيّن.
 * `set local role` بيغيّر الدور فعلاً، فمنع الصلاحيات في الهجرة بيتنفّذ
 * زي ما هيتنفّذ على Supabase بالظبط.
 */
function asRole(role, sql, { uid = null, admin = false, staff = false, expectError = false } = {}) {
    const settings = [
        `select set_config('request.jwt.claim.role', ${quote(role)}, true)`,
        `select set_config('request.jwt.claim.sub', ${uid ? quote(uid) : "''"}, true)`,
        `select set_config('sie.test.is_admin', ${admin ? "'true'" : "'false'"}, true)`,
        `select set_config('sie.test.is_staff', ${staff ? "'true'" : "'false'"}, true)`
    ].join(';\n');
    return psql(`begin;\nset local role ${role};\n${settings};\n${sql};\ncommit;`, { expectError });
}

const quote = (value) => `'${String(value).replace(/'/g, "''")}'`;

/** آخر سطر غير فاضي — نتيجة الاستعلام المهم في دفعة فيها set_config. */
const lastLine = (output) => output.split('\n').filter((l) => l.trim()).pop() ?? '';

let available = true;
let userA = '';
let userB = '';

before(() => {
    try {
        execFileSync('psql', ['-tAX', '-c', 'select 1'], { stdio: 'ignore' });
    } catch {
        available = false;
        return;
    }
    execFileSync('psql', ['-tAX', '-c', `drop database if exists ${DB}`], { stdio: 'ignore' });
    execFileSync('psql', ['-tAX', '-c', `create database ${DB}`], { stdio: 'ignore' });

    psqlFile('/sie-integration/tests/fixtures/supabase-stub.sql');
    psqlFile('/sie-integration/migrations/0008_add_api_rate_limiting.sql');
    psqlFile('/sie-integration/migrations/0009_add_public_api.sql');

    userA = psql(`insert into auth.users (email) values ('a@example.com') returning id`);
    userB = psql(`insert into auth.users (email) values ('b@example.com') returning id`);
    psql(`insert into public.customer_sie_access (user_id, is_enabled) values ('${userA}', true), ('${userB}', true)`);
});

after(() => {
    if (!available) return;
    try {
        execFileSync('psql', ['-tAX', '-c', `drop database if exists ${DB} with (force)`], { stdio: 'ignore' });
    } catch { /* القاعدة المؤقتة مش مشكلة لو فضلت */ }
});

const skip = () => (available ? false : 'مفيش Postgres — الاختبار اتخطى');

/** بينشئ مفتاح كمسؤول محرك ويرجّع {id, key}. */
function createKey({ user = userA, name = 'Production', env = 'live', expires = null } = {}) {
    const out = asRole('authenticated', `
        select id || '|' || api_key
          from public.sie_api_key_create(${quote(user)}, ${quote(name)}, ${quote(env)},
               ${expires ? `${quote(expires)}::timestamptz` : 'null'})`,
        { uid: user, admin: true });
    const [id, key] = lastLine(out).split('|');
    return { id, key };
}

const sha256 = (value) => psql(`select encode(extensions.digest(${quote(value)}, 'sha256'), 'hex')`);

// ── الإنشاء ─────────────────────────────────────────────────────────
test('إنشاء المفتاح متاح لمسؤول المحرك بس', { skip: skip() }, () => {
    const denied = asRole('authenticated', `
        select api_key from public.sie_api_key_create(${quote(userA)}, 'Nope', 'live', null)`,
        { uid: userA, admin: false, expectError: true });
    assert.match(denied, /access denied/, 'حساب عادي قدر ينشئ مفتاح');

    const anon = asRole('anon', `
        select api_key from public.sie_api_key_create(${quote(userA)}, 'Nope', 'live', null)`,
        { expectError: true });
    assert.match(anon, /ERROR/, 'anon قدر ينشئ مفتاح');
});

test('المفتاح بصيغة معروفة، والقيمة الخام مابتتخزنش', { skip: skip() }, () => {
    const { id, key } = createKey({ name: 'Production' });

    assert.match(key, /^sie_live_[A-Za-z0-9_-]{43}$/, `صيغة المفتاح غير متوقعة: ${key.slice(0, 12)}…`);

    // أهم تأكيد في الملف: القيمة الخام مش موجودة في أي عمود.
    const found = psql(`
        select count(*) from public.sie_api_keys
         where key_hash = ${quote(key)} or key_prefix = ${quote(key)} or name = ${quote(key)}`);
    assert.equal(found, '0', 'المفتاح الخام اتخزن في عمود');

    const row = psql(`select key_prefix || '|' || key_last4 || '|' || key_hash from public.sie_api_keys where id = ${quote(id)}`);
    const [prefix, last4, hash] = row.split('|');
    assert.equal(prefix, key.slice(0, 16));
    assert.equal(last4, key.slice(-4));
    assert.equal(hash, sha256(key), 'الهاش المخزّن مش sha256 للمفتاح');
    assert.notEqual(hash, key);
});

// ── التحقق ──────────────────────────────────────────────────────────
test('التحقق بيرجّع العميل، ولـservice_role بس', { skip: skip() }, () => {
    const { key } = createKey();
    const hash = sha256(key);

    const ok = asRole('service_role', `select coalesce(user_id::text, 'null') || '|' || coalesce(reason, 'ok')
        from public.sie_api_key_verify(${quote(hash)})`);
    assert.equal(lastLine(ok), `${userA}|ok`);

    // نفس النداء من دور عادي لازم يترفض — ده الفرق بين مفتاح آمن ووسيلة
    // تخمين هاشات.
    const denied = asRole('authenticated', `select user_id from public.sie_api_key_verify(${quote(hash)})`,
        { uid: userA, admin: true, expectError: true });
    assert.match(denied, /ERROR/, 'authenticated قدر يتحقق من مفتاح');
});

test('مفتاح مش موجود بيرجّع invalid من غير ما يقول أكتر', { skip: skip() }, () => {
    const out = asRole('service_role',
        `select coalesce(user_id::text, 'null') || '|' || coalesce(reason, 'ok')
           from public.sie_api_key_verify(${quote('0'.repeat(64))})`);
    assert.equal(lastLine(out), 'null|invalid');
});

test('آخر استخدام بيتكتب مع التحقق نفسه', { skip: skip() }, () => {
    const { id, key } = createKey();
    assert.equal(psql(`select last_used_at is null from public.sie_api_keys where id = ${quote(id)}`), 't');

    asRole('service_role', `select 1 from public.sie_api_key_verify(${quote(sha256(key))})`);
    assert.equal(psql(`select last_used_at is not null from public.sie_api_keys where id = ${quote(id)}`), 't');
});

// ── الإلغاء والانتهاء والتدوير ──────────────────────────────────────
test('المفتاح الملغي بيترفض', { skip: skip() }, () => {
    const { id, key } = createKey();
    const revoked = asRole('authenticated', `select public.sie_api_key_revoke(${quote(id)})`, { uid: userA, admin: true });
    assert.equal(lastLine(revoked), 't');

    const out = asRole('service_role', `select coalesce(user_id::text, 'null') || '|' || coalesce(reason, 'ok')
        from public.sie_api_key_verify(${quote(sha256(key))})`);
    assert.equal(lastLine(out), 'null|revoked', 'مفتاح ملغي لسه بيشتغل');
});

test('المفتاح المنتهي بيترفض من غير ما حد يلغيه', { skip: skip() }, () => {
    const { key } = createKey({ expires: '2020-01-01T00:00:00Z' });
    const out = asRole('service_role', `select coalesce(user_id::text, 'null') || '|' || coalesce(reason, 'ok')
        from public.sie_api_key_verify(${quote(sha256(key))})`);
    assert.equal(lastLine(out), 'null|expired');
});

test('التدوير بينشئ مفتاح جديد ويلغي القديم في معاملة واحدة', { skip: skip() }, () => {
    const { id: oldId, key: oldKey } = createKey({ name: 'CI' });

    const rotated = asRole('authenticated',
        `select id || '|' || api_key from public.sie_api_key_rotate(${quote(oldId)})`,
        { uid: userA, admin: true });
    const [newId, newKey] = lastLine(rotated).split('|');

    assert.notEqual(newKey, oldKey);
    assert.equal(psql(`select status from public.sie_api_keys where id = ${quote(oldId)}`), 'revoked');
    assert.equal(psql(`select rotated_from from public.sie_api_keys where id = ${quote(newId)}`), oldId);
    assert.equal(psql(`select name from public.sie_api_keys where id = ${quote(newId)}`), 'CI', 'الاسم ماتنقلش مع التدوير');

    const out = asRole('service_role', `select coalesce(user_id::text, 'null') from public.sie_api_key_verify(${quote(sha256(newKey))})`);
    assert.equal(lastLine(out), userA, 'المفتاح الجديد مابيشتغلش');
});

// ── القراءة والعزل ──────────────────────────────────────────────────
test('القائمة مافيهاش أي عمود سري', { skip: skip() }, () => {
    const columns = psql(`
        select pg_get_function_result(oid) from pg_proc where proname = 'sie_api_key_list'`);
    assert.ok(!columns.includes('key_hash'), `القائمة بترجّع الهاش: ${columns}`);
    assert.ok(!columns.includes('api_key'), `القائمة بترجّع المفتاح: ${columns}`);
});

test('العميل بيشوف مفاتيحه هو بس', { skip: skip() }, () => {
    createKey({ user: userA });
    createKey({ user: userB });

    const mine = asRole('authenticated', `select count(*) from public.sie_api_key_list(null)`, { uid: userB });
    const owners = asRole('authenticated', `select count(distinct user_id) from public.sie_api_key_list(null)`, { uid: userB });
    assert.equal(lastLine(owners), '1', 'العميل شاف مفاتيح غيره');
    assert.ok(Number(lastLine(mine)) >= 1);

    const asAdmin = asRole('authenticated', `select count(distinct user_id) from public.sie_api_key_list(null)`,
        { uid: userA, admin: true });
    assert.equal(lastLine(asAdmin), '2', 'المسؤول مش شايف كل المفاتيح');
});

test('RLS على الجدول نفسه بيمنع قراءة صفوف غيرك', { skip: skip() }, () => {
    const seen = asRole('authenticated', `select count(*) from public.sie_api_keys where user_id = ${quote(userA)}`, { uid: userB });
    assert.equal(lastLine(seen), '0', 'العميل قرا صف مفتاح لعميل تاني');
});

// ── السجل والاستخدام ────────────────────────────────────────────────
test('تسجيل الطلب لـservice_role بس، والملخص بيعدّه', { skip: skip() }, () => {
    const { id } = createKey({ user: userB, name: 'Logging' });

    const denied = asRole('authenticated',
        `select public.sie_api_log_request('req_1', ${quote(id)}, ${quote(userB)}, 'POST', '/api/v1/chat', 200, null, 12)`,
        { uid: userB, admin: true, expectError: true });
    assert.match(denied, /ERROR/, 'حساب عادي قدر يكتب في السجل');

    for (const [status, code] of [[200, null], [200, null], [429, 'rate_limited'], [401, 'invalid_api_key']]) {
        asRole('service_role', `select public.sie_api_log_request('req_x', ${quote(id)}, ${quote(userB)},
            'POST', '/api/v1/chat', ${status}, ${code ? quote(code) : 'null'}, 30)`);
    }

    const summary = asRole('authenticated', `
        select total_requests || '|' || ok_requests || '|' || error_requests || '|' || rate_limited
          from public.sie_api_usage_summary(${quote(userB)}, null)`, { uid: userB });
    assert.equal(lastLine(summary), '4|2|2|1');
});

test('الاستخدام بيتفلتر حسب العميل', { skip: skip() }, () => {
    const other = asRole('authenticated',
        `select total_requests from public.sie_api_usage_summary(${quote(userB)}, null)`, { uid: userA });
    // userA مش أدمن هنا، فالنطاق بيتقص على صفوفه هو — وهو ماكتبش أي طلب.
    assert.equal(lastLine(other), '0', 'عميل شاف استهلاك عميل تاني');
});

// ── حد المعدل ───────────────────────────────────────────────────────
test('حد المعدل بيشتغل على نداءات المفتاح، ولـservice_role بس', { skip: skip() }, () => {
    psql(`insert into public.sie_settings (key, value) values
            ('rate_limit_enabled', 'true'::jsonb),
            ('rate_limit_requests_per_minute', '2'::jsonb),
            ('rate_limit_burst', '0'::jsonb)
          on conflict (key) do update set value = excluded.value`);

    const denied = asRole('authenticated', `select allowed from public.sie_api_rate_limit_hit(${quote(userA)}, null)`,
        { uid: userA, admin: true, expectError: true });
    assert.match(denied, /ERROR/, 'حساب عادي قدر يصرف من الدلو');

    const results = [];
    for (let i = 0; i < 4; i += 1) {
        results.push(lastLine(asRole('service_role',
            `select allowed || '|' || remaining || '|' || retry_after
               from public.sie_api_rate_limit_hit(${quote(userA)}, '1.2.3.4')`)));
    }

    assert.equal(results[0].split('|')[0], 'true', 'أول طلب اترفض');
    const blocked = results.filter((r) => r.startsWith('false'));
    assert.ok(blocked.length >= 1, `الحد ٢/دقيقة و٤ طلبات عدّوا كلهم: ${results.join(' , ')}`);
    assert.ok(Number(blocked[0].split('|')[2]) >= 1, 'المرفوض مافيهوش retry_after');
});

test('الـAPI والمتصفح بيستهلكوا نفس الدلو', { skip: skip() }, () => {
    // نفس مساحة المفاتيح: user:<uuid>. لو اتفصلوا، العميل بياخد الحد مرتين.
    const key = lastLine(asRole('service_role',
        `select key_used from public.sie_api_rate_limit_hit(${quote(userB)}, null)`));
    assert.equal(key, `user:${userB}`);
});

/**
 * انحدار: الحد كان مقفول فعليًا على أي عميل مالوش صف استثناء.
 *
 * `SELECT ... INTO` في PL/pgSQL بيحط NULL في كل المتغيرات لما مايلاقيش
 * صف، فقراءة الاستثناء كانت بتمسح الإعداد العام. أغلب العملاء مالهمش
 * صف استثناء أصلاً، فالنتيجة كانت enabled=false للجميع تقريبًا —
 * والدالة القديمة (هجرة 0008) هي اللي بتحمي مسار المتصفح كله.
 */
test('الحد شغّال على عميل مالوش صف استثناء (انحدار)', { skip: skip() }, () => {
    psql(`insert into public.sie_settings (key, value) values
            ('rate_limit_enabled', 'true'::jsonb),
            ('rate_limit_requests_per_minute', '5'::jsonb),
            ('rate_limit_burst', '0'::jsonb)
          on conflict (key) do update set value = excluded.value`);

    const fresh = psql(`insert into auth.users (email) values ('no-override@example.com') returning id`);
    assert.equal(psql(`select count(*) from public.sie_rate_limit_overrides where user_id = ${quote(fresh)}`), '0');

    // الدالة القديمة، بهوية المتصفح.
    const browser = lastLine(asRole('authenticated',
        `select enabled || '|' || coalesce(limit_per_min::text, 'null') from public.sie_rate_limit_hit(null)`,
        { uid: fresh }));
    assert.equal(browser, 'true|5', 'الحد راجع مقفول لعميل من غير استثناء — الخطأ رجع');

    // ونفس الحكاية في نسخة الـAPI.
    const api = lastLine(asRole('service_role',
        `select enabled || '|' || coalesce(limit_per_min::text, 'null')
           from public.sie_api_rate_limit_hit(${quote(fresh)}, null)`));
    assert.equal(api, 'true|5', 'نسخة الـAPI راجعة مقفولة لعميل من غير استثناء');
});

test('حد المعدل بيرجع مفتوح لما يكون مقفول من الإعدادات', { skip: skip() }, () => {
    psql(`update public.sie_settings set value = 'false'::jsonb where key = 'rate_limit_enabled'`);
    const out = lastLine(asRole('service_role',
        `select allowed || '|' || enabled from public.sie_api_rate_limit_hit(${quote(userA)}, null)`));
    assert.equal(out, 'true|false');
    psql(`update public.sie_settings set value = 'true'::jsonb where key = 'rate_limit_enabled'`);
});
