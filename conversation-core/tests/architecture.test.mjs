/**
 * Architecture boundaries for Conversation Core and the Agent Runtime.
 *
 * Each rule has a negative control: the same predicate run on a source that
 * breaks the rule must report it, so a green run means the rule was checked,
 * not that the scanner found nothing to read.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join, relative, dirname, resolve, sep } from 'node:path';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const CORE = join(ROOT, 'conversation-core');
const RUNTIME = join(ROOT, 'agent-runtime');

async function exists(p) {
    try { await stat(p); return true; } catch { return false; }
}

/** Source files under dir (recursive), skipping tests and dependencies. */
async function sources(dir, exts = ['.js', '.mjs', '.ts']) {
    const out = [];
    for (const entry of await readdir(dir, { withFileTypes: true })) {
        if (['node_modules', '.git', 'tests'].includes(entry.name)) continue;
        const full = join(dir, entry.name);
        if (entry.isDirectory()) out.push(...await sources(full, exts));
        else if (exts.some((e) => entry.name.endsWith(e))) out.push([full, await readFile(full, 'utf8')]);
    }
    return out;
}

/** Comments out, strings kept (a forbidden URL in a string literal still counts). */
function code(source) {
    return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1');
}

function importsOf(source) {
    const specs = [];
    const re = /(?:import|export)\s[^'"`;]*?from\s*['"]([^'"]+)['"]|import\s*\(\s*['"]([^'"]+)['"]\s*\)|import\s+['"]([^'"]+)['"]/g;
    for (const m of code(source).matchAll(re)) specs.push(m[1] ?? m[2] ?? m[3]);
    return specs;
}

// ── Conversation Core ────────────────────────────────────────────────────

/** Core may import only its own files. */
function coreImportViolations(file, source) {
    return importsOf(source).filter((spec) => {
        if (!spec.startsWith('./') && !spec.startsWith('../')) return true;
        const target = resolve(dirname(file), spec);
        return !(target + sep).startsWith(CORE + sep) && target !== CORE;
    });
}

const CORE_FORBIDDEN = [
    // SIE
    'sie-integration', '/sie/', "'sie'", 'runturn', 'getsiereply',
    // LLM providers
    'openai', 'anthropic', 'gemini', 'llm', 'chat/completions',
    // MCP
    'mcp',
    // channel implementations and provider APIs
    'channels/', 'api.telegram.org', 'graph.facebook', 'messaging_product', 'button_reply', 'callback_query',
    // UI
    'document.', 'window.', 'innerhtml',
    // credentials and clients: Core gets an injected store
    'service_role', 'createclient', 'deno.env', 'process.env', '@supabase'
];

function coreTermViolations(source) {
    const c = code(source).toLowerCase();
    return CORE_FORBIDDEN.filter((t) => c.includes(t));
}

test('conversation-core imports nothing but its own files', async () => {
    const files = await sources(CORE);
    assert.ok(files.length >= 6, 'the scanner read the Core sources');
    for (const [file, source] of files) {
        assert.deepEqual(coreImportViolations(file, source), [], `${relative(ROOT, file)} imports outside Core`);
    }
});

test('conversation-core does not know SIE, LLMs, MCP, channels, provider APIs, UI or credentials', async () => {
    for (const [file, source] of await sources(CORE)) {
        assert.deepEqual(coreTermViolations(source), [], relative(ROOT, file));
    }
});

test('negative control: the Core rules catch SIE, LLM, MCP and channel imports', () => {
    const file = join(CORE, 'core.js');
    const bad = [
        "import { runTurn } from '../sie-integration/sie-runtime.js';",
        "import { engine } from '../sie/index.js';",
        "import OpenAI from 'openai';",
        "import { Client } from '@modelcontextprotocol/sdk/client/index.js';",
        "import { createTelegramAdapter } from '../channels/telegram/telegram-adapter.js';",
        "const m = await import('../channels/whatsapp/whatsapp-adapter.js');",
        "export { x } from '../sie-integration/sie-chat-bridge.js';"
    ];
    for (const src of bad) assert.ok(coreImportViolations(file, src).length > 0, src);
    for (const src of ["const k = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');", "fetch('https://api.telegram.org/bot')",
        "const r = await mcp.callTool('x');", "const llm = pick();", "body.messaging_product === 'whatsapp'"]) {
        assert.ok(coreTermViolations(src).length > 0, src);
    }
    assert.deepEqual(coreImportViolations(file, "import { validateParts } from './model.js';"), []);
});

