# SIE — Remediation Plan for the Existing Nine Layers

**Status:** PROPOSED. Awaiting explicit approval. No implementation has started.
**Basis:** `docs/AUDIT-SIE-9-LAYERS-2026-10.md` (commit `18d602b`). Finding ids (`A`, `B`, `B2`, `C`, … `K3`) refer to the 21 reproductions in `scripts/audit-2026-10/conversations.mjs`, all of which reproduce today.
**Scope rule:** no Layer 10, no Layer 11, no new architectural layer. The goal is to make the existing nine layers correct and connected as one system. Trust and Retrieval stay as they are today: cross-cutting helpers, not new stages.

---

## 0. Principles every work package must satisfy

1. **Facts, not intentions.** State records only what is true *after* the turn commits:
   - "CREATE_TICKET decision" ≠ "ticket created".
   - "resolution detected" ≠ "problem resolved".
   - "knowledge available" ≠ "knowledge verified".
   - "action requested" ≠ "action completed".

   Every state field that names an effect has a status vocabulary that separates those (`proposed | confirmed_pending | created | declined | …`). Only the Action layer's committed outcome can move it to a terminal "happened" value.
2. **Every turn passes through all nine layers in one fixed order.** A layer with nothing to do records `noop` with a reason; it is never silently skipped. There are no early returns that bypass Decision, Dialogue, Action or Observability.
3. **Detect in one place, decide in one place, speak in one place, write in one place.**
   - Language detects.
   - Decision decides.
   - Dialogue speaks.
   - Action writes.
   - Observability records.

   Nothing else does any of these.
4. **Deterministic and injectable.** Time, settings, providers and the database are inputs. No `Date.now()` and no module-level state decide behaviour.
5. **A guarantee is not done until a test names it.** Every guarantee below has an id (`G-L5-3`), and the tests that prove it carry the id in their title. A meta-test enforces that every id is covered.

---

## 1. Where responsibilities live today, and where they move

`sie-chat-bridge.js` (1,271 lines) currently performs work belonging to seven of the nine layers. After remediation it becomes a thin orchestrator. It reads the settings and handoff gates, then calls the layers in order. It contains **no** customer text, **no** classifier, **no** state mutation and **no** routing decision.

