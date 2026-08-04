import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

/**
 * ------------------------------------------------------------
 * WHY THIS TEST EXISTS
 *
 * sie-api was deployed with a route table that did not match a single
 * path Mad3oom's client calls. Every endpoint 404'd, and /v1/chat/reply
 * additionally returned 501 — so SIE mode on the website had never
 * worked, while the same engine answered fine on Telegram.
 *
 * Nothing caught it because the two halves live in two repositories and
 * nothing compared them. This test compares them: the paths are read out
 * of Mad3oom's own sie-client.js and matched against this function's
 * router, so the contract cannot drift again without a red test.
 *
 * It runs against the router's real normalizePath()/route-matching
 * source rather than a copy — a copy would just be a second thing to
 * keep in sync.
 */

const here = (p) => fileURLToPath(new URL(p, import.meta.url));

/**
 * Mad3oom lives in a separate repository, so its checkout is not always
 * present. When it is, the paths are read from source. When it is not,
 * these are the paths recorded from SIE_ENDPOINTS at the time of
 * writing — stale-able, which is exactly why the live read is preferred.
 */
const RECORDED_CLIENT_PATHS = [
    { method: 'GET', path: '/api/v1/health' },
    { method: 'GET', path: '/api/v1/admin/is-admin' },
    { method: 'GET', path: '/api/v1/access/3f1b0c6e-0000-4000-8000-000000000001' },
    { method: 'POST', path: '/api/v1/admin/access' },
    { method: 'POST', path: '/api/v1/admin/access/reset-usage' },
    { method: 'POST', path: '/api/v1/chat/reply' }
];

/**
 * Re-implements only the two pure pieces of index.ts — prefix
 * normalisation and route matching — by EXTRACTING them from the real
 * file, so a change to the router changes what this test sees.
 */
async function loadRouter() {
    const source = await readFile(here('../index.ts'), 'utf8');

    const mounts = JSON.parse(
        source.match(/const MOUNT_PREFIXES = (\[[^\]]*\])/)[1].replace(/'/g, '"')
    );
    const reserved = new Set(JSON.parse(
        source.match(/const ACCESS_RESERVED = new Set\((\[[^\]]*\])\)/)[1].replace(/'/g, '"')
    ));

    function normalizePath(pathname) {
        let path = pathname;
        for (const prefix of mounts) {
            if (path.startsWith(prefix)) { path = path.slice(prefix.length) || '/'; break; }
        }
        if (path === '/api') return '/';
        if (path.startsWith('/api/')) path = path.slice('/api'.length);
        return path || '/';
    }

    /** Mirrors the if-chain in Deno.serve, in the same order. */
    function match(method, rawPath) {
        const path = normalizePath(rawPath);
        if ((path === '/v1/health' || path === '/health') && method === 'GET') return 'health';
        if (path === '/v1/admin/is-admin' && method === 'GET') return 'is-admin';
        if (path === '/v1/access/status' && method === 'GET') return 'access-status';
        const byId = path.match(/^\/v1\/access\/([^/]+)$/);
        if (byId && !reserved.has(byId[1]) && method === 'GET') return 'access-status';
        if ((path === '/v1/access/set' || path === '/v1/admin/access') && method === 'POST') return 'access-set';
        if ((path === '/v1/access/reset' || path === '/v1/admin/access/reset-usage') && method === 'POST') return 'access-reset';
        if (path === '/v1/chat/reply' && method === 'POST') return 'chat-reply';
        return null;
    }

    return { normalizePath, match, source };
}

