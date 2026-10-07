/**
 * r6c-value.mjs — does R6C (non-discriminating evidence) have measurable value?
 * Owner decision #5: measure first; remove the rule if it has none.
 *
 *   node scripts/audit-2026-10/r6c-value.mjs
 *
 * Every probe message of the behaviour corpus (synthetic, with an expected
 * scenario) is ranked once under the production settings profile, then decided
 * with maxSimultaneousResolvable = Infinity (today), 8, 5, 3 and 2.
 *
 * @no-legitimate-corpus
 */
import { runTurn } from '../../sie/pipeline/pipeline.js';
import { decide } from '../../sie/decision/decision-engine.js';
import { SIE_DEFAULT_SETTINGS } from '../../sie/config/settings-schema.js';
import { activationThresholdForLevel } from '../../sie/ranking/ranking-engine.js';
import { buildBehaviorCorpus } from '../../bench/corpora/behavior.mjs';
import { nodeEdition, readCore, readBaseGlossary } from '../../sie/editions/tests/helpers/node-editions.js';
import { loadSettingsProfile } from '../../sie-integration/tests/helpers/runtime-world.mjs';
const settings = loadSettingsProfile('production');
const ed = await nodeEdition('free', settings);
const corpus = buildBehaviorCorpus({ catalog: readCore(), glossary: readBaseGlossary() }).filter((m) => m.expect);
const act = activationThresholdForLevel(settings.diagnosis_level);
const policy = { activationThreshold: act, allowAutoResolution: settings.answer_directly, allowScenarioAnswers: settings.knowledge_use_scenarios, allowEvidenceRequests: settings.auto_request_more_info, ticketOnAmbiguity: settings.ticket_on_low_confidence, includeTicketSummary: settings.ticket_include_summary, resolutionConfidenceThreshold: settings.answer_confidence, maxClarifyingQuestions: settings.max_clarifying_questions, maxTurnsBeforeEscalation: settings.ticket_after_turns, allowSmartGuess: settings.allow_smart_guess, requireCompleteEvidence: settings.inference_mode === 'knowledge_only' };
const caps = [Infinity, 8, 5, 3, 2];
const stats = Object.fromEntries(caps.map((c) => [c, { fired: 0, answered: 0, answeredRight: 0, answeredWrong: 0 }]));
let n = 0;
for (const m of corpus) {
  const r = await runTurn({ text: m.text, catalog: ed.scenarios, settings, variant: 'retrieval_only', providers: { glossaryProvider: ed.providers.glossaryProvider, arabiziProvider: ed.providers.arabiziProvider } });
  if (!r.ranking) continue;
  n++;
  for (const c of caps) {
    const { decision } = decide({ ranking: r.ranking, turn: 1, previousDecisionState: null, newEvidenceAddedThisTurn: 1, policy: { ...policy, maxSimultaneousResolvable: c } });
    const s = stats[c];
    if (decision.evaluatedRules.some((x) => x.rule === 'R6C_NON_DISCRIMINATING_EVIDENCE' && x.matched)) s.fired++;
    if (decision.action === 'ANSWER') { s.answered++; if (decision.scenarioId === m.expect) s.answeredRight++; else s.answeredWrong++; }
  }
}
console.log('probe messages with a ranking:', n);
for (const c of caps) console.log(`cap=${c}`, JSON.stringify(stats[c]));
