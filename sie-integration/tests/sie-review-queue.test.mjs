import test from 'node:test';
import assert from 'node:assert/strict';
import {
    queueForHumanReview,
    HUMAN_FOLLOWUP_HOURS,
    REVIEW_QUEUED_TEXT,
    REVIEW_QUEUE_FAILED_TEXT
} from '../sie-review-queue.js';

/**
 * A Supabase double that records the RPC call. Only `rpc` is modelled,
 * because a direct table write is exactly what this module must NOT do —
 * the table's RLS is staff-only, so an insert would work for the bot and
 * be refused for a customer on the website.
 */
function fakeSupabase({ result = { data: 'rev-1', error: null } } = {}) {
    const calls = [];
    return {
        calls,
        rpc(name, params) {
            calls.push({ name, params });
            return Promise.resolve(result);
        },
        from() {
            throw new Error('لازم يعدي على الـ RPC، مش على الجدول مباشرة');
        }
    };
}

test('queueForHumanReview: بينادي الـ RPC مش الجدول', async () => {
    const supabase = fakeSupabase();
    const out = await queueForHumanReview(supabase, { sessionId: 's-1', turn: 3 });

    assert.equal(out.queued, true);
    assert.equal(out.id, 'rev-1');
    assert.equal(supabase.calls.length, 1);
    assert.equal(supabase.calls[0].name, 'queue_conversation_for_review');
});

test('queueForHumanReview: بيبعت البارامترات اللي الدالة مستنياها بالظبط', async () => {
    const supabase = fakeSupabase();
    await queueForHumanReview(supabase, { sessionId: 's-1', turn: 3, scenarioId: 'sc-9', note: 'حاجة' });

    const { params } = supabase.calls[0];
    assert.deepEqual(Object.keys(params).sort(), ['p_notes', 'p_scenario_id', 'p_session_id']);
    assert.equal(params.p_session_id, 's-1');
    assert.equal(params.p_scenario_id, 'sc-9');
});

test('queueForHumanReview: من غير سيناريو بيبعت null مش undefined', async () => {
    // undefined بيختفي من الـ JSON، والدالة ساعتها بتاخد قيمتها
    // الافتراضية بدل ما تسجّل «مافيش تخمين».
    const supabase = fakeSupabase();
    await queueForHumanReview(supabase, { sessionId: 's-1', turn: 1 });
    assert.equal(supabase.calls[0].params.p_scenario_id, null);
});

test('queueForHumanReview: فشل الـ RPC بيترجع queued=false', async () => {
    const supabase = fakeSupabase({ result: { data: null, error: { message: 'nope' } } });
    const out = await queueForHumanReview(supabase, { sessionId: 's-1', turn: 1 });

    assert.equal(out.queued, false);
    assert.equal(out.id, null);
});

test('queueForHumanReview: من غير id مابنعتبرش إنها اتسجّلت', async () => {
    // مافيش صف = مافيش وعد. الوعد بـ ٢٤ ساعة مربوط بوجود الصف.
    const supabase = fakeSupabase({ result: { data: null, error: null } });
    assert.equal((await queueForHumanReview(supabase, { sessionId: 's-1', turn: 1 })).queued, false);
});

test('queueForHumanReview: الاستثناء مابيرميش برّه', async () => {
    const exploding = { rpc() { throw new Error('connection lost'); } };
    assert.equal((await queueForHumanReview(exploding, { sessionId: 's-1', turn: 1 })).queued, false);
});

test('queueForHumanReview: من غير sessionId مافيش نداء أصلاً', async () => {
    const supabase = fakeSupabase();
    assert.equal((await queueForHumanReview(supabase, { sessionId: '', turn: 1 })).queued, false);
    assert.equal(supabase.calls.length, 0);
});

test('الملاحظة بالعربي وفيها الوقت المتفق عليه', async () => {
    const supabase = fakeSupabase();
    await queueForHumanReview(supabase, { sessionId: 's-1', turn: 7, note: 'العميل طلب موظف' });

    const notes = supabase.calls[0].params.p_notes;
    assert.ok(notes.includes('العميل طلب موظف'), 'السبب لازم يوصل لفريق الدعم');
    assert.ok(notes.includes('7'), 'رقم الدور لازم يبان');
    assert.ok(notes.includes(String(HUMAN_FOLLOWUP_HOURS)));
});

// ── اللي بيتقال للعميل ───────────────────────────────────────────────

test('رد النجاح بيوعد بالتواصل، ورد الفشل لأ', async () => {
    // ده أهم فرق في الملف: وعد بـ ٢٤ ساعة من غير صف مكتوب معناه عميل
    // مستني حد مش هييجي.
    for (const lang of ['ar', 'en']) {
        assert.ok(REVIEW_QUEUED_TEXT[lang].includes(String(HUMAN_FOLLOWUP_HOURS)));
        assert.ok(!REVIEW_QUEUE_FAILED_TEXT[lang].includes(String(HUMAN_FOLLOWUP_HOURS)));
    }
});

test('الردود مابتوعدش برقم تذكرة', async () => {
    // مفيش تذكرة اتفتحت، فأي رقم هنا هيبقى مرجع العميل مش هيلاقيه.
    for (const text of [...Object.values(REVIEW_QUEUED_TEXT), ...Object.values(REVIEW_QUEUE_FAILED_TEXT)]) {
        assert.ok(!/#\d/.test(text), `فيه رقم تذكرة: ${text}`);
    }
});

test('الرد العربي مفيهوش حروف لاتينية', () => {
    assert.ok(!/[A-Za-z]/.test(REVIEW_QUEUED_TEXT.ar), REVIEW_QUEUED_TEXT.ar);
    assert.ok(!/[A-Za-z]/.test(REVIEW_QUEUE_FAILED_TEXT.ar), REVIEW_QUEUE_FAILED_TEXT.ar);
});
