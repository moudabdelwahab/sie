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

// ══════════════════ السوابق المتصلة قبل العبارات ══════════════════
//
// Arabic writes several one-letter function words straight onto the next
// word — و (and), ف (so), ب (with), ك (like), ل (to) — and the glossary
// lists its phrases without them. A customer writing naturally produces
// "ومش عارف ادخل", which matched nothing at all.
//
// Single-word clitic stripping already existed. The PHRASE path was broken by
// its own guard: the vocabulary is built from every word of every pattern, so
// the single pattern `symptom_stuck_loading :: "بيلف ومش بيخلص"` put "ومش" in
// the vocabulary, and the guard then refused to strip it anywhere in the
// engine. Measured: 32.2% of Arabic patterns (868 of 2,699) stopped matching
// after "و", one of the commonest words in the language.

test('normalizer: عبارة بعد واو العطف بتتعرف زي ما هي من غيرها', async () => {
    const bare = await normalize('مش عارف ادخل', { previousLanguage: 'ar', ...providers() });
    const prefixed = await normalize('ومش عارف ادخل', { previousLanguage: 'ar', ...providers() });
    assert.deepEqual(tokenSummary(bare), ['glossary:symptom_login_failed']);
    assert.deepEqual(
        prefixed.normalizedTokens.map((t) => t.canonical),
        ['symptom_login_failed'],
        'the conjunction must not cost the phrase its match'
    );
});

test('normalizer: الجملة الطبيعية اللي كانت بتضيع بالكامل', async () => {
    // Produced zero canonical tokens before the fix — every word came out as
    // a raw surface form, so the turn carried no diagnostic evidence at all.
    const result = await normalize('انا صاحب الحساب ومش عارف ادخل', { previousLanguage: 'ar', ...providers() });
    assert.ok(
        result.normalizedTokens.some((t) => t.canonical === 'symptom_login_failed'),
        `expected symptom_login_failed, got ${result.normalizedTokens.map((t) => t.canonical).join(', ')}`
    );
});

test('normalizer: النمط اللي فيه الواو أصلًا لسه بيطابق حرفيًا', async () => {
    // The pattern that caused the bug. The verbatim key is tried FIRST, so
    // relaxing the guard cannot cost this its match.
    const result = await normalize('بيلف ومش بيخلص', { previousLanguage: 'ar', ...providers() });
    assert.ok(result.normalizedTokens.some((t) => t.canonical === 'symptom_stuck_loading'));
});

test('normalizer: الحارس لسه شغال على باقي كلمات العبارة', async () => {
    // Dropping the guard on EVERY word was tried and measured worse (59.2%
    // against 67.8%): unguarded, "كده" strips to "ده" and "الوقت" to "وقت",
    // both real vocabulary words, so phrases that used to match stopped. Only
    // the FIRST word is unguarded, because that is where a conjunction goes.
    const result = await normalize('مش شغال خالص', { previousLanguage: 'ar', ...providers() });
    assert.ok(result.normalizedTokens.some((t) => t.canonical === 'symptom_not_working'));
});

test('normalizer: كل السوابق المتصلة، مش الواو بس', async () => {
    for (const clitic of ['و', 'ف', 'ب', 'ك', 'ل']) {
        const result = await normalize(`${clitic}مش شغال`, { previousLanguage: 'ar', ...providers() });
        assert.ok(
            result.normalizedTokens.some((t) => t.canonical === 'symptom_not_working'),
            `"${clitic}مش شغال" lost its match`
        );
    }
});
