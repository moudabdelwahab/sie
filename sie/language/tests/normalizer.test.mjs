import test from 'node:test';
import assert from 'node:assert/strict';
import { normalize, MAX_INPUT_CHARS } from '../normalizer.js';
import { createRealGlossaryProvider, createRealArabiziProvider } from './helpers/node-providers.js';

function tokenSummary(result) {
    return result.normalizedTokens.map((t) => `${t.source}:${t.canonical}`);
}

// NOTE ON EXPECTATIONS BELOW
// Arabic and Arabizi tokens are now promoted to the glossary's canonical
// vocabulary whenever the glossary knows the word, so "مش شغال" yields
// symptom_not_working exactly as the English "not working" does, and
// "moshkela" yields the same canonical its Arabic spelling would. Before
// that, Arabic phrasing produced bare surface words that no scenario
// signature could match, which made the whole catalog unreachable for a
// customer typing in Arabic or Franco-Arabic. These assertions therefore
// pin canonical tokens, not surface forms — a surface form reappearing
// here means a word fell out of the glossary.

// Each test gets its own provider instances (per-test cache) so tests
// remain independent of one another.
function providers() {
    return { glossaryProvider: createRealGlossaryProvider(), arabiziProvider: createRealArabiziProvider() };
}

test('normalizer: "الـ API مش شغال" recognizes API as a technical term inside an Arabic sentence', async () => {
    const result = await normalize('الـ API مش شغال', { previousLanguage: 'ar', ...providers() });
    assert.deepEqual(tokenSummary(result), ['glossary:entity_api', 'glossary:symptom_not_working']);
    assert.equal(result.responseLanguage, 'ar');
});

test('normalizer: "عندي Error 401" recognizes the HTTP status code as one compound signal', async () => {
    const result = await normalize('عندي Error 401', { previousLanguage: 'ar', ...providers() });
    assert.deepEqual(tokenSummary(result), ['arabic:عندي', 'glossary:http_status_401']);
    assert.equal(result.responseLanguage, 'ar');
});

test('normalizer: "الـ Webhook مش بيستقبل" recognizes Webhook inside an Arabic sentence', async () => {
    const result = await normalize('الـ Webhook مش بيستقبل', { previousLanguage: 'ar', ...providers() });
    assert.deepEqual(tokenSummary(result), ['arabic:ال', 'glossary:entity_webhook', 'arabic:مش', 'arabic:بيستقبل']);
    assert.equal(result.responseLanguage, 'ar');
});

test('normalizer: "Login Failed" matches the compound phrase as a single canonical symptom', async () => {
    const result = await normalize('Login Failed', { previousLanguage: 'ar', ...providers() });
    assert.deepEqual(tokenSummary(result), ['glossary:symptom_login_failed']);
});

test('normalizer: "SSL Certificate" prefers the longer compound pattern over the shorter "ssl" alone', async () => {
    const result = await normalize('SSL Certificate', { previousLanguage: 'ar', ...providers() });
    assert.deepEqual(tokenSummary(result), ['glossary:entity_ssl_certificate']);
});

test('normalizer: "DNS مش شغال" recognizes DNS inside an Arabic sentence', async () => {
    const result = await normalize('DNS مش شغال', { previousLanguage: 'ar', ...providers() });
    assert.deepEqual(tokenSummary(result), ['glossary:entity_dns', 'glossary:symptom_not_working']);
    assert.equal(result.responseLanguage, 'ar');
});

test('normalizer: "الـ Token انتهت صلاحيته" recognizes Token inside an Arabic sentence', async () => {
    const result = await normalize('الـ Token انتهت صلاحيته', { previousLanguage: 'ar', ...providers() });
    assert.deepEqual(tokenSummary(result), ['arabic:ال', 'glossary:entity_token', 'glossary:symptom_token_expired']);
    assert.equal(result.responseLanguage, 'ar');
});

test('normalizer: "الموقع بيرجع 500 Internal Server Error" recognizes the compound HTTP-error phrase', async () => {
    const result = await normalize('الموقع بيرجع 500 Internal Server Error', {
        previousLanguage: 'ar',
        ...providers()
    });
    // 'الموقع' now carries a canonical: in a support conversation it means the
    // platform, and mapping it lets scenarios about the dashboard be reached
    // by the word customers most often use for it.
    assert.deepEqual(tokenSummary(result), ['glossary:entity_dashboard', 'arabic:بيرجع', 'glossary:http_status_500']);
    assert.equal(result.responseLanguage, 'ar');
});

test('normalizer: Arabizi sentence resolves to Arabic canonical tokens and recognizes embedded technical terms', async () => {
    const result = await normalize('3andy moshkela fel login', { previousLanguage: 'ar', ...providers() });
    assert.deepEqual(tokenSummary(result), [
        'arabizi:عندي',
        'arabizi:symptom_generic_problem',
        'unrecognized-latin:fel',
        'glossary:entity_login'
    ]);
    assert.equal(result.responseLanguage, 'ar');
});