| # | Responsibility in `sie-chat-bridge.js` today | Lines | Moves to | Becomes |
|---|---|---|---|---|
| 1 | `classifyTicketConfirmationReply` (regex yes/no) | 406–421 | **L1** | `replyPolarity` signal, computed on tokens with Unicode boundaries and negation |
| 2 | `resolvePendingTicketConfirmation` (state machine of the ticket prompt) | 479–569 | **L5** | pending-prompt rules with expiry, inside `decide()` |
| 3 | Small-talk / greeting short-circuit `respondToSmallTalk` | 681–700, 873–888 | detection **L1**, routing **L5**, text **L6** | `REPLY_SOCIAL` decision; a greeting with diagnostic content stays a problem |
| 4 | Emotion / human-request escalation `escalateImmediately` | 571–672, 798–818 | detection **L1**, rule **L5**, text **L6**, handoff effect **L8** | `ESCALATE_TO_HUMAN{reason}` rule with precision guards |
| 5 | Emotion acknowledgement prefix | 865–871, 1060 | **L6** | template-level acknowledgement, consistent with the decision |
| 6 | Memory intent `handleMemoryIntent` (detect, store, reply) | 244–295, 848–855 | detection **L1**, rule **L5**, fact write **L8**, recall data **L7**, text **L6** | memory is a side effect; a turn that carries a problem is still diagnosed |
| 7 | Resolution close `closeConversation` (wipes state) | 208–231, 857–863 | signal **L1**, rule **L5**, episode close **L3**, write **L8** | `COMPLETE` closes the *episode*, keeps an audit record, never on a negated signal |
| 8 | `recallPreviousState` (context expiry) | 322–338 | **L3** (episode expiry) + **L5** (prompt expiry) | explicit `episode.expiresAt`, `pendingPrompt.expiresAt` |
| 9 | `recallPreviousSession` (imports another chat's evidence) | 763–772 | **L3** policy | never imports evidence; at most offers "is this about X again?" via L5/L6 |
| 10 | `buildGreetingPersonalisation` (name, last issue) | 133–156 | data **L7** (customer facts), text **L6** | |
| 11 | `rescueWithArticle` (knowledge after a ticket decision) | 176–198, 1021–1026 | **L7** grounding *before* L5 | L5 sees knowledge status when deciding |
| 12 | `findOpenTicket` duplicate override | 1146–1162 | data **L7** (account context), rule **L5** | `EXISTING_TICKET` decision, not a post-hoc override |
| 13 | `auto_ticket_enabled` / `ask_before_ticket` overrides | 1163–1189 | **L5** policy | `CONFIRM_TICKET` / `TICKETS_UNAVAILABLE` decisions |
| 14 | Trust CP3b `admitAction` after the decision | 1039–1044 | **L5** input (envelope capabilities) | L5 never emits an effect it may not execute |
| 15 | `collectAlternatives` | 110–122 | **L4** output | |
| 16 | `nextBotState` assembly, sparse compression, `lastTurnAt` | 1104–1131 | **L8** | stamping is the writer's invariant, on every path |
| 17 | Quota spend `tryConsumeSieMessage` before work | 738 | **L8** | charge at commit (Mad3oom DB dependency) |
| 18 | `requestHumanHandoff`, `queueForHumanReview`, `rememberFacts`/`forgetFacts` | various | **L8** | effects of the committed decision |
| 19 | Shadow run and `buildTraceEvent` on one path only | 1093–1102, 1215–1254 | **L9** | one trace per paid turn on every path |
| 20 | ~12 customer-text constants | 208–404, 1153 | **L6** | |
| 21 | Edition / catalog resolution | 389–399, 894 | **L2** entry point | unchanged behaviour, owned by L2 |

Outside the bridge:
- `channels/core/sie-client.js:109`: Telegram's second `bot_state` write is removed (L8 guarantee).
- `sie-runtime.publishScenarioVersion` / `publishKnowledgeVersion`: publishing goes through the L9 publish gate.

---

## 2. Layer-by-layer remediation

Each layer lists the nine items requested:
1. Target responsibility.
2. Current responsibility.
3. What is removed.
4. Inputs.
5. Outputs.
6. Consumers.
7. Guarantees.
8. Tests required.
9. Failures prevented.

### Layer 1 — Language & Normalization

1. **Target responsibility.** Turn one message (text plus attachment metadata) into an annotated token stream and a set of **context-free signals**. It *detects*; it never routes, never replies and never reads conversation state.
2. **Current.**
   - Normalization works.
   - Four detectors (small talk, emotion, memory intent, resolution) match raw-text substrings without negation or word boundaries.
   - The bridge treats a detector hit as a routing decision.
   - Reply texts (`SMALL_TALK_REPLIES`, `MEMORY_REPLIES`, `EMOTION_ACKNOWLEDGEMENT`) live here.
   - `typo-tolerance.js` is dead.
   - The truncation flag is ignored downstream.
3. **Remove.**
   - Every reply text (→ L6).
   - Raw-text substring matching in all detectors.
   - Any implication that a signal ends the turn.
   - `typo-tolerance.js`: either delete it or wire it into the glossary lookup with a test. Decision required (§7).
4. **Inputs.** Raw text, attachment metadata (`[{kind, mime, name, size}]`), previous response language, edition glossary layers, input cap.
5. **Outputs.** `LanguageResult`:
   - `tokens[]`: `{canonical, source, raw, start, end, negated, clauseIndex}`.
   - `responseLanguage`, `truncated`, `receivedChars`.
   - `signals`:
     - `smallTalk {type, coversWholeMessage}`
     - `humanRequest {explicit}`
     - `emotion {type, intensity, negated}`
     - `resolution {value: resolved|unresolved|null, negated}`
     - `memory {kind: save|recall|forget|null, facts[], explicit}`
     - `replyPolarity: yes|no|null`
     - `diagnosticContent: boolean` (any evidence-bearing token beyond social and stop words)
   - `attachments[]`, mapped to tokens `attachment_image | attachment_file | attachment_log`.
6. **Consumers.**
   - L3: tokens.
   - L5: signals, `diagnosticContent`.
   - Trust CP1: tokens. It must use L1's output, not raw text.
   - L6: language.
   - L9: everything.
7. **Guarantees.**
   - **G-L1-1** Word-boundary safety: a lexicon phrase matches only on whole Unicode word boundaries (`(?<![\p{L}\p{N}])…(?![\p{L}\p{N}])`, `u` flag) or on token sequences. No phrase matches inside a longer word: `نصب` ⊄ `انصب`; `مش` ⊄ `مشكلة`.
   - **G-L1-2** Negation scope: tokens following a negator (`مش، ما…ش، مـ…ش، مفيش، لا، لسه مش، مابقاش، not, don't, didn't, never`) are marked `negated` until a clause boundary (`و، بس، لكن، punctuation`). A positive signal (resolution, satisfaction, thanks) whose trigger is negated is reported as negated, never as positive.
   - **G-L1-3** No discarded content: `diagnosticContent` is true whenever an evidence-bearing token exists. `smallTalk.coversWholeMessage` is true only when no such token exists.
   - **G-L1-4** Button round-trip: every option value emitted by L6 templates classifies to its intended polarity (`أيوه، افتحلي تذكرة` → yes; `لأ، مش دلوقتي` → no).
   - **G-L1-5** Reply polarity: plain `لا`, `لأ`, `اه`, `آه`, `أيوه`, `نعم`, `no`, `yes` classify correctly. A message with `diagnosticContent` has polarity `null` unless it starts with an explicit yes/no token.
   - **G-L1-6** Single source: no consumer reads raw text for classification. Truncation is visible to every consumer.
   - **G-L1-7** Precision: on the curated real-problem corpus (§4.4), no message produces `smallTalk.coversWholeMessage`, `humanRequest`, an escalating emotion, a positive `resolution`, or `memory.explicit`.
   - **G-L1-8** Determinism and totality: same input gives the same output; no input throws.
8. **Tests.**
   - Unit: boundary matcher; negation table (≥40 cases incl. Egyptian `ما…ش`); reply-polarity table; Arabizi variants.
   - Generated collision corpus: every lexicon phrase × every glossary/catalog word that contains it as a substring.
   - Precision corpus (G-L1-7).
   - Button round-trip over all templates.
   - Property: greeting + any problem sentence ⇒ `diagnosticContent=true`.
   - Integration: L1 → L3 evidence parity; Trust CP1 uses L1 tokens.
9. **Prevents:** C, C2, D1, D2, D3, F1, F2, F3, F4 and the restated-problem decline in B.

### Layer 2 — Scenario Catalog

1. **Target responsibility.** The closed set of **diagnosable problems** for the edition: signatures, resolutions, questions, knowledge keys, plus provenance (shipped, pack, published overlay).
2. **Current.**
   - 924 scenarios, of which 205 `convo_*` are conversational moves competing as problems.
   - 0 live tokens; 8.9% have discriminating questions.
   - Reachability is not checked against the configured `answer_confidence`.
   - The published overlay is ungated.
3. **Remove.** Conversational scenarios from the diagnosable set. Each `convo_*` is triaged:
   - (a) a duplicate of an L1 signal → removed;
   - (b) a unique conversational move → becomes an L1 lexicon entry + L6 template;
   - (c) actually a problem → re-tagged.

   First step: tag `kind: 'conversational'` and exclude it from diagnosis, so the change is reversible. Physical removal comes after measurement.
4. **Inputs.** Edition profile, settings, published overlay rows (only versions with a passing validation run, see L9).
5. **Outputs.** A provider: `getProblemScenarios()`, `getScenarioById()`, `catalogInfo {size, sources, versionHash}`.
6. **Consumers.** L3 (signatures), L4 (metadata), L5 (resolutions, questions, category), L7 (knowledge keys), L9 (version hash in every trace).
7. **Guarantees.**
   - **G-L2-1** No scenario with `kind:'conversational'` reaches L3/L4.
   - **G-L2-2** Reachability at the configured threshold: every scenario with an auto-resolution reaches `answer_confidence` from its own canonical phrasings. The check runs for the defaults *and* the production-settings snapshot, so raising the threshold to 0.65 cannot silently strand a scenario (C2).
   - **G-L2-3** Consistency: a scenario whose resolution needs account data declares a `knowledgeSource` that L7 can ground, or live tokens that L3 can receive.
   - **G-L2-4** The overlay never shrinks the catalog (exists today).
   - **G-L2-5** The overlay never contains an unvalidated version.
8. **Tests.**
   - Catalog integrity (extended for G-L2-1 and G-L2-3).
   - Reachability parameterized by settings profile.
   - Overlay gating with a mock validation table.
   - E2E: a "nothing else" message never becomes a ticket's scenario (B).
9. **Prevents:** B (the `convo_goodbye` ticket chain), C2 (stranded scenario), parts of B2.

### Layer 3 — Diagnostic Engine

1. **Target responsibility.** Maintain an **episode-scoped** belief state from evidence that can **support or contradict**, and recompute hypotheses deterministically.
2. **Current.**
   - Belief is monotonic: nothing emits `contradicts` and nothing decays.
   - The `rejected` status is unreachable.
   - Another chat's evidence is imported via the bridge.
   - Closing a conversation wipes state silently.
   - Live evidence is a stub.
   - Evidence is extracted twice per turn.
3. **Remove.**
   - Evidence import across conversations.
   - The silent wipe (replaced by an explicit episode close).
   - The double extraction: CP1 consumes L3's extraction, or L3 accepts pre-extracted evidence.
4. **Inputs.**
   - L1 tokens with `negated`.
   - Answer evidence (from L5's pending question + L1 polarity).
   - Live evidence (from L7's account context).
   - Previous state (`episode`).
   - Trust evidence filter, retrieval scope, clock.
5. **Outputs.** `DiagnosticState`:
   - `episode {id, openedAt, lastEvidenceAt, closedAt?, closeReason?}`.
   - `accumulator` (polarity, turn, source).
   - `hypotheses` (status `unconsidered | active | rejected`).
6. **Consumers.** L4, L5 (VERIFY/question bookkeeping), L8 (persist), L9.
7. **Guarantees.**
   - **G-L3-1** Conversation isolation: evidence from conversation X never contributes to belief in conversation Y. A previous issue may only be surfaced as a *label* (for L5/L6 to ask "is this about X again?"). Its evidence enters only if the customer answers yes.
   - **G-L3-2** Contradiction lowers belief: a `no` answer to a discriminating question, a `no` to VERIFY, or an explicit denial emits `contradicts` evidence and lowers that scenario's confidence.
   - **G-L3-3** Rejection is reachable: a hypothesis driven below the rejection threshold becomes `rejected` and stays excluded until new supporting evidence arrives.
   - **G-L3-4** Episode lifecycle:
     - An episode expires after `memory_context_minutes`, based on `lastEvidenceAt`.
     - Closing an episode is explicit (`closeReason: resolved_by_customer | expired | superseded`) and leaves the closed episode summary in state for audit/trace.
     - A new episode starts empty.
   - **G-L3-5** Evidence aging: evidence older than N turns in the same episode carries reduced weight. N and the decay are set from data; a conversational token can never pin a hypothesis forever.
   - **G-L3-6** Existing guarantees kept: determinism, retrieval exactness, sparse-state equivalence.
8. **Tests.**
   - Unit: contradiction math; rejection transition; decay; episode expiry with an injected clock.
   - Integration L1→L3: negated denial → `contradicts`.
   - Multi-session E2E: chat 1 evidence absent from chat 2 belief (B, B2).
   - Multi-turn: VERIFY "no" lowers the verified scenario.
   - Property: belief after N unrelated turns no longer ranks a one-token stale hypothesis first.
9. **Prevents:** B, B2, C (state wipe), stale tickets, VERIFY "no" followed by the same answer.

### Layer 4 — Ranking

1. **Target responsibility.** Compare **active, non-rejected problem** hypotheses. Flag a calibrated ambiguity. Offer discriminating questions and alternatives.
2. **Current.**
   - Correct code, but ambiguity is computed on weak or stale pairs.
   - It ranks conversational hypotheses.
   - It refetches the full catalog every turn.
   - `collectAlternatives` lives in the bridge.
3. **Remove.** The catalog refetch (use L3's scored set and L2's map).
4. **Inputs.** Hypotheses (L3), scenario map (L2), activation threshold, ambiguity policy.
5. **Outputs.** `RankingResult` + `alternatives[]` (moved from the bridge) + `ambiguity {isAmbiguous, gap, floorMet}`.
6. **Consumers.** L5, L6 (alternatives), L7 (top-K candidates to ground), L9.
7. **Guarantees.**
   - **G-L4-1** Rejected or conversational hypotheses are never candidates.
   - **G-L4-2** Ambiguity requires both rivals above a confidence floor; the floor is derived from data and lies between activation and resolution. Two weak, stale hypotheses are "uncertain", not "ambiguous".
   - **G-L4-3** Alternatives list only candidates at or above activation.
   - **G-L4-4** Ordering is deterministic (exists).
8. **Tests.**
   - Unit for G-L4-1 and G-L4-2.
   - Integration L3→L4 with contaminated input proving exclusion.
   - E2E: a fresh "how do I use the API" with no other evidence → not ambiguous (B chat 3, last turn).
9. **Prevents:** B, B2 (premature ambiguity tickets).

### Layer 5 — Decision

1. **Target responsibility.** The **single owner of "what happens next" for every turn**:
   - diagnostic turns;
   - conversational turns;
   - answers to pending prompts;
   - escalation;
   - the ticket lifecycle;
   - memory requests;
   - closing.

   It outputs the **exact effect to execute** and the decision state **as it will be if that effect commits**. Every route is an evaluated rule.
2. **Current.**
   - It decides only the pipeline turns.
   - The bridge then overrides its decision in five ways (confirm, decline, duplicate, disabled, trust).
   - `ticketAlreadyCreated` records intent.
   - R6C is dead (`Infinity`).
   - R6B treats any new detail as failure.
   - R6 tickets at turn 2.
   - VERIFY answers are not consumed.
   - Evidence requests are dead ends.
   - `REQUEST_ACCOUNT_DETAILS` is unreachable.
3. **Remove.**
   - `ticketAlreadyCreated` (replaced by a ticket lifecycle field).
   - R6C at `Infinity`: set a finite, data-derived value with a test, or delete it. Decision required.
   - Branches that cannot fire until their data exists (`REQUEST_ACCOUNT_DETAILS` stays only if L2/L7 supply live tokens).
4. **Inputs.**
   - L1 signals.
   - L4 ranking.
   - L7 grounding (knowledge status per candidate; account context: open tickets, subscription).
   - Trust envelope capabilities.
   - Previous decision state (including `pendingPrompt`).
   - Policy (from settings) and clock.
5. **Outputs.** `{decision, nextDecisionState}`:
   - `decision` = `{route, action, effect, scenarioId, …, evaluatedRules}`.
   - `effect` ∈ `none | persist_reply | create_ticket | request_handoff | queue_review | write_facts | forget_facts | close_episode`.
   - `nextDecisionState` holds:
     - `ticket {state: none|proposed|created|declined|existing|unavailable|withheld, ref?, at}`;
     - `pendingPrompt {kind: confirm_ticket|verify|question|attachment, payload, askedAt, expiresAt, reasks}`.
6. **Consumers.** L6 (render), L8 (execute exactly `effect`), L3 (answer evidence), L9.
7. **Guarantees.**
   - **G-L5-1** Facts, not intentions: `ticket.state = 'created'` appears only in the state committed *together with* a `create_ticket` effect. A proposed ticket is `proposed`. A decline is `declined`. A trust-withheld ticket is `withheld`. No later decision may claim an existing ticket unless `ticket.state ∈ {created, existing}` and L7 confirms it.
   - **G-L5-2** Prompt expiry: every `pendingPrompt` has `expiresAt`. An expired prompt never interprets a message; the message is processed as a fresh turn.
   - **G-L5-3** Confirmation semantics:
     - `yes` → exactly one `create_ticket` effect.
     - `no` → `declined` + `queue_review` (+ handoff for escalations).
     - A message with `diagnosticContent` → processed as evidence; the prompt is superseded, never treated as a decline.
     - `unclear` → re-ask at most once, then continue as a normal turn.
   - **G-L5-4** Truthful closing: `COMPLETE` + `close_episode` only when the resolution signal is `resolved` and not negated, after an `ANSWER`. `unresolved` (or negated resolved) after an `ANSWER` goes to the R6B path.
   - **G-L5-5** Ambiguity escalation: no ticket on ambiguity before at least one clarifying attempt, and never on a pair below the L4 floor.
   - **G-L5-6** Post-answer detail: new evidence after an `ANSWER` that supports the same scenario is *not* by itself failure. A ticket requires an `unresolved` signal, a contradiction of the answer's premise, or K further turns.
   - **G-L5-7** Grounded answers only: a knowledge-backed `ANSWER` requires L7 status `verified`. Otherwise the decision is an honest alternative (ask, ticket, or "I can't access that"). It is never a fabricated "try later".
   - **G-L5-8** Capability-respecting: never emits an effect the trust envelope forbids. The withheld state is recorded and rendered honestly.
   - **G-L5-9** Attachment loop closes: after an evidence request, an attachment token or "skip" resolves it. A ticket created after an attachment references the attachment.
   - **G-L5-10** Every route is a rule in `evaluatedRules`, including social, memory, escalation and prompt answers.
   - **G-L5-11** Emotion escalation needs more than a lexicon hit: an explicit human request escalates immediately; anger escalates only above an intensity threshold and with problem context or repetition; sarcasm needs negative context (a prior failed resolution or a complaint).
8. **Tests.**
   - Unit: one per rule and per state transition, including the ticket lifecycle table and the prompt state machine with an injected clock.
   - Integration L4→L5→L6 with real modules.
   - `runSieTurn` E2E per guarantee.
   - Multi-turn: decline → re-propose → accept ⇒ exactly one ticket.
   - Production-settings golden suite.
   - Mutation check: flipping each guarantee's condition must fail a named test.
9. **Prevents:** B, D1, D2, D3, E, G, C, F1, F2, H (decision side), I, I2.

### Layer 6 — Dialogue

1. **Target responsibility.** The **only producer of customer-visible text**, for every decision on every route. Each rendered reply declares the claims it makes, and those claims must be supported by the decision and state.
2. **Current.**
   - It renders pipeline turns only.
   - About a dozen constants live in the bridge and L1.
   - The emotion prefix can contradict the body.
   - The `alreadyTicketed` text asserts a ticket that does not exist.
   - The clarifying question never varies.
   - `TICKET_DECLINE_TEXT` is dead.
3. **Remove.** Nothing to remove from this layer itself; it *absorbs* all customer text from the bridge and L1. Dead constants are deleted.
4. **Inputs.** Decision (+ grounded data, ticket ref, alternatives), language, emotion signal, customer facts (name), prompt payloads.
5. **Outputs.** `{text, options, claims[], templateId}`. `claims` ⊆ {`ticket_exists`, `ticket_opened_now`, `issue_resolved`, `handoff_requested`, `data_unavailable_transient`, `data_unavailable_unsupported`, …}.
6. **Consumers.** L8 (sends exactly this), L9 (sent text, templateId, claims).
7. **Guarantees.**
   - **G-L6-1** Single source: no customer-visible literal outside `sie/dialogue/templates/*`. Enforced by a static test that scans the bridge, L1 and L7 for Arabic and English customer strings.
   - **G-L6-2** Claims are supported by the decision/state:
     - `ticket_exists` requires `ticket.state ∈ {created, existing}`.
     - `issue_resolved` requires `COMPLETE`.
     - `data_unavailable_transient` requires an L7 `error` status, never `unsupported`.

     A violated claim falls back to a safe template and is flagged in the trace. This is a render-time contract inside L6, not a new layer.
   - **G-L6-3** Coherent tone: the acknowledgement prefix is chosen from the decision. A satisfaction/thanks acknowledgement only accompanies `COMPLETE` or `REPLY_SOCIAL`.
   - **G-L6-4** Never throws; every action and route has ar and en templates (exists, extended to all routes).
   - **G-L6-5** Clarifying questions vary by attempt number and reference what is already understood.
8. **Tests.**
   - Template coverage for every route × language.
   - Claim-support table tests.
   - Static single-source scan.
   - E2E: the C2 contradiction cannot render.
   - E2E: the phantom text in E cannot render.
9. **Prevents:** C2, E (text), H (text), K1 (sent text known).

### Layer 7 — Knowledge

1. **Target responsibility.** **Ground** candidate decisions *before* L5 decides. Return data from static content, published DB knowledge and the customer's live account, each with provenance and a status that separates *available* from *verified*.
2. **Current.**
   - It runs after Decision.
   - It applies to 4/924 scenarios.
   - Live knowledge is a permanent stub.
   - Published DB entries are never read.
   - `knowledge_priority=live_first` and `knowledge_use_live_data` are no-ops.
   - Article rescue and the duplicate-ticket lookup live in the bridge.
3. **Remove.**
   - The post-decision composition position.
   - The stub as the production provider.
   - The bridge's `rescueWithArticle` / `findOpenTicket` (absorbed here).
4. **Inputs.** Top-K candidates (L4), userId, the caller's RLS client, settings (sources enabled, priority, timeout).
5. **Outputs.**
   - `Grounding`:
     - `byScenario {status: verified|unavailable|unsupported|error|not_applicable, source: static|published|live, data, fetchedAt}`;
     - `accountContext {openTickets[], subscription{state, expiresAt}}`;
     - `customerFacts {name, role, company}`.
   - Account context also feeds L3 as live evidence.
6. **Consumers.** L5 (decides with it), L6 (renders it), L3 (live evidence), L9.
7. **Guarantees.**
   - **G-L7-1** `verified` only when the source answered successfully with non-empty data.
   - **G-L7-2** `unsupported` (no provider for this source) is distinct from `error` (a transient failure). Only `error` may render "try again later".
   - **G-L7-3** Published DB knowledge is served (merged over static, validated versions only). The `knowledge_*` settings change behaviour, each proven by a test.
   - **G-L7-4** Live reads run under the caller's RLS, so customer A can never ground on customer B's data. Tested with two users.
   - **G-L7-5** Bounded: each source has a timeout. A timeout yields `error`, never a hang, and is traced.
   - **G-L7-6** Ticket status and subscription status answer from real rows; with no rows, they say so ("you have no open tickets").
8. **Tests.**
   - Unit per provider (static, published, live) with a mock query client.
   - Two-user RLS isolation (SQL test in `sie-integration/tests/sql`).
   - Integration L4→L7→L5.
   - E2E: H answered from data.
   - E2E: B2's duplicate path uses real open tickets.
   - Settings-effect tests (`live_first`, `knowledge_use_live_data=false`).
9. **Prevents:** H, the B2 ticket, unsupported "still open" claims (E).

### Layer 8 — Action

1. **Target responsibility.** Execute **exactly** the effect L5 decided, with the text L6 rendered and the state L3/L5 produced. Commit the message, state, effect and metering in **one transaction**. Return the executed outcome.
2. **Current.**
   - The core is correct and atomic.
   - Quota is charged before any work, with no refund.
   - Telegram writes `bot_state` a second time outside the transaction.
   - Handoff, review-queue and fact writes are done ad hoc by the bridge.
   - `lastTurnAt` is stamped only on the pipeline path.
   - The trace write result is ignored.
3. **Remove.**
   - Effect substitution (it executes only `decision.effect`).
   - The upfront charge (moved to commit).
   - The Telegram `saveState` after a persisted turn.
4. **Inputs.** `decision.effect`, `rendered`, `{diagnosticState, decisionState, language}`, session, port, clock.
5. **Outputs.** `ActionResult {committed, effects:[{type, status, ref}], ticketNumber, chargedQuota}`.
6. **Consumers.** Orchestrator (the reply), L9 (executed outcome).
7. **Guarantees.**
   - **G-L8-1** One turn = one commit = one outcome record.
   - **G-L8-2** Every state write is stamped (`lastTurnAt`, episode timestamps) by L8 itself, on every route. Callers cannot omit it.
   - **G-L8-3** Charged only when delivered: quota is consumed in the commit, or refunded if no reply commits. Requires a Mad3oom DB change (§6).
   - **G-L8-4** Single writer: no other component writes `bot_state` (Telegram double write removed).
   - **G-L8-5** No substitution: the executed effect equals `decision.effect`, asserted in code and in tests.
   - **G-L8-6** Failure is visible: `committed:false` is returned and traced, never swallowed.
8. **Tests.**
   - Unit per effect type.
   - Port contract tests.
   - E2E: effect executed equals effect decided, for every route.
   - Telegram channel test proving one write.
   - Failure injection: RPC error after the charge → refund or no charge.
   - SQL tests for the metering RPC.
9. **Prevents:** G (stamp), E (exact effect), lost quota, the Telegram race.

### Layer 9 — Observability

1. **Target responsibility.** A **truthful and complete** record of every paid turn: what each layer did, what was decided, what was executed and what was sent. Plus offline validation that **gates** catalog, knowledge and settings changes.
2. **Current.**
   - Only pipeline turns are traced.
   - It logs intent, not outcome.
   - Shadow agreement is structurally always false.
   - Clean trust verdicts are null.
   - The learning queue is narrow.
   - The Validation Lab is a demo.
   - The publish gate is uncalled.
3. **Remove.**
   - The shadow comparison's structural `kind` diff, until both sides produce a comparable kind.
   - The demo "publish" in the Review Center, until it is wired.
4. **Inputs.** All layer outputs, `ActionResult`, sent text, timings per layer.
5. **Outputs.** One trace row per paid turn:
   - `route`, the matched rule;
   - `layers[]` (`{layer, status: ran|noop|skipped, reason, ms}`);
   - `decisionIntent`, `executedOutcome`, `sentText`, `templateId`, `claims`;
   - `trust` (always, when enabled), `shadow`, `catalogVersion`, `settingsHash`.
6. **Consumers.** Learning queue view, Review Center, replay/validation tooling, and the audit reproductions turned into regression checks.
7. **Guarantees.**
   - **G-L9-1** Coverage: traces == paid turns, on every route.
   - **G-L9-2** Fidelity: `sentText` equals the reply returned to the channel.
   - **G-L9-3** Intent and outcome are separate fields. A ticket proposal that was not executed is visible as such.
   - **G-L9-4** Trust is observable: when the boundary is enabled, every trace carries its verdict, including `trusted`.
   - **G-L9-5** Shadow is meaningful: identical decisions ⇒ `agreed:true`. Only fields both sides produce are compared.
   - **G-L9-6** The learning queue includes escalations, declines, `withheld`, re-contact within 24 h after `COMPLETE`, and tickets whose scenario confidence is below a review floor.
   - **G-L9-7** Gated publishing: publishing a scenario or knowledge version requires a passing validation run, or a recorded override with a reason. This is enforced in the DB RPC, not only in JS.
   - **G-L9-8** Trace write failures are surfaced (counted and logged), never silent.
8. **Tests.**
   - E2E coverage test over every route (quota count == trace count).
   - Sent-text equality.
   - Shadow agreement on identical inputs.
   - Learning-queue SQL view tests.
   - Publish-gate SQL tests (refuse without a validation run).
   - Trace failure injection.
9. **Prevents:** K1, K2, K3, the ungated publish, and the blindness that let every other finding persist.

---

## 3. The seventeen P0 issues — coverage matrix

Each P0 lists its owning layer(s), the fix, the guarantees involved, and the required regression tests. Every test is written **before** the fix and must fail on the current code.

Test-type columns:
- **U** unit
- **LI** layer integration
- **E2E** full `runSieTurn`
- **MT** multi-turn
- **MS** multi-session
- **PS** production-settings
- **ADV** adversarial/negative

| # | P0 issue | Owner | Fix (summary) | Guarantees | Audit | U | LI | E2E | MT | MS | PS | ADV |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | Negation and confirmation mistakes | L1, L5 | negation scopes; token-based reply polarity; restated problem supersedes the prompt | G-L1-2, G-L1-5, G-L5-3 | D2, D3, C | ✔ | ✔ | ✔ | ✔ | | ✔ | ✔ |
| 2 | Arabic word-boundary problems | L1 | Unicode-boundary / token matcher for all lexicons; collision corpus | G-L1-1 | D1, D2, F1 | ✔ | ✔ | ✔ | | | ✔ | ✔ |
| 3 | False resolution detection | L1, L5 | negated resolution ≠ resolved; COMPLETE only after ANSWER with an un-negated signal | G-L1-2, G-L5-4 | C, C2 | ✔ | ✔ | ✔ | ✔ | | ✔ | ✔ |
| 4 | False emotion/escalation | L1, L5 | boundary-safe lexicon; sarcasm needs negative context; anger intensity + context rule | G-L1-1, G-L1-7, G-L5-11 | F1, F2 | ✔ | ✔ | ✔ | ✔ | | ✔ | ✔ |
| 5 | Cross-conversation contamination | L3 (+L5/L6 for "same issue?") | no evidence import; label-only recall; episode isolation | G-L3-1, G-L3-4 | B, B2 | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ |
| 6 | Phantom ticket state | L5, L8, L6 | ticket lifecycle; state from the committed effect; claim check | G-L5-1, G-L8-5, G-L6-2 | E, D3 | ✔ | ✔ | ✔ | ✔ | | ✔ | ✔ |
| 7 | Ticket confirmation/decline handling | L5 (L1 polarity) | prompt state machine; `yes` → one ticket; `no` → declined; content → supersede; bounded re-ask | G-L5-3, G-L1-4, G-L1-5 | D1–D3, E | ✔ | ✔ | ✔ | ✔ | | ✔ | ✔ |
| 8 | Pending prompt expiry | L5, L8 | `expiresAt` on every prompt; L8 stamps every write | G-L5-2, G-L8-2 | G | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | |
| 9 | State wiped after a false resolution | L3, L5 | explicit episode close only on a true COMPLETE; closed episode retained | G-L3-4, G-L5-4 | C | ✔ | ✔ | ✔ | ✔ | | ✔ | ✔ |
| 10 | Knowledge not using live data | L7 | live + published providers; grounding before L5; provenance status | G-L7-1…5 | H | ✔ | ✔ | ✔ | | | ✔ | ✔ |
| 11 | Ticket status cannot read real data | L7, L5 | live tickets/subscription under RLS; grounded ANSWER only | G-L7-4, G-L7-6, G-L5-7 | H | ✔ | ✔ | ✔ | | | ✔ | ✔ (2-user RLS) |
| 12 | Evidence only increases | L3, L4 | `contradicts` from answers/VERIFY/denials; decay; reachable rejection | G-L3-2, G-L3-3, G-L3-5, G-L4-1 | B, C2 | ✔ | ✔ | ✔ | ✔ | | ✔ | ✔ |
| 13 | Attachments never reach the engine | L1, L5, L8 (+ channels) | attachment metadata input → tokens → rule closes the request → ticket references it | G-L5-9 | E | ✔ | ✔ | ✔ | ✔ | | ✔ | ✔ |
| 14 | Incorrect or incomplete observability | L9, L8 | trace on every route; intent vs outcome; sent text; trust always | G-L9-1…4, G-L9-8 | K1, K3 | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | |
| 15 | Shadow comparison cannot agree | L9 | compare only comparable fields; agreement test on identical decisions | G-L9-5 | K2 | ✔ | ✔ | ✔ | | | ✔ | |
| 16 | Production settings not tested | all | settings-profile fixtures; golden suite runs per profile | all | all | | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ |
| 17 | Untested controller in `sie-chat-bridge.js` | all → bridge emptied | relocation map §1; static test: bridge holds no text, no classifier, no state mutation | G-L6-1, G-L5-10, G-BR-1 | all | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | |

**G-BR-1 (orchestrator):** for a handled turn, `sie-chat-bridge.js` calls L1→L2→L3→L4→L7→L5→L6→L8→L9 in that order. It has exactly one success return path. It contains no customer-text literal, no regex classifier and no direct state mutation. Enforced by a structural test and by the E2E coverage test (G-L9-1).

---

## 4. Test strategy

### 4.1 Red first, for every P0

1. Write the regression test against **current** code and run it. It must fail; the failure output goes in the PR description.
2. It lands as `test(name, { todo: 'P0-n: red before fix' }, …)`. Node reports it without breaking CI.
3. The fix commit removes `todo`. The test must now pass.
4. A mutation that reverts the fix's core condition must make the test fail again (`scripts/mutation-check.mjs`).

The 21 audit reproductions are converted the same way. Each becomes a regression test asserting the **correct** behaviour. `conversations.mjs` stays as an audit tool and must report "not reproduced" for every fixed finding.

### 4.2 Test layers and where they live

| Kind | Location | Drives | Purpose |
|---|---|---|---|
| Unit | `sie/<layer>/tests/` | one module | the function works in isolation |
| Layer integration | `sie-integration/tests/layers/` | 2–4 real layers, no DB | one layer's output is actually consumed correctly by the next |
| Runtime E2E | `sie-integration/tests/runtime/` | real `getSieReply` with the recording Supabase double (promoted from `scripts/audit-2026-10/harness.mjs`) and an injected clock | the layer works *as part of SIE* |
| Golden conversations | `sie-integration/tests/golden/*.json` + one runner | multi-turn and multi-session scripts with expectations per turn: route rule, decision, executed effects, template id, claims, trace count | behaviour over time |
| Settings profiles | `sie-integration/tests/fixtures/settings/{defaults,production-snapshot,strict,permissive}.json` | the golden runner runs every conversation under every profile | production settings are covered |
| Adversarial | `sie-integration/tests/adversarial/` | generated collision corpus, negation corpus, Arabizi, mixed greeting+problem, long multi-problem, trust attacks, prompt-answer confusions | negative behaviour |
| SQL | `sie-integration/tests/sql/` | RLS isolation, metering-at-commit, publish gate, learning-queue view | DB-enforced guarantees |
| Structural | `sie-integration/tests/structure/` | static scans | G-BR-1, G-L6-1, no `Date.now()` in layers |

### 4.3 Guarantee registry

`docs/SIE-GUARANTEES.md` lists every guarantee id in §2 with its statement. `sie-integration/tests/guarantees.test.mjs` is a meta-test that fails if:
- a registered id has no test whose title contains `[G-…]`;
- a P0 row in §3 lacks a test in any column marked ✔;
- a test references an unregistered id.

This turns the target ("every important behavioural guarantee is explicitly tested") into something CI checks.

### 4.4 Corpora (all synthetic)

- **Real-problem precision corpus:** ≥300 synthetic problem statements across catalog domains, including greeting-prefixed, `انا`-prefixed, negated and emotional ones. No escalating emotion, no positive resolution, no whole-message small talk, no explicit memory capture is allowed.
- **Collision corpus:** generated, as every detector phrase × every glossary/catalog/Arabic-wordlist entry containing it.
- **Negation corpus:** ≥40 forms, Egyptian and MSA.
- **Prompt-answer corpus:** yes/no/unclear/content, including button values.
- **Multi-session scripts:** at least the B and B2 chains, closing and re-contact, expiry across a day.

### 4.5 Determinism prerequisites (small, enabling changes)

- Inject `clock` into `runSieTurn` and every layer that reads time.
- Promote the audit harness to a test helper.
- Fixture the production settings *values*, never customer data.

These land first, in WP1, because every later test depends on them.

---

## 5. Work packages and order

Each work package (WP) is one PR or a small series. Exit criteria apply to every WP:
- Its guarantees' tests pass.
- Its audit reproductions report "not reproduced".
- The full suite and the golden suite pass under every settings profile.
- Both edge functions are re-pinned to the **same** commit.

| WP | Content | Layers | Depends on | P0s closed |
|---|---|---|---|---|
| **WP1** | Test foundation: clock injection; harness → test helper; settings-profile fixtures; golden runner; guarantee registry + meta-test; the 21 reproductions as red `todo` regression tests | infra | — | 16 (partially), 17 (scaffold) |
| **WP2** | Truthful observability: a trace on every route; intent vs outcome; sent text; trust always; layer status list; shadow comparator fix; checked trace writes | L9, L8 | WP1 | 14, 15 |
| **WP3** | Language primitives: Unicode-boundary / token matcher; negation scopes; reply polarity; detectors on tokens; `diagnosticContent`; texts moved out; corpora | L1 (+L6 receives text) | WP1 | 1, 2, 3 (detection), 4 (detection) |
| **WP4** | Decision owns every route: pending-prompt state machine with expiry; ticket lifecycle; confirmation semantics; social/memory/escalation/closing rules; CP3b as input; L8 stamps every write and executes only `effect`; bridge emptied per §1 | L5, L8, L6, bridge | WP2, WP3 | 3, 4, 6, 7, 8, 9, 17 |
| **WP5** | Belief that can go down: episodes; no cross-chat import; `contradicts` from answers/VERIFY/denials; decay; reachable rejection; L2 conversational tagging; L4 exclusion and ambiguity floor | L3, L2, L4 | WP4 | 5, 12 |
| **WP6** | Grounding before deciding: live (tickets, subscription) and published providers; provenance status; knowledge before L5; duplicate-ticket via account context; customer facts | L7, L5, L6 | WP4 | 10, 11 |
| **WP7** | Attachments: runtime input, channel passthrough, L1 tokens, L5 rule, ticket reference | L1, L5, L8 (+channels, Mad3oom) | WP4; Mad3oom changes | 13 |
| **WP8** | Metering at commit; remove the Telegram double write; DB-enforced publish gate; learning-queue view update | L8, L9 (+Mad3oom DB) | WP2; Mad3oom changes | 14 (remainder), G-L8-3, G-L9-7 |
| **WP9** | Dialogue consolidation: claims contract, varied clarifying questions, tone coherence, static single-source test | L6 | WP4 | 6 (text), 3 (C2 text) |

WP2 comes before the behavioural fixes on purpose: without complete, truthful traces, the effect of WP3–WP9 on real traffic cannot be measured.

---

## 6. Dependencies outside this repository

| Change | Owner | Needed by |
|---|---|---|
| Metering inside the turn commit (or a refund RPC) | Mad3oom DB | WP8 (G-L8-3) |
| `create_ticket_with_message_and_session_update` accepts attachment references | Mad3oom DB | WP7 |
| `sie-api` body and Telegram adapter pass attachment metadata | `sie-api`, `channels/` | WP7 |
| `publish_chat_engine_scenario/knowledge` refuse without a passing validation run or a recorded override | SIE migration (`sie/observability/migrations`) | WP8 (G-L9-7) |
| Read access for live knowledge (tickets, subscriptions) under the caller's RLS | Mad3oom RLS policies (verify) | WP6 |
| Trace columns for outcome, sent text, layer status (jsonb is acceptable; the schema stays readable) | SIE migration | WP2 |

---

## 7. Decisions needed from you before implementation

1. **Interim production mitigations (configuration only, no code):**
   - Set `memory_use_past_conversations=false`. This stops cross-chat contamination immediately.
   - Set `shadow_run_enabled=false`. Its output is meaningless today and it adds latency.

   Recommended, but they change production behaviour, so they are yours to approve.
2. **Conversational scenarios (205 `convo_*`):** tag and exclude first, then triage (recommended), or delete in one step.
3. **Decision vocabulary:** extend L5's action set with explicit routes (`REPLY_SOCIAL`, `CONFIRM_TICKET`, `EXISTING_TICKET`, `TICKETS_UNAVAILABLE`, `MEMORY_ACK`) (recommended), or keep the 12 actions and add a separate `route` field.
4. **R6C:** derive a finite cap from data and test it, or delete the rule.
5. **`typo-tolerance.js`:** delete it, or wire it into glossary lookup with tests.
6. **Attachments scope:** metadata only (presence, type, name; no content analysis) is recommended for this phase.
7. **Cross-repo work:** approve the Mad3oom DB changes in §6 (metering, ticket attachments, RLS verification). Without them, WP7 and WP8 can only be partially completed.
8. **Behaviour-change rollout:** each behavioural WP ships behind a settings flag (default: current behaviour) with the golden suite run in both states, then is enabled in production after its traces look right (recommended). The alternative is to ship directly.
