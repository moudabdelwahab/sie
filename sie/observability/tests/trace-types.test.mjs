import test from 'node:test';
import assert from 'node:assert/strict';
import { checkTraceEventShape } from '../trace-types.js';

function validTrace(overrides = {}) {
    return {
        sessionId: 's1',
        turn: 1,
        rawText: 'hello',
        normalizedTokenCanonicals: ['hello'],
        hypothesesSnapshot: [{ scenarioId: 'x', confidence: 0.5, status: 'active' }],
        rankingSnapshot: { topScenarioId: 'x', topConfidence: 0.5, isAmbiguous: false },
        decision: { action: 'ANSWER' },
        responseText: 'reply',
        timestamp: '2026-01-01T00:00:00.000Z',
        ...overrides
    };
}

test('checkTraceEventShape: accepts a well-formed trace', () => {
    assert.deepEqual(checkTraceEventShape(validTrace()), []);
});

test('checkTraceEventShape: rejects a non-object', () => {
    assert.deepEqual(checkTraceEventShape(null), ['trace is not an object']);
});

test('checkTraceEventShape: flags an empty-string sessionId', () => {
    const problems = checkTraceEventShape(validTrace({ sessionId: '' }));
    assert.ok(problems.some((p) => p.includes('sessionId')));
});

test('checkTraceEventShape: flags a non-number turn', () => {
    const problems = checkTraceEventShape(validTrace({ turn: '1' }));
    assert.ok(problems.some((p) => p.includes('turn')));
});

test('checkTraceEventShape: flags non-array normalizedTokenCanonicals/hypothesesSnapshot', () => {
    const problems = checkTraceEventShape(validTrace({ normalizedTokenCanonicals: null, hypothesesSnapshot: null }));
    assert.ok(problems.some((p) => p.includes('normalizedTokenCanonicals')));
    assert.ok(problems.some((p) => p.includes('hypothesesSnapshot')));
});

test('checkTraceEventShape: flags a missing rankingSnapshot/decision', () => {
    const problems = checkTraceEventShape(validTrace({ rankingSnapshot: null, decision: null }));
    assert.ok(problems.some((p) => p.includes('rankingSnapshot')));
    assert.ok(problems.some((p) => p.includes('decision')));
});

test('checkTraceEventShape: flags a missing timestamp', () => {
    const problems = checkTraceEventShape(validTrace({ timestamp: '' }));
    assert.ok(problems.some((p) => p.includes('timestamp')));
});

test('[G-L8-6] checkTraceEventShape: a trace of a turn where nothing was sent (responseText null) is valid', () => {
    const trace = {
        sessionId: 's', turn: 1, rawText: 'x', normalizedTokenCanonicals: [], hypothesesSnapshot: [],
        rankingSnapshot: {}, decision: {}, responseText: null, timestamp: '2026-01-01T00:00:00.000Z'
    };
    assert.deepEqual(checkTraceEventShape(trace), []);
    assert.ok(checkTraceEventShape({ ...trace, responseText: 42 }).length > 0, 'a non-string, non-null text is still rejected');
});
