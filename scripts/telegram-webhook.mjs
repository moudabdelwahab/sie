#!/usr/bin/env node
/**
 * telegram-webhook.mjs
 * ------------------------------------------------------------
 * إعداد ويبهوك تيليجرام، أو مراجعته، أو حذفه.
 *
 * Telegram does not let you configure a webhook from a dashboard — the
 * only way is an API call, so a script is the only honest form this can
 * take. Run it once per environment.
 *
 *   node scripts/telegram-webhook.mjs set     --url <https url>
 *   node scripts/telegram-webhook.mjs info
 *   node scripts/telegram-webhook.mjs delete
 *
 * ------------------------------------------------------------
 * SECRETS
 *
 * Read from the environment, never from an argument and never written to
 * a file. A token passed as an argument lands in shell history and in the
 * process list, where any other user on the machine can read it:
 *
 *   export TELEGRAM_BOT_TOKEN=...
 *   export TELEGRAM_WEBHOOK_SECRET=...
 *
 * If TELEGRAM_WEBHOOK_SECRET is unset, `set` generates a strong one and
 * prints it ONCE, because the same value has to be configured on the
 * function and there is no way to read it back out of Telegram afterwards.
 */
import { randomBytes } from 'node:crypto';

const API_ROOT = 'https://api.telegram.org';

function fail(message) {
    console.error(`\n✗ ${message}\n`);
    process.exit(1);
}

function parseArgs(argv) {
    const [command, ...rest] = argv;
    const flags = {};
    for (let i = 0; i < rest.length; i += 2) {
        if (!rest[i].startsWith('--')) fail(`unexpected argument: ${rest[i]}`);
        flags[rest[i].slice(2)] = rest[i + 1];
    }
    return { command, flags };
}

async function callTelegram(token, method, payload = {}) {
    const response = await fetch(`${API_ROOT}/bot${token}/${method}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    });

    const body = await response.json().catch(() => null);
    if (!response.ok || !body?.ok) {
        // Telegram's own description is far more useful than the status.
        fail(`telegram ${method} failed: ${body?.description ?? response.status}`);
    }
    return body.result;
}

/**
 * Telegram accepts A-Z, a-z, 0-9, _ and - in a secret token, 1..256 chars.
 * 32 random bytes in base64url stays inside that alphabet and is far
 * beyond guessable.
 */
function generateSecret() {
    return randomBytes(32).toString('base64url');
}

async function main() {
    const { command, flags } = parseArgs(process.argv.slice(2));
    const token = process.env.TELEGRAM_BOT_TOKEN;
    if (!token) fail('TELEGRAM_BOT_TOKEN is not set. Export it rather than passing it as an argument.');

    if (command === 'info') {
        const info = await callTelegram(token, 'getWebhookInfo');
        const me = await callTelegram(token, 'getMe');
        console.log(`\nBot        @${me.username}`);
        console.log(`URL        ${info.url || '(none registered)'}`);
        console.log(`Pending    ${info.pending_update_count ?? 0}`);
        console.log(`Secret set ${info.has_custom_certificate ? 'n/a' : (info.url ? 'yes (value not readable)' : 'no')}`);
        if (info.last_error_message) {
            // The single most useful line when a webhook silently does
            // nothing: Telegram remembers exactly why its last call failed.
            console.log(`Last error ${info.last_error_message} (${new Date(info.last_error_date * 1000).toISOString()})`);
        }
        console.log();
        return;
    }

    if (command === 'delete') {
        await callTelegram(token, 'deleteWebhook');
        console.log('\n✓ Webhook removed. The bot will not receive updates until one is set again.\n');
        return;
    }

    if (command !== 'set') {
        fail('usage: telegram-webhook.mjs <set|info|delete> [--url <https url>]');
    }

    const url = flags.url;
    if (!url) fail('--url is required for `set`');
    // Telegram refuses plain HTTP outright; catching it here gives a clearer
    // message than its own error.
    if (!url.startsWith('https://')) fail('the webhook URL must be https');

    let secret = process.env.TELEGRAM_WEBHOOK_SECRET;
    let generated = false;
    if (!secret) {
        secret = generateSecret();
        generated = true;
    }

    await callTelegram(token, 'setWebhook', {
        url,
        secret_token: secret,
        // Only what this channel handles. Narrowing it means Telegram does
        // not wake the function for edits to member lists, reactions and
        // the rest — each of which would otherwise be an invocation that
        // parses to nothing.
        allowed_updates: ['message', 'edited_message'],
        // Anything queued while the webhook was unset is stale by
        // definition; delivering it would answer questions the customer
        // asked hours ago.
        drop_pending_updates: true
    });

    const me = await callTelegram(token, 'getMe');
    console.log(`\n✓ Webhook registered for @${me.username}`);
    console.log(`  ${url}\n`);

    if (generated) {
        console.log('  A webhook secret was generated. Set it on the function NOW —');
        console.log('  it cannot be read back from Telegram, and the function rejects');
        console.log('  every update until it matches:\n');
        console.log(`    supabase secrets set TELEGRAM_WEBHOOK_SECRET='${secret}'\n`);
    } else {
        console.log('  Using TELEGRAM_WEBHOOK_SECRET from the environment.');
        console.log('  Make sure the deployed function has the same value.\n');
    }
}

main().catch((err) => fail(err?.message ?? String(err)));
