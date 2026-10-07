# SIE — Guarantee Registry

The behavioural guarantees from `docs/REMEDIATION-PLAN-SIE-9-LAYERS.md`, with their current status. This file is **checked by CI** (`sie-integration/tests/guarantees.test.mjs`). It fails when:

- a test references an id that is not registered here;
- an `enforced` guarantee has no passing evidence. Evidence is one of:
  - a test whose title carries `[ID]`;
  - a **green** golden run that lists the id;
  - an existing test file named in the Evidence column;
- a `pending` guarantee names no work package;
- a P0 marked `closed` lacks a green golden run in every test category it requires;
- a P0's red regression (column *Red regression*) does not exist, or is not red/green as its status says.

**Tag conventions.**
- `[ID]` in a test title: the test proves the guarantee when it passes.
- `[pending:ID]`: the test pins today's *violation* of a guarantee that is not yet enforced. It is a red structural test.
- Golden conversations (`sie-integration/tests/golden/*.json`) list ids in `guarantees`. A red run pins the defect; a green run is evidence.

**Status at the end of WP3:**
- P0-14 (observability) and P0-15 (shadow comparison) are **closed by engine fixes** (WP2).
- P0-2 (Arabic word boundaries) is **closed by an engine fix** (WP3).
- P0-1, P0-3, P0-4, P0-7, P0-9 and P0-17 had their Layer-1 (detection) part fixed in WP3; their routing part is open and pinned by a red regression for WP4.
- Every other P0 is open, and each is pinned by a red regression, except P0-16, which is the test infrastructure itself.
- P0-5 and P0-15 are additionally **mitigated by configuration** in production (past-conversation import and the shadow run are off since 2026-10-06). That mitigation is not a fix for P0-5.

## Guarantees