test('normalizer: longer Arabizi sentence with an embedded technical term (DNS) still resolves correctly', async () => {
    const result = await normalize('ezayak, 3ayez a3raf el DNS bta3y mesh sha8al', {
        previousLanguage: 'ar',
        ...providers()
    });
    assert.deepEqual(tokenSummary(result), [
        'arabizi:ازيك',
        'arabizi:عايز',
        'arabizi:aعraf',
        'arabizi:ال',
        'glossary:entity_dns',
        'arabizi:btaعy',
        'arabizi:symptom_not_working'
    ]);
    assert.equal(result.responseLanguage, 'ar');
});

test('normalizer: fully English message switches session to English', async () => {
    const result = await normalize('I cannot log into my account, it keeps showing an error', {
        previousLanguage: 'ar',
        ...providers()
    });
    assert.equal(result.responseLanguage, 'en');
});

test('normalizer: session language sequence — en stays en, then Arabic reappears and wins back immediately', async () => {
    const p = providers();

    const turn1 = await normalize('I cannot log into my account', { previousLanguage: 'ar', ...p });
    assert.equal(turn1.responseLanguage, 'en');

    const turn2 = await normalize('still not working, any update?', {
        previousLanguage: turn1.responseLanguage,
        ...p
    });
    assert.equal(turn2.responseLanguage, 'en');

    const turn3 = await normalize('مش قادر ادخل على حسابي خالص', {
        previousLanguage: turn2.responseLanguage,
        ...p
    });
    assert.equal(turn3.responseLanguage, 'ar');

    const turn4 = await normalize('thanks!', { previousLanguage: turn3.responseLanguage, ...p });
    assert.equal(turn4.responseLanguage, 'en');
});

test('normalizer: empty message does not throw and returns no tokens', async () => {
    const result = await normalize('', { previousLanguage: 'ar', ...providers() });
    assert.deepEqual(result.normalizedTokens, []);
    assert.equal(result.responseLanguage, 'ar');
});

test('normalizer: overlapping glossary patterns never double-count (longest match wins, no duplicate emission)', async () => {
    // "500 Internal Server Error" contains "500", "Error", and the full
    // phrase as separate registered patterns — only the longest,
    // most-specific match should be emitted once.
    const result = await normalize('500 Internal Server Error', { previousLanguage: 'ar', ...providers() });
    assert.deepEqual(tokenSummary(result), ['glossary:http_status_500']);
});

// ══════════════════ الحد الأقصى للمدخلات ══════════════════
// See MAX_INPUT_CHARS in normalizer.js for the measurements behind the cap.
// Before it existed, the cost of a turn was whatever the sender chose: a
// 196 KB message took 2,697 ms of CPU in this function alone, against an edge
// runtime budget measured in hundreds of milliseconds.

test('normalize: caps its input, and says when it did', async () => {
    const oversized = 'الـ API مش شغال '.repeat(4000);
    assert.ok(oversized.length > MAX_INPUT_CHARS * 2, 'the fixture must actually exceed the cap');

    const result = await normalize(oversized, { previousLanguage: 'ar', ...providers() });
    assert.equal(result.rawText.length, MAX_INPUT_CHARS);
    assert.equal(result.truncated, true);
    assert.equal(result.receivedChars, oversized.length);
});

test('normalize: an ordinary message is untouched and not flagged', async () => {
    const result = await normalize('الـ API مش شغال', { previousLanguage: 'ar', ...providers() });
    assert.equal(result.truncated, false);
    assert.equal(result.rawText, 'الـ API مش شغال');
    assert.deepEqual(tokenSummary(result), ['glossary:entity_api', 'glossary:symptom_not_working']);
});

test('normalize: the cap bounds the cost, not just the length', async () => {
    // The point of the cap is CPU, so the test measures CPU. Generous bound:
    // 8,000 characters costs ~25-40 ms, while the same text uncapped at
    // 240,000 characters cost 2.7 s before this existed.
    const oversized = 'الـ API مش شغال والباسورد غلط '.repeat(8000);
    await normalize('warm', { previousLanguage: 'ar', ...providers() });

    const started = process.hrtime.bigint();
    await normalize(oversized, { previousLanguage: 'ar', ...providers() });
    const elapsedMs = Number(process.hrtime.bigint() - started) / 1e6;
    assert.ok(elapsedMs < 500, `capped normalization took ${elapsedMs.toFixed(0)}ms — the cap is not bounding cost`);
});

test('normalize: the cap is overridable, so a caller can be stricter', async () => {
    const result = await normalize('الـ API مش شغال', { previousLanguage: 'ar', maxInputChars: 5, ...providers() });
    assert.equal(result.rawText.length, 5);
    assert.equal(result.truncated, true);
});
