/**
 * core-standoffs.test.mjs — the four core stand-offs fixed by
 * scripts/catalog-fixes/2026-09-core-standoffs.mjs stay fixed, and the bare
 * words they involve behave exactly as before the fix.
 *
 * The second half matters as much as the first: the first attempt used
 * two-token alternatives, and a bare «مش فاهم» started leaning to
 * login_cannot_access. These pin that it does not.
 *
 * @no-legitimate-corpus
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { runTurn } from '../../pipeline/pipeline.js';
import { SIE_DEFAULT_SETTINGS } from '../../config/settings-schema.js';
import { nodeEdition } from '../../editions/tests/helpers/node-editions.js';

const free = await nodeEdition('free', SIE_DEFAULT_SETTINGS);
const turn = (text) => runTurn({ text, catalog: free.scenarios, settings: SIE_DEFAULT_SETTINGS, variant: 'retrieval_only',
    providers: { glossaryProvider: free.providers.glossaryProvider, arabiziProvider: free.providers.arabiziProvider }, edition: free });

const FIXED = [
    ['كود التحقق مش بيوصل', 'login_otp_not_received'],
    ['التذكرة محدش رد عليها', 'ticket_no_response'],
    ['مش عارف ادخل على حسابي', 'login_cannot_access'],
    ['مش قادرة ادخل على حسابي', 'login_cannot_access']
];

for (const [text, id] of FIXED) {
    test(`fixed: «${text}» → ${id}, not ambiguous, no ticket on ambiguity`, async () => {
        const r = await turn(text);
        assert.equal(r.decision.scenarioId, id);
        assert.equal(r.ranking.isAmbiguous, false);
        assert.notEqual(r.decision.action, 'CREATE_TICKET');
    });
}

test('fixed: a bare «refund» asks which of the three it is — no ambiguous ticket', async () => {
    for (const text of ['عايز استرداد', 'استرداد الفلوس', 'refund']) {
        const r = await turn(text);
        assert.equal(r.decision.action, 'ASK_CLARIFYING_QUESTION', text);
        assert.equal(r.decision.targetQuestion?.id, 'refund_what_needed', text);
    }
});

test('unchanged: the bare words behave as before the fix', async () => {
    const BEFORE = [
        ['كود التحقق', 'ASK_CLARIFYING_QUESTION', 'login_otp_not_received'],
        ['مش بيوصل', 'ASK_CLARIFYING_QUESTION', 'analytics_csat_not_collected'],
        ['مش فاهم', 'CREATE_TICKET', 'convo_asks_simpler_words'],
        ['الحالة', 'CREATE_TICKET', 'subscription_status_inquiry']
    ];
    for (const [text, action, id] of BEFORE) {
        const r = await turn(text);
        assert.deepEqual([r.decision.action, r.decision.scenarioId], [action, id], text);
    }
    // the refund question is never asked about a bare «status»
    assert.notEqual((await turn('وصلت لفين')).decision.targetQuestion?.id, 'refund_what_needed');
});