// ── Agent Runtime ────────────────────────────────────────────────────────

const CHANNEL_IMPLEMENTATIONS = ['telegram', 'whatsapp', 'messenger', 'website', 'api'];

/** The runtime talks to Core, never to a channel implementation or provider API. */
function runtimeViolations(file, source) {
    const bad = importsOf(source).filter((spec) => {
        if (!spec.startsWith('.')) return false;
        const rel = relative(ROOT, resolve(dirname(file), spec)).split(sep);
        return rel[0] === 'channels' && CHANNEL_IMPLEMENTATIONS.includes(rel[1]);
    });
    const c = code(source).toLowerCase();
    for (const t of ['api.telegram.org', 'graph.facebook', 'messaging_product']) if (c.includes(t)) bad.push(t);
    return bad;
}

test('agent-runtime does not import channel implementations', async (t) => {
    if (!await exists(RUNTIME)) {
        t.diagnostic('agent-runtime/ does not exist yet (stage C) — the rule is armed and checked by the negative control');
        return;
    }
    for (const [file, source] of await sources(RUNTIME)) {
        assert.deepEqual(runtimeViolations(file, source), [], relative(ROOT, file));
    }
});

test('negative control: the runtime rule catches every channel implementation', () => {
    const file = join(RUNTIME, 'runtime.js');
    for (const ch of CHANNEL_IMPLEMENTATIONS) {
        const src = `import { x } from '../channels/${ch}/${ch}-adapter.js';`;
        assert.ok(runtimeViolations(file, src).length > 0, src);
    }
    assert.ok(runtimeViolations(file, "await fetch('https://graph.facebook.com/v20.0/x')").length > 0);
    assert.deepEqual(runtimeViolations(file, "import { createConversationCore } from '../conversation-core/index.js';"), []);
});

// ── service_role ─────────────────────────────────────────────────────────

/**
 * The only files allowed to touch the service-role key. Each is an entry point
 * with no user session to forward (or redacts the key from logs). A new file
 * needs a reason here — that is the point of the list.
 */
const SERVICE_ROLE_ALLOWED = new Map([
    ['supabase/functions/sie-api/_shared/supabase-client.ts', 'sie-api server client for the turn write (062: service_role only)'],
    ['supabase/functions/sie-channel-telegram/index.ts', 'Telegram webhook entry: no user JWT exists'],
    ['supabase/functions/sie-channel-telegram/index.remote.ts', 'deployed copy of the Telegram entry'],
    ['channels/telegram/telegram-function.js', 'builds the Telegram webhook server client'],
    ['scripts/telegram-trace.mjs', 'operator diagnostic script, run locally'],
    ['channels/core/logger.js', 'redacts the key name from logs']
]);

const SERVICE_ROLE_PATTERN = /service_role_key|serviceRoleKey/i;

function serviceRoleViolations(files) {
    return files
        .filter(([, source]) => SERVICE_ROLE_PATTERN.test(code(source)))
        .map(([file]) => relative(ROOT, file).split(sep).join('/'))
        .filter((f) => !SERVICE_ROLE_ALLOWED.has(f));
}

test('only the listed entry points use the service-role key', async () => {
    const files = [];
    for (const entry of await readdir(ROOT, { withFileTypes: true })) {
        if (!entry.isDirectory() || ['node_modules', '.git'].includes(entry.name)) continue;
        files.push(...await sources(join(ROOT, entry.name)));
    }
    assert.ok(files.length > 50, 'the scanner read the repository');
    assert.deepEqual(serviceRoleViolations(files), []);
    // The list stays honest: every allowed file still exists and still needs it.
    for (const f of SERVICE_ROLE_ALLOWED.keys()) {
        const hit = files.find(([file]) => relative(ROOT, file).split(sep).join('/') === f);
        assert.ok(hit && SERVICE_ROLE_PATTERN.test(code(hit[1])), `${f} is allowed but no longer uses the key — remove it`);
    }
});

test('negative control: a new file reaching for the service-role key is reported', () => {
    const files = [
        [join(ROOT, 'conversation-core', 'sneaky.js'), "const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');"],
        [join(ROOT, 'sie-integration', 'x.js'), 'const c = make({ serviceRoleKey });'],
        [join(ROOT, 'channels', 'core', 'logger.js'), "'serviceRoleKey'"]
    ];
    assert.deepEqual(serviceRoleViolations(files), ['conversation-core/sneaky.js', 'sie-integration/x.js']);
});
