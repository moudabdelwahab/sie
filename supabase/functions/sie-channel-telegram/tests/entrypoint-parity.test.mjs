/**
 * entrypoint-parity.test.mjs
 * ------------------------------------------------------------
 * The mechanism that replaces "please keep these two files identical".
 *
 * THE BUG THIS EXISTS TO CATCH
 *
 * `index.ts` and `index.remote.ts` each carried the whole function body,
 * with a header comment asking humans to keep them in step. They drifted:
 * the deployed one (`index.remote.ts`) grew `readSecret()`, the
 * `channel_secrets` fallback for the webhook secret, and
 * `autoRegisterWebhook()`. `index.ts` never got any of it.
 *
 * The cost was not cosmetic. A routine `supabase functions deploy
 * sie-channel-telegram` from a checkout deploys `index.ts` — which would
 * have removed the secret fallback, and where the secret lives only in
 * `channel_secrets`, every Telegram update would then get
 * `misconfigured 500`. A normal deploy would have taken the channel down.
 *
 * So the body now lives once, in channels/telegram/telegram-function.js,
 * and these tests fail the moment the two entrypoints stop being pure
 * import-and-wire shells over it.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const read = (name) => readFileSync(path.join(HERE, '..', name), 'utf-8');

const LOCAL = read('index.ts');
const REMOTE = read('index.remote.ts');

/**
 * The executable code, with the two things that are ALLOWED to differ
 * removed: the import specifiers, and the leading file-header comment
 * that names the file and says which import style it uses.
 */
function executableCode(source) {
    return source
        .replace(/^\/\*\*[\s\S]*?\*\/\s*/, '')   // leading header comment
        .split('\n')
        .filter((line) => !line.startsWith('import '))
        .join('\n')
        .trim();
}

test('the two entrypoints contain byte-identical executable code', () => {
    assert.equal(
        executableCode(LOCAL),
        executableCode(REMOTE),
        'index.ts and index.remote.ts have diverged below their imports — that is the '
        + 'exact failure that would have removed the channel_secrets fallback on the next deploy'
    );
});

test('neither entrypoint carries any behaviour of its own', () => {
    for (const [name, source] of [['index.ts', LOCAL], ['index.remote.ts', REMOTE]]) {
        const code = executableCode(source);
        // The whole body is one factory call plus Deno.serve. Anything else
        // is behaviour that has escaped the shared module.
        assert.ok(
            !/\basync function\b|\bfunction\s+\w+\s*\(/.test(code),
            `${name} declares a function — behaviour belongs in telegram-function.js, not here`
        );
        assert.ok(
            !/supabase\.from\(|api\.telegram\.org/.test(code),
            `${name} talks to the database or Telegram directly — that belongs in telegram-function.js`
        );
        assert.ok(
            code.includes('createTelegramFunction({'),
            `${name} must build the channel through the one shared factory`
        );
        assert.ok(
            code.includes('Deno.serve(handler)'),
            `${name} must serve the handler the shared factory returned`
        );
    }
});

test('both entrypoints wire exactly the same dependency set', () => {
    const wiring = (source) => {
        const call = source.match(/createTelegramFunction\(\{([\s\S]*?)\n\}\);/);
        assert.ok(call, 'the factory call could not be found');
        return call[1]
            .split('\n')
            .map((l) => l.trim().replace(/:.*$/, '').replace(/,$/, ''))
            .filter(Boolean)
            .sort();
    };
    assert.deepEqual(wiring(LOCAL), wiring(REMOTE));
});

test('every production behaviour that only existed in the deployed file survived the move', () => {
    // Named explicitly, because these are the ones the local file had lost
    // and a careless consolidation would have dropped for good.
    const shared = read('../../../channels/telegram/telegram-function.js');
    for (const behaviour of [
        'readSecret',                    // channel_secrets access
        'telegram_webhook_secret',       // the secret fallback key
        'autoRegisterWebhook',           // one-time webhook registration
        'telegram_autoregister',         // the DB flag that gates it
        'drop_pending_updates',          // registration options
        'allowed_updates',
        'webhook_secret_source',         // self-check fields
        'webhook_points_here',
        'bot_username',
        'misconfigured'                  // fail-closed on a missing secret
    ]) {
        assert.ok(shared.includes(behaviour), `deployed behaviour "${behaviour}" is missing from the shared module`);
    }
});

test('the shared module stays runtime-agnostic', () => {
    const shared = read('../../../channels/telegram/telegram-function.js');
    // Comments stripped first: this file's own header explains that it uses
    // no `Deno.` API, and a naive scan would match that sentence.
    const code = shared
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/(^|[^:])\/\/.*$/gm, '$1');
    // A `Deno.` call here would break `node --test` and re-create the split
    // this consolidation removed. Reading the environment is the entrypoint's job.
    assert.ok(!/\bDeno\./.test(code), 'telegram-function.js must not touch Deno APIs');
});

test('the remote entrypoint pins a commit, never a branch', () => {
    const specifiers = [...REMOTE.matchAll(/cdn\.jsdelivr\.net\/gh\/[^@]+@([^/]+)\//g)].map((m) => m[1]);
    assert.ok(specifiers.length > 0, 'the remote entrypoint should import from the CDN');
    for (const ref of specifiers) {
        assert.match(ref, /^[0-9a-f]{40}$/, `"${ref}" is not a full commit SHA — a branch would swap the engine under a running function`);
    }
    assert.equal(new Set(specifiers).size, 1, 'every remote import must pin the SAME commit');
});