| ID | Layer | Guarantee | Status | WP | Evidence |
|---|---|---|---|---|---|
| G-L1-1 | L1 | Lexicon phrases match only on whole Unicode word boundaries or token sequences; no phrase matches inside a longer word. | enforced | WP3 | tagged |
| G-L1-2 | L1 | Tokens in a negation scope are marked; a negated positive signal is never reported as positive. | enforced | WP3 | tagged |
| G-L1-3 | L1 | `diagnosticContent` is true whenever an evidence-bearing token exists; small talk covers the whole message only when none does. | enforced | WP3 | tagged |
| G-L1-4 | L1 | Every option value emitted by Dialogue classifies to its intended polarity. | enforced | WP3 | tagged |
| G-L1-5 | L1 | Plain yes/no words (لا، لأ، اه، آه، أيوه، نعم، yes, no) classify correctly; content without a leading yes/no has no polarity. | enforced | WP3 | tagged |
| G-L1-6 | L1 | No consumer classifies raw text; truncation is visible to every consumer. | pending | WP4 | Partial since WP3 (tagged tests): the bridge routes and the vNext interpretation read Layer-1 signals only, the bridge holds no text classifier, and truncation is in the signals and the trace. Not yet: Trust CP1 still reads the full received text — by owner decision (2026-10-06, WP3 deployment) it keeps doing so for now. |
| G-L1-7 | L1 | On the curated real-problem corpus, no message produces whole-message small talk, a human request, an escalating emotion, a positive resolution or an explicit memory capture. | enforced | WP3 | tagged |
| G-L1-8 | L1 | Normalization is deterministic and total. | enforced | WP3 | tagged |
| G-L1-9 | L1 | Typo tolerance (setting `language_typo_tolerance`, off by default) corrects only words nothing else resolved, only towards problem-describing canonicals, never a known conversational or glossary word; it measurably recovers misspellings, and its evidence weighs below an exact or Arabic match. | enforced | WP3 | tagged |
| G-L2-1 | L2 | No conversational scenario reaches diagnosis or ranking. | pending | WP5 | |
| G-L2-2 | L2 | Every auto-resolving scenario reaches the configured `answer_confidence` from its own phrasings, under every settings profile. | pending | WP5 | |
| G-L2-3 | L2 | A scenario needing account data declares a knowledge source L7 can ground, or live tokens L3 can receive. | pending | WP5 | |
| G-L2-4 | L2 | The published overlay never shrinks the catalog. | enforced | — | `sie/scenarios/tests/scenario-catalog-resolver.test.mjs` |
| G-L2-5 | L2 | The overlay never contains an unvalidated version. | pending | WP8 | |
| G-L3-1 | L3 | Evidence from one conversation never contributes to belief in another without the customer's confirmation. | pending | WP5 | |
| G-L3-2 | L3 | A "no" to a question or to VERIFY, or an explicit denial, emits contradicting evidence that lowers confidence. | pending | WP5 | |
| G-L3-3 | L3 | A hypothesis driven below the rejection threshold becomes `rejected` and is excluded downstream. | pending | WP5 | |
| G-L3-4 | L3 | Episodes expire by `lastEvidenceAt`; closing is explicit and leaves an audit record; a new episode starts empty. | pending | WP5 | |
| G-L3-5 | L3 | Evidence ages within an episode; one conversational token cannot pin a hypothesis forever. | pending | WP5 | |
| G-L3-6 | L3 | Diagnosis stays deterministic; retrieval is exact; sparse state is equivalent. | enforced | — | `sie/retrieval/tests/equivalence.test.mjs`, `sie/diagnostics/tests/sparse-state.test.mjs` |
| G-L4-1 | L4 | Rejected or conversational hypotheses are never candidates. | pending | WP5 | |
| G-L4-2 | L4 | Ambiguity requires both rivals above a data-derived confidence floor. | pending | WP5 | |
| G-L4-3 | L4 | Alternatives list only candidates at or above activation. | pending | WP5 | |
| G-L4-4 | L4 | Ordering is deterministic. | enforced | — | `sie/ranking/tests/ranking-engine.test.mjs` |
| G-L5-1 | L5 | Ticket state records only committed facts: `created` only alongside a `create_ticket` effect; proposals, declines and withheld tickets are distinct states. | pending | WP4 | |
| G-L5-2 | L5 | Every pending prompt has `expiresAt`; an expired prompt never interprets a message. | pending | WP4 | |
| G-L5-3 | L5 | yes → exactly one ticket; no → declined + review; content → processed as evidence; unclear → at most one re-ask. | pending | WP4 | |
| G-L5-4 | L5 | `COMPLETE` + episode close only for an un-negated "resolved" after an `ANSWER`; "unresolved" goes to the R6B path. | pending | WP4 | |
| G-L5-5 | L5 | No ticket on ambiguity before one clarifying attempt, and never below the L4 floor. | pending | WP5 | |
| G-L5-6 | L5 | New evidence after an `ANSWER` is not by itself failure. | pending | WP4 | |
| G-L5-7 | L5 | A knowledge-backed `ANSWER` requires L7 status `verified`. | pending | WP6 | |
| G-L5-8 | L5 | Never emits an effect the trust envelope forbids; withheld state recorded. | pending | WP4 | |
| G-L5-9 | L5 | An evidence request is closed by an attachment or a skip; the ticket references the attachment. | pending | WP7 | |
| G-L5-10 | L5 | Every route is an evaluated rule. | pending | WP4 | |
| G-L5-11 | L5 | An explicit human request escalates; anger and sarcasm escalate only with intensity and context. | pending | WP4 | |
| G-L5-12 | L5 | No decision rule is unreachable by construction. R6C is kept only if it shows measurable value (owner decision #5); otherwise it is removed. | pending | WP4 | |
| G-L5-13 | L5 | An escalation or a superseding answer never discards the message's problem: diagnosis runs on the turn, and the ticket draft carries the leading scenario and trail. | pending | WP4 | |
| G-L5-14 | L5 | Multi-problem continuity: when one problem is closed and another active problem supported by this conversation's evidence remains, the conversation continues with it instead of closing; a second problem in one message is kept. | pending | WP4 | |
| G-L6-1 | L6 | Every customer-visible string originates in Dialogue templates. | pending | WP9 | |
| G-L6-2 | L6 | Template claims are supported by the decision and state (`ticket_exists` ⇒ a ticket exists). | pending | WP9 | |
| G-L6-3 | L6 | The acknowledgement never contradicts the decision. | pending | WP9 | |
| G-L6-4 | L6 | Rendering never throws. | enforced | — | `sie/dialogue/tests/dialogue-renderer.test.mjs` |
| G-L6-5 | L6 | Clarifying questions vary by attempt and reference what is understood. | pending | WP9 | |
| G-L7-1 | L7 | `verified` only when the source answered with non-empty data. | pending | WP6 | |
| G-L7-2 | L7 | `unsupported` is distinct from `error`; only `error` may say "try later". | pending | WP6 | |
| G-L7-3 | L7 | Published DB knowledge is served; knowledge settings change behaviour. | pending | WP6 | |
| G-L7-4 | L7 | Live reads run under the caller's RLS; no cross-customer data. | pending | WP6 | |
| G-L7-5 | L7 | Every source is time-bounded; a timeout is `error`. | pending | WP6 | |
| G-L7-6 | L7 | Ticket and subscription status answer from real rows. | pending | WP6 | |
| G-L8-1 | L8 | One turn = one commit = one outcome record. | enforced | — | `sie/action/tests/action-layer.test.mjs`, `sie-integration/tests/sie-turn-writer.test.mjs` |
| G-L8-2 | L8 | Every state write is stamped by the writer on every route. | pending | WP4 | |
| G-L8-3 | L8 | Quota is charged only for a committed reply. | pending | WP8 | |
| G-L8-4 | L8 | No component other than Action writes `bot_state`. | pending | WP8 | |
| G-L8-5 | L8 | The executed effect equals the decided effect. | pending | WP4 | |
| G-L8-6 | L8 | A failed commit is returned and traced, never swallowed. | enforced | WP2 | tagged |
| G-L9-1 | L9 | Every paid turn has exactly one trace, on every route. | enforced | WP2 | tagged |
| G-L9-2 | L9 | The trace's sent text equals the reply delivered. | enforced | WP2 | tagged |
| G-L9-3 | L9 | Intent and executed outcome are separate trace fields; the trace records the route and each layer's status. | enforced | WP2 | tagged |
| G-L9-4 | L9 | With the boundary enabled, every trace carries the trust verdict (`trusted` included), or `not_evaluated` with the reason when the route ends before CP1. WP4 routes every turn through CP1. | enforced | WP2 | tagged |
| G-L9-5 | L9 | Identical live and shadow decisions compare as agreed; real divergences are still reported. | enforced | WP2 | tagged |
| G-L9-6 | L9 | The learning queue includes escalations, declines, withheld actions, re-contact after close and low-specificity tickets. | pending | WP8 | |
| G-L9-7 | L9 | Publishing requires a passing validation run or a recorded override (DB-enforced). | pending | WP8 | |
| G-L9-8 | L9 | Trace write failures are surfaced. | enforced | WP2 | tagged |
| G-BR-1 | orchestrator | The bridge calls the nine layers in order, has one success return path, holds no customer text, no classifier and no state mutation. | pending | WP4 | |
| T-1 | tests | Settings profiles are valid, and the current production configuration (including the 2026-10-06 mitigations) is a tested profile. | enforced | WP1 | tagged |
| T-2 | tests | The turn's clock is injectable and is what time-based decisions use; without it, real time applies. | enforced | WP1 | tagged |
| T-3 | tests | A red regression fails today for exactly its declared reason; a fixed defect cannot stay red; a green run cannot fail. | enforced | WP1 | tagged |
| T-4 | tests | Every golden conversation runs under a production settings profile. | enforced | WP1 | tagged |

## P0 issues

| P0 | Issue | Required categories | Status | WP | Red regression |
|---|---|---|---|---|---|
| P0-1 | Negation and confirmation mistakes | U, LI, E2E, MT, PS, ADV | open (detection fixed in WP3: REG-D2 green; routing remains for WP4) | WP3, WP4 | REG-D3-restated-problem-at-prompt, REG-D4-new-problem-at-ticket-question-is-diagnosed, REG-D4b-new-problem-at-escalation-question-is-diagnosed, REG-D5-restated-negated-problem-is-not-a-decline |
| P0-2 | Arabic word-boundary problems | U, LI, E2E, PS, ADV | closed (WP3) | WP3 | REG-D1-plain-no, REG-D1-plain-yes, REG-F1-install-is-not-anger (all green) |
| P0-3 | False resolution detection | U, LI, E2E, MT, PS, ADV | open (detection fixed in WP3: REG-C and REG-C2 green; the closing rule remains for WP4) | WP3, WP4 | REG-C3-resolved-plus-new-problem-is-diagnosed, REG-C4-resolved-then-new-problem-is-diagnosed, REG-C5-one-of-two-problems-resolved-keeps-the-other, REG-C6-new-problem-then-resolution-in-one-message |
| P0-4 | False emotion/escalation detection | U, LI, E2E, MT, PS, ADV | open (word boundaries and negation fixed in WP3: REG-F1 green; the context rule remains for WP4) | WP3, WP4 | REG-F2-sincere-praise-is-not-sarcasm, REG-F2b-polite-closing-is-not-anger, REG-F5-anger-with-a-problem-is-diagnosed, REG-F6-sarcasm-without-context-is-not-escalated, REG-F7a-human-request-keeps-the-problem, REG-F7b-threat-escalates-and-keeps-the-problem, REG-F8-repeated-anger-escalates, REG-F9-kill-switch-restores-lexicon-escalation |
| P0-5 | Cross-conversation contamination | U, LI, E2E, MT, MS, PS, ADV | open (mitigated by configuration 2026-10-06) | WP5 | REG-B-closing-remark-does-not-cross-chats, REG-B2-status-question-does-not-cross-chats |
| P0-6 | Phantom ticket state | U, LI, E2E, MT, PS, ADV | open | WP4 | REG-E-no-phantom-ticket, REG-E2-new-problem-after-decline-is-not-the-declined-ticket, REG-E3-created-ticket-is-not-proposed-again, REG-L5-1a-proposed-ticket-is-proposed, REG-L5-1b-withheld-ticket-is-withheld, REG-L5-1c-unavailable-ticket-is-unavailable, REG-L5-1d-open-account-ticket-is-existing |
| P0-7 | Ticket confirmation/decline handling | U, LI, E2E, MT, PS, ADV | open (reply classification fixed in WP3: REG-D1-plain-no, REG-D1-plain-yes and REG-D2 green) | WP4 | REG-D1-unclear-reask-is-bounded, REG-D3-restated-problem-at-prompt, REG-D4-new-problem-at-ticket-question-is-diagnosed, REG-D4b-new-problem-at-escalation-question-is-diagnosed, REG-D5-restated-negated-problem-is-not-a-decline, REG-E-no-phantom-ticket, REG-E2-new-problem-after-decline-is-not-the-declined-ticket |
| P0-8 | Pending prompt expiry | U, LI, E2E, MT, MS, PS | open | WP4 | REG-G-pending-prompt-expires, REG-G2-expired-question-does-not-hijack-a-new-problem, REG-G2b-expired-diagnostic-question-does-not-hijack-a-new-problem, REG-G5-late-unrelated-message-is-not-captured |
| P0-9 | State wiped after a false resolution | U, LI, E2E, MT, PS, ADV | open (the negated-resolution case is fixed in WP3: REG-C green) | WP4, WP5 | REG-C3-resolved-plus-new-problem-is-diagnosed, REG-C4-resolved-then-new-problem-is-diagnosed, REG-C5-one-of-two-problems-resolved-keeps-the-other, REG-C6-new-problem-then-resolution-in-one-message |
| P0-10 | Knowledge not using live data | U, LI, E2E, PS, ADV | open | WP6 | REG-H-ticket-status-from-real-data |
| P0-11 | Ticket status cannot read real data | U, LI, E2E, PS, ADV | open | WP6 | REG-H-ticket-status-from-real-data |
| P0-12 | Evidence only increases | U, LI, E2E, MT, PS, ADV | open | WP5 | REG-12-denial-lowers-belief |
| P0-13 | Attachments never reach the engine | U, LI, E2E, MT, PS, ADV | open | WP7 | REG-13-attachment-reaches-engine |
| P0-14 | Incorrect or incomplete observability | U, LI, E2E, MT, MS, PS | closed (WP2) | WP2 | REG-K3-every-paid-turn-is-traced, REG-K3b-every-paid-turn-is-traced-across-chats, REG-K1-trace-records-what-was-sent (all green) |
| P0-15 | Shadow comparison cannot agree | U, LI, E2E, PS | closed (WP2); the shadow stays disabled in production by configuration until re-enabled | WP2 | REG-K2-shadow-can-agree (green) |
| P0-16 | Production settings not covered by integration tests | LI, E2E, MT, MS, PS, ADV | open (foundation in WP1) | WP1–WP9 | — (T-1, T-4) |
| P0-17 | Untested conversation controller in `sie-chat-bridge.js` | U, LI, E2E, MT, MS, PS | open (REG-F3 and REG-F4 green since WP3) | WP4 | structure.test.mjs |

Categories: U unit · LI layer integration · E2E full `runSieTurn` · MT multi-turn · MS multi-session · PS production settings · ADV adversarial. A P0 is `closed` only when every required category has passing tests. For the golden-backed categories (E2E, MT, MS, PS, ADV), the meta-test checks this mechanically.