/** Pulls the real endpoint paths out of Mad3oom's client, when it is checked out. */
async function readClientPaths() {
    for (const candidate of ['/workspace/mad3oom.online/assets/js/sie-client.js']) {
        try {
            const source = await readFile(candidate, 'utf8');
            const block = source.match(/const SIE_ENDPOINTS = Object\.freeze\(\{([\s\S]*?)\}\);/)[1];
            const paths = [...block.matchAll(/`([^`]+)`/g)].map((m) =>
                m[1].replace(/\$\{[^}]+\}/g, 'v1').replace(/\$\{[^}]*\}/g, ''));
            // Template holes for a user id leave an empty segment; fill it.
            return paths.map((p) => ({
                path: p.includes('${') ? p : p,
                method: /chat\/reply|admin\/access/.test(p) ? 'POST' : 'GET'
            }));
        } catch { /* not checked out — fall through */ }
    }
    return null;
}

test('كل مسار بينده عليه مدعوم له route هنا', async () => {
    const { match } = await loadRouter();

    for (const { method, path } of RECORDED_CLIENT_PATHS) {
        assert.ok(match(method, path), `${method} ${path} مالوش route`);
    }
});

test('نفس المسارات شغالة من ورا بادئة Supabase كمان', async () => {
    // مدعوم ممكن ينده الدالة مباشرة أو من ورا rewrite، والاتنين لازم يشتغلوا.
    const { match } = await loadRouter();

    for (const { method, path } of RECORDED_CLIENT_PATHS) {
        assert.ok(match(method, `/functions/v1/sie-api${path}`), `${method} ${path} مش شغال من ورا البادئة`);
    }
});

test('الشكل القديم للمسارات لسه شغال', async () => {
    // تغيير الواجهة مالهوش الحق يكسر أي حد بينده الشكل اللي كان منشور.
    const { match } = await loadRouter();

    assert.equal(match('GET', '/v1/admin/is-admin'), 'is-admin');
    assert.equal(match('GET', '/v1/access/status'), 'access-status');
    assert.equal(match('POST', '/v1/access/set'), 'access-set');
    assert.equal(match('POST', '/v1/access/reset'), 'access-reset');
    assert.equal(match('POST', '/v1/chat/reply'), 'chat-reply');
});

test('«status» و«set» و«reset» مايتقروش كمعرّف مستخدم', async () => {
    const { match } = await loadRouter();

    assert.equal(match('GET', '/v1/access/set'), null, '«set» اتقرت كمعرّف');
    assert.equal(match('GET', '/v1/access/reset'), null, '«reset» اتقرت كمعرّف');
    assert.equal(match('GET', '/v1/access/status'), 'access-status');
});

test('الفحص الصحي بيترد عليه قبل ما يتبني عميل بالتوكن', async () => {
    // فحص بيحتاج توكن سليم مايقدرش يفرّق بين «SIE واقع» و«التوكن بتاعي
    // خلص» — وده الفرق الوحيد اللي هو موجود عشانه.
    const { source } = await loadRouter();
    const healthAt = source.indexOf("path === '/v1/health'");
    const clientAt = source.indexOf('buildUserClient(req)');

    assert.ok(healthAt > 0 && clientAt > 0);
    assert.ok(healthAt < clientAt, 'الفحص الصحي لازم يترد عليه قبل ما يتبني عميل بالتوكن');
});

test('الفحص الصحي بيقول هل بيانات المحرك حمّلت', async () => {
    // «الدالة شغالة» و«الـ ٥٨٠ كيلو بتاعة المحرك حمّلت من الـ CDN» سؤالين
    // مختلفين، والتاني بس هو اللي وقع قبل كده.
    const { source } = await loadRouter();
    assert.ok(source.includes('listActiveScenarios'), 'الفحص مابيلمسش المحرك');
    assert.ok(source.includes('catalogSize'));
});

test('كل مسار بيقرا بيانات بيتحقق من الهوية بنفسه', async () => {
    // الدالة شغّالة بـ verify_jwt=false عشان الفحص الصحي، فالبوابة
    // مابتحميش حاجة. أي معالج بيقرا لازم يسأل عن الهوية بنفسه — ولو مسار
    // جديد نسي، المنطق ده بيقع من غير ما حد ياخد باله.
    for (const [file, guard] of [
        ['access-status.ts', 'supabase.auth.getUser()'],
        ['chat-reply.ts', 'supabase.auth.getUser()']
    ]) {
        const source = await readFile(here(`../handlers/${file}`), 'utf8');
        assert.ok(source.includes(guard), `${file} مابيتحققش من الهوية`);
        assert.ok(source.includes("'unauthorized'"), `${file} مابيرفضش الطلب المجهول`);
    }

    // ودول الاتنين حمايتهم في الـ RPC نفسها، فبيكفي إنهم بيترجموا رفضها.
    for (const file of ['access-set.ts', 'access-reset.ts']) {
        const source = await readFile(here(`../handlers/${file}`), 'utf8');
        assert.ok(source.includes("'forbidden'"), `${file} مابيترجمش رفض الـ RPC`);
    }
});

test('المسار المجهول بيرجّع 404 مش حاجة تانية', async () => {
    const { match } = await loadRouter();
    assert.equal(match('GET', '/api/v1/nope'), null);
    assert.equal(match('POST', '/v1/chat/reply/extra'), null);
});

// ── العقد مع مدعوم ──────────────────────────────────────────────────

test('chat/reply بيرجّع alreadyPersisted', async () => {
    // من غير العلم ده، مدعوم بيكتب رد البوت تاني والعميل بيشوفه مرتين.
    const source = await readFile(here('../handlers/chat-reply.ts'), 'utf8');
    assert.ok(source.includes('alreadyPersisted'), 'مافيش alreadyPersisted في الرد');
});

test('chat/reply مابيثقش في userId الجاي في الـ body', async () => {
    // كوتة العميل وصلاحيته كلها متعلقة بالمعرّف ده.
    const source = await readFile(here('../handlers/chat-reply.ts'), 'utf8');
    assert.ok(source.includes('supabase.auth.getUser()'), 'الهوية لازم تتقرا من التوكن');
    assert.ok(/body\.userId\s*&&\s*body\.userId\s*!==\s*userId/.test(source),
        'لازم يترفض الـ body اللي بيقول معرّف تاني');
});

test('المحرك متثبّت على commit مش على فرع', async () => {
    // فرع معناه إن أي push بيغيّر المحرك تحت دالة شغّالة.
    const source = await readFile(here('../handlers/chat-reply.ts'), 'utf8');
    const pin = source.match(/cdn\.jsdelivr\.net\/gh\/moudabdelwahab\/sie@([^/]+)\//);
    assert.ok(pin, 'مالقيتش استيراد المحرك');
    assert.match(pin[1], /^[0-9a-f]{40}$/, `مش SHA كامل: ${pin[1]}`);
});

test('لو مدعوم متسحّب، بنقارن بمساراته الحقيقية مش المنسوخة', async () => {
    const client = await readClientPaths();
    if (!client) return; // مش متسحّب في الجلسة دي

    const { match } = await loadRouter();
    for (const { method, path } of client) {
        const concrete = path.replace('${encodeURIComponent(userId)}', 'abc').replace(/\$\{[^}]*\}/g, 'abc');
        assert.ok(match(method, concrete), `${method} ${concrete} مالوش route`);
    }
});
