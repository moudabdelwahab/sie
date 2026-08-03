import test from 'node:test';
import assert from 'node:assert/strict';
import {
    queueForHumanReview,
    HUMAN_FOLLOWUP_HOURS,
    REVIEW_QUEUED_TEXT,
    REVIEW_QUEUE_FAILED_TEXT
} from '../sie-review-queue.js';

/**
 * A Supabase double that records what was asked of it. Only the two shapes
 * this module actually uses are modelled — the duplicate lookup
 * (select/eq/in/limit) and the insert (insert/select/single).
 */
function fakeSupabase({ existing = [], insertResult = { data: { id: 'rev-1' }, error: null }, onInsert } = {}) {
    const calls = { selects: 0, inserts: [] };

    return {
        calls,
        from(table) {
            calls.table = table;
            return {
                select() { return this; },
                eq() { return this; },
                in() { return this; },
                limit() {
                    calls.selects += 1;
                    return Promise.resolve({ data: existing, error: null });
                },
                insert(row) {
                    calls.inserts.push(row);
                    onInsert?.(row);
                    return {
                        select() { return this; },
                        single() { return Promise.resolve(insertResult); }
                    };
                }
            };
        }
    };
}

test('queueForHumanReview: بيكتب صف في مركز المراجعة', async () => {
    const supabase = fakeSupabase();
    const result = await queueForHumanReview(supabase, { sessionId: 's-1', turn: 3 });

    assert.equal(result.queued, true);
    assert.equal(result.id, 'rev-1');
    assert.equal(supabase.calls.table, 'chat_engine_conversation_reviews');
    assert.equal(supabase.calls.inserts.length, 1);
    assert.equal(supabase.calls.inserts[0].session_id, 's-1');
    assert.equal(supabase.calls.inserts[0].status, 'open');
});

test('queueForHumanReview: بيكتب بأعمدة الجدول الحقيقي بس', async () => {
    // الجدول اللايف مافيهوش reason ولا triggered_by_turn — لو اتبعتوا،
    // الـ insert بيفشل والعميل بياخد وعد مالوش أساس.
    const supabase = fakeSupabase();
    await queueForHumanReview(supabase, { sessionId: 's-1', turn: 3, scenarioId: 'sc-9', note: 'حاجة' });

    const row = supabase.calls.inserts[0];
    assert.deepEqual(
        Object.keys(row).sort(),
        ['corrected_scenario_id', 'notes', 'session_id', 'status']
    );
});

test('queueForHumanReview: الرفض مرتين في نفس المحادثة = حالة واحدة', async () => {
    const supabase = fakeSupabase({ existing: [{ id: 'rev-existing' }] });
    const result = await queueForHumanReview(supabase, { sessionId: 's-1', turn: 5 });

    assert.equal(result.queued, true, 'الصف الموجود بيتحسب مسجّل');
    assert.equal(result.id, 'rev-existing');
    assert.equal(supabase.calls.inserts.length, 0, 'مالازمش يتكرر');
});

test('queueForHumanReview: فشل الكتابة بيترجع queued=false', async () => {
    const supabase = fakeSupabase({ insertResult: { data: null, error: { message: 'nope' } } });
    const result = await queueForHumanReview(supabase, { sessionId: 's-1', turn: 1 });

    assert.equal(result.queued, false);
    assert.equal(result.id, null);
});

test('queueForHumanReview: الاستثناء مابيرميش برّه', async () => {
    // الذاكرة أو المراجعة مالهاش الحق تكسر دور العميل.
    const exploding = { from() { throw new Error('connection lost'); } };
    const result = await queueForHumanReview(exploding, { sessionId: 's-1', turn: 1 });
    assert.equal(result.queued, false);
});

test('queueForHumanReview: من غير sessionId مافيش كتابة', async () => {
    const supabase = fakeSupabase();
    const result = await queueForHumanReview(supabase, { sessionId: '', turn: 1 });
    assert.equal(result.queued, false);
    assert.equal(supabase.calls.inserts.length, 0);
});

test('الملاحظة بالعربي وفيها الوقت المتفق عليه', async () => {
    const supabase = fakeSupabase();
    await queueForHumanReview(supabase, { sessionId: 's-1', turn: 7, note: 'العميل طلب موظف' });

    const notes = supabase.calls.inserts[0].notes;
    assert.ok(notes.includes('العميل طلب موظف'), 'السبب لازم يوصل لفريق الدعم');
    assert.ok(notes.includes('7'), 'رقم الدور لازم يبان');
    assert.ok(notes.includes(String(HUMAN_FOLLOWUP_HOURS)));
});

// ── اللي بيتقال للعميل ───────────────────────────────────────────────

test('رد النجاح بيوعد بالتواصل، ورد الفشل لأ', async () => {
    // ده أهم فرق في الملف: وعد بـ 24 ساعة من غير صف مكتوب معناه عميل
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
