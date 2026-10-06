/**
 * golden-runner.test.mjs — the red/green discipline itself is tested.
 * ------------------------------------------------------------
 * If the runner accepted a red run that passes, or a red run failing for an
 * undeclared reason, the whole "fails before the fix, passes after" claim
 * would be decoration. These pin the runner's verdicts.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { assertRunStatus, runGolden, TEXT } from './helpers/golden-runner.mjs';

const golden = { id: 'SELF' };
const fail = (...ids) => ids.map((id) => ({ id, why: 'x' }));

test('[T-3] a green run with no failures passes', () => {
    assert.doesNotThrow(() => assertRunStatus(golden, { profile: 'p', status: 'green' }, []));
});

test('[T-3] a green run with any failure is a regression', () => {
    assert.throws(() => assertRunStatus(golden, { profile: 'p', status: 'green' }, fail('a#1.x')), /is green but failed/);
});

test('[T-3] a red run failing on exactly its declared expectations passes', () => {
    assert.doesNotThrow(() => assertRunStatus(golden, { profile: 'p', status: 'red', failingNow: ['a#1.x', 'a#2.y'] }, fail('a#2.y', 'a#1.x')));
});

test('[T-3] a red run that now passes is reported as fixed (must be flipped to green)', () => {
    assert.throws(() => assertRunStatus(golden, { profile: 'p', status: 'red', failingNow: ['a#1.x'] }, []), /now PASSES/);
});

test('[T-3] a red run failing for an undeclared reason is rejected', () => {
    assert.throws(() => assertRunStatus(golden, { profile: 'p', status: 'red', failingNow: ['a#1.x'] }, fail('a#1.x', 'a#1.z')), /wrong reason/);
    assert.throws(() => assertRunStatus(golden, { profile: 'p', status: 'red', failingNow: ['a#1.x', 'a#1.y'] }, fail('a#1.x')), /wrong reason/);
});

test('[T-3] a red run must declare why it is red', () => {
    assert.throws(() => assertRunStatus(golden, { profile: 'p', status: 'red', failingNow: [] }, fail('a#1.x')), /declares no failingNow/);
});

test('[T-3] an unknown expectation key is an error, not a silent pass', async () => {
    const g = { id: 'BAD', chats: [{ chat: 'a', turns: [{ say: 'صباح الخير', expect: { noSuchKey: true } }] }] };
    await assert.rejects(runGolden(g, 'defaults'), /unknown expectation key/);
});

test('[T-3] an unknown template name is an error, not a silent pass', async () => {
    const g = { id: 'BAD', chats: [{ chat: 'a', turns: [{ say: 'صباح الخير', expect: { replyIs: 'NO_SUCH_TEXT' } }] }] };
    await assert.rejects(runGolden(g, 'defaults'), /unknown TEXT key/);
});

test('[T-3] expectations are evaluated after their own turn, not at the end of the chat', async () => {
    // Turn 1 opens no ticket; turn 2 does. Checking turn 1 against the end
    // state would wrongly see one ticket.
    const g = { id: 'ORDER', chats: [{ chat: 'a', turns: [
        { say: 'عايز اتكلم مع موظف', expect: { ticketsTotal: 0 } },
        { say: 'أيوه افتحلي تذكرة', expect: { ticketsTotal: 1 } }
    ] }] };
    const { failures } = await runGolden(g, 'defaults');
    assert.deepEqual(failures, []);
});

test('[T-3] template fragments are the engine\'s own sentences', () => {
    for (const [name, fragment] of Object.entries(TEXT)) {
        assert.ok(typeof fragment === 'string' && fragment.length >= 4, `${name} fragment too short to identify a template`);
    }
});
