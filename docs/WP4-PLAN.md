# WP4 — Decision owns every route: audit and implementation plan

**Status:** APPROVED 2026-10-07 with owner decisions D1–D4 (D1: empty the bridge in WP4; D2: `ticket_prompt_minutes`, default 30, bounding the question, not the answer; D3: the context rule with the kill switch `emotion_escalation_requires_context`; D4: REG-J stays red, Trust thresholds and CP1 unchanged). IMPLEMENTED 2026-10-08 (commits ecc3e77 red-first, 1c7dae3 Layer 1, 9c02673 Layer 5/6/8 + orchestrator, and the verification commit after it). DEPLOYED 2026-10-08 21:23 UTC as `cc3b9f7` (sie-api v24, sie-channel-telegram v28; docs/DEPLOYMENTS.md). Rollback: `d2bff13`.

**Implementation notes (differences from the plan below):** the bridge was emptied in the same change (D1), not staged. Found during production-profile verification and fixed with goldens: feelings after «انا» were stored as the customer's name once anger and praise stopped escalating (REG-F10); an account's existing ticket was reminded as "the ticket we opened" (REG-L5-1e). Per-problem bookkeeping (evidence request, account details, verification) is reset when the customer moves on to a new problem. A legacy ticket question without `expiresAt` is treated as live (its unclear answers are still bounded to one re-ask).
**Baseline:** commit `4369e57` (WP3 deployed as `d2bff13`), full suite 1,264 / 1,264.
**Reproductions:** `scripts/audit-2026-10/wp4-reproductions.mjs` (31 synthetic probes, real runtime) and `scripts/audit-2026-10/r6c-value.mjs` (R6C measurement).
**Constraints kept:** no new layer; Trust CP1 keeps reading the full received text; attachments stay metadata-only; `memory_use_past_conversations`, `shadow_run_enabled` and `language_typo_tolerance` stay `false`.

---

## 1. Current WP4 architecture map

What happens on one turn today (`sie-integration/sie-chat-bridge.js`, after WP3). **B** = decided by the bridge, outside Layer 5.

| Step | Where | Owner today | Target owner |
|---|---|---|---|
| Settings / handoff / quota gates | bridge 840–860 | bridge | unchanged in WP4 (quota → L8 in WP8) |
| Context expiry `recallPreviousState` | bridge 328, 876 | **B** | L5 (prompt expiry) + L8 (stamp) |
| Language + signals | bridge 881–904 | L1 ✔ (WP3) | L1 |
| **Route A** pending ticket answer → `resolvePendingTicketConfirmation` | bridge 462, 910 | **B** — skips L2–L7 | L5 prompt state machine |
| **Route B** escalation (human request / anger / sarcasm / bot-frustration) → `escalateImmediately` | bridge 606, 946–962 | **B** — skips diagnosis | L5 escalation rule, diagnosis still runs |
| Trust CP1 `openTurn(raw text)` | bridge 986 | Trust ✔ | **unchanged** (owner decision) |
| **Route C** memory | bridge 995–1006 | **B** | L5 rule + L8 effect |
| **Route D** resolution close → `closeConversation` (wipes all state) | bridge 216, 1009–1016 | **B** | L5 closing rule |
| Emotion acknowledgement prefix | bridge 1019–1024 | **B** | L6 |
| **Route E** small talk | bridge 1032–1047 | **B** | L5 social rule, text L6 |
| Catalog, diagnosis, ranking | bridge 1050–1140 | L2/L3/L4 ✔ | unchanged |
| `decide()` + edition `freeFloor` | bridge 1142–1170 | L5 ✔ | L5 |
| Knowledge compose + **article rescue** (CREATE_TICKET → ANSWER after the decision) | bridge 1176–1196 | **B** override | L7 grounding before L5 (WP6); WP4 records it truthfully |
| **CP3b** `admitAction` (downgrade after the decision) | bridge 1209 | **B** override | L5 input (capabilities) |
| Render + persist | bridge 1243–1385 | L6 + **B** | L6, L8 |
| **Duplicate-ticket** override `findOpenTicket` | bridge 1329–1345 | **B** override | L5 rule (`ticket.state = existing`) |
| **Tickets disabled** override | bridge 1346–1357 | **B** override | L5 rule (`ticket.state = unavailable`) |
| **Ask-before-ticket** (CREATE_TICKET → confirmation prompt) | bridge 1358–1372 | **B** override | L5 prompt rule |
| Handoff after ESCALATE | bridge 1390–1393 | **B** | L8 effect |
| Trace | bridge `finally` | L9 ✔ (WP2) | L9 |

A second copy of the routing rules lives in `sie/pipeline/interpretation.js` (the vNext / shadow pipeline). It already reads the WP3 signals but decides routes with its own code.

### Conversation state inventory (`bot_state.sie`)

| Field | Written by | Lifetime today | Defect |
|---|---|---|---|
| `lastTurnAt` | diagnostic route only | — | escalation, pending, memory, small-talk, close routes do not stamp → their state never expires (G) |
| `pendingTicketConfirmation` | bridge | until answered; **no `expiresAt`, no re-ask count** | stale prompt captures unrelated messages next day (G, P10); unbounded re-ask (D1-unclear) |
| `decisionState.ticketAlreadyCreated` | `decide()` on **any** CREATE_TICKET/ESCALATE decision; `escalateImmediately` on a **proposal** | sticky forever | records intent: true after a proposal, a decline, a withheld, disabled or duplicate ticket (E, R3, P8) |
| `decisionState.resolvedByCustomer` | `decide()` on COMPLETE | sticky forever | an answered scenario closes quietly ever after unless "unresolved" |
| `decisionState.answeredScenarioIds` | `decide()` | context window | R6B treats any later token as failure (I) |
| `decisionState.pendingQuestion` | `decide()` | next decision | fine (exact button-value match, not a classifier) |
| `diagnosticState` | diagnostic route | context window | wiped entirely by Route D even when a second problem remains (R2) |
| `lastCustomerText` | diagnostic + memory routes | context window | not refreshed by small talk (minor) |

---

## 2. Remaining red regressions relevant to WP4

### Existing (from WP1–WP3)

| Golden | Today fails on | Root cause |
|---|---|---|
| REG-C3-resolved-plus-new-problem-is-diagnosed | close reply, no hypotheses, state wiped | RC2 |
| REG-D3-restated-problem-at-prompt | restated problem not diagnosed (re-ask) | RC3 |
| REG-D1-unclear-reask-is-bounded | second unclear answer re-asks again | RC3 |
| REG-E-no-phantom-ticket | "yes" after a decline creates no ticket, says "still open" | RC1 |
| REG-G-pending-prompt-expires | no `lastTurnAt` on the escalation route; prompt next day | RC3, RC4b |
| REG-F2-sincere-praise-is-not-sarcasm | escalation | RC5 |
| REG-F2b-polite-closing-is-not-anger | escalation | RC5 |
| REG-I-detail-after-answer-is-not-failure | ticket after a detail | RC6 |
| REG-I2-no-rule-is-dead-by-construction | R6C cap is `Infinity` | RC7 |

### New, reproduced in this audit (become red goldens in step 0)

| Probe | Conversation (synthetic) | Today | Root cause |
|---|---|---|---|
| P1 → **REG-C4** | ANSWER → «المشكلة اتحلت، بس عندي مشكلة تانية في الدفع» | closed, payment problem lost, state wiped | RC2 |
| R2 → **REG-C5** | «ازاي استخدم الـ API بتاعكم والواتساب مش بيبعت رسايل» → ANSWER → «تمام اشتغلت» | closed, WhatsApp problem wiped | RC2, RC8 |
| Q6 → **REG-I3** | ANSWER → «طيب» | ticket proposal (R6B) | RC6 |
| P15 → **REG-I4** | ANSWER → «مش فاهم الخطوة التانية» | ticket proposal (R6B) | RC6 |
| Q1, P4 → **REG-D4** (diagnostic + escalation variants) | ticket question → «الفاتورة اتخصمت مرتين» | re-asks the ticket question, new problem not diagnosed | RC3 |
| Q3 → **REG-D5** | ticket question → «مش قادر ادخل على حسابي» (restated) | read as **"no"**: declined + review queued | RC9 (L1) |
| Q2 → **REG-E2** | decline → «الفاتورة اتخصمت مرتين» | re-proposes the declined login ticket, billing ignored | RC1, RC3 |
| R4 → **REG-E3** | ticket created → problem restated | asks "open a ticket?" again | RC1 |
| P10 → **REG-G2** | escalation prompt → next day «الواتساب واقف» | re-asks the stale prompt; problem lost | RC3, RC4b |
| P13 → **REG-F5** | «الواتساب مش بيبعت رسايل وانا متعصب جدا» | escalated, problem discarded | RC5, RC2 |
| P14 → **REG-F6** | «ما شاء الله على السرعة» as a first message | escalated as sarcasm | RC5 |
| P16, P17 → **REG-F7** | threat / human request **with** a problem | escalation (correct) but the problem is discarded: no diagnosis, empty ticket draft | RC2 |
| invariant | every golden turn: state claims a ticket only if one exists | violated by E, R3, P8, Q2, P4… | RC1, RC10 |

### Not defects

- P5 / P6: declining the ticket on an **escalation** hands the chat to a human, and SIE then stops answering. That is the intended handoff behaviour (`sie-handoff.test.mjs`).
- P11: an expired diagnostic prompt is dropped correctly (that route stamps `lastTurnAt`).

### Out of WP4 scope (stay red)

| Golden | Belongs to | Why |
|---|---|---|
| R1 (first-turn ambiguity ticket) | **WP5** (G-L5-5 is registered there) | also contradicts the existing unit test "Rule 6: ambiguous … → CREATE_TICKET"; needs an owner decision |
| REG-J (long multi-problem message quarantined) | **decision point D4** | caused by Trust CP1's statistical sensors (`signal_flood` ≥ 30 tokens, `domain_spray` ≥ 8 domains), not by raw-text reading |
| REG-B, B2, B-conversational, REG-12 | WP5 | evidence / episodes / convo scenarios |
| REG-H | WP6 | live data |
| REG-13 | WP7 | attachments |

---

## 3. Root causes

| RC | Root cause | Evidence |
|---|---|---|
| **RC1** | **Intent recorded as fact.** `updateDecisionState` sets `ticketAlreadyCreated` on any CREATE_TICKET/ESCALATE *decision*; `escalateImmediately` sets it on a *proposal*. Every later override (confirmation, decline, duplicate, disabled, CP3b withhold, article rescue, failed write) leaves it true. The next ticket decision becomes `alreadyTicketed`: no ticket is created and "still open" is rendered — or, via ask-before-ticket, a ticket is *re-proposed* after one was really created. | decision-engine.js 150–154, 686–688; bridge 615, 1209, 1329–1372; E, R3, R4, P8, Q2 |
| **RC2** | **Bridge routes run before diagnosis and discard the message's problem.** Escalation, pending-answer and close routes return without running L2–L5 on the message; escalation tickets carry `scenarioId: null` and an empty trail; `closeConversation` wipes the whole state. | bridge 606–672, 216–233, 910, 958, 1013; C3, P1, R2, P13, P16, P17 |
| **RC3** | **The pending prompt has no lifecycle.** No `expiresAt`, no re-ask count, never superseded by a message with problem content; any non-yes/no answer re-asks forever. | bridge 462–495; D3, D1-unclear, Q1, P4, G |
| **RC4** | **Not every write is stamped.** Only the diagnostic route writes `lastTurnAt`; (b) prompts persisted by the escalation route therefore never expire. | bridge 629–636, 1300; G, P10 |
| **RC5** | **Emotion escalates on a lexicon hit alone.** `shouldEscalateForEmotion` = anger or sarcasm, no context, no intensity, no problem check. | emotion-detector.js; bridge 950–962; F2, F2b, P13, P14 |
| **RC6** | **R6B reads any new token after an ANSWER as failure.** Evidence counts every Arabic word (including unresolved filler like «طيب»), and new evidence for a *different* problem also triggers a ticket for the answered one. | decision-engine.js 420–465; I, Q6, P15, P2 |
| **RC7** | **R6C is dead by construction** (`maxSimultaneousResolvable = Infinity`). Measured: it has negative value (§4). | decision-policy.js 48; I2 |
| **RC8** | **No record of a second active problem.** The decision addresses the leader; nothing remembers the other problem, and the close route deletes its evidence. | R2, Q8 |
| **RC9** | **L1 polarity (WP3 residue):** a leading «مش» counts as an explicit "no" even when the message carries a problem («مش قادر ادخل على حسابي» at the ticket question = decline). Also «اتحل» (masculine) is missing from the resolved lexicon. | reply-polarity.js; Q3, P2 |
| **RC10** | **Trust withholding is not recorded.** CP3b downgrades the action after `decide()`; the persisted decision state still says a ticket was made, the reply is a generic «قولي طلبك», and a quarantined turn still mutates decision state although its capabilities say `mayMutateState: false`. | bridge 1209–1214; R3 |

### Every place the engine's decision is overridden or bypassed (item 3)

1. Pending ticket answer route (Route A) — bypasses L2–L7 and `decide()`.
2. Escalation route (Route B) — bypasses L2–L5; sets `ticketAlreadyCreated` on a proposal.
3. Memory route (Route C).
4. Resolution close route (Route D) — bypasses `decide()`, wipes state.
5. Small-talk route (Route E).
6. Emotion acknowledgement prefix — bridge chooses text (L6 concern, contradicts decisions → G-L6-3, WP9).
7. Article rescue — turns CREATE_TICKET into ANSWER after the decision; decision state still records the ticket.
8. CP3b — downgrades to WAIT_FOR_USER after the decision; state not adjusted.
9. Duplicate open ticket — replaces the decision's effect; state records "created".
10. Tickets disabled — replaces the effect; state records "created".
11. Ask-before-ticket — replaces CREATE_TICKET with a prompt, including for `alreadyTicketed` decisions (R4).
12. Handoff after ESCALATE — an effect executed by the bridge, not L8.
13. Context expiry — bridge policy.
14. vNext `interpretation.js` — a parallel copy of routes 1–5.

**Raw text still read downstream of L1:** Trust CP1 (kept by owner decision), `evidenceFromQuestionAnswer` (exact match of a button value, not a classifier — WP4 passes it `language.rawText` for consistency), the shadow pipeline (off), `lastCustomerText` storage (data, not classification). No downstream classifier re-interprets text differently from L1.

---

## 4. Proposed behavioural rules and guarantees

All rules live in **Layer 5** (a new module `sie/decision/conversation-rules.js` beside `decision-engine.js` — a module, not a layer). The bridge calls L1 → L2 → L3 → L4 → L7 → L5 → L6 → L8 → L9 and executes exactly the decided effect.

**Vocabulary (owner decision 4, minimal):** no new actions. Decisions gain `route` (already traced) and `effect ∈ none | persist_reply | create_ticket | request_handoff | queue_review | write_facts | forget_facts`. Decision state gains `ticket {state, ref, at}` and extends the existing `pendingTicketConfirmation` with `askedAt, expiresAt, reasks` (name kept: existing tests and stored sessions use it). `ticketAlreadyCreated` stays as a **derived** boolean (`ticket.state ∈ {created, existing}`), so Dialogue and old readers keep working.

| Id | Rule (registered ids reused; new ids marked *new*) |
|---|---|
| **G-L5-1** | `ticket.state ∈ none → proposed → created \| declined \| withheld \| unavailable \| existing`. `created` is written only in the state committed **together with** a `create_ticket` effect (same transaction). Proposal, decline, duplicate (`existing`, from the account), disabled (`unavailable`), trust (`withheld`) and a failed write never produce `created`. Stored legacy `ticketAlreadyCreated: true` is read as `unverified` and settled by the duplicate check, never trusted. |
| **G-L5-2** | Every pending prompt has `askedAt` and `expiresAt` (= askedAt + prompt TTL, decision point D2). An expired prompt is dropped and the message is processed as a fresh turn. |
| **G-L5-3** | At a pending ticket question: yes → exactly one `create_ticket` (or "still open" if `ticket.state` is already `created/existing` — never a second prompt); no → `declined` + `queue_review` (+ handoff for an escalation); a message with diagnostic content and no leading yes/no **supersedes** the prompt and is diagnosed; unclear → one re-ask, then the prompt is dropped and the message processed normally. A declined scenario is not re-proposed on the next turn when the customer has moved to another problem. |
| **G-L5-4** | Close (`COMPLETE`) only on an un-negated `resolved` after an ANSWER **and** when no other active problem remains. `resolved` + diagnostic content in the same message → the answered problem is closed and the new content is diagnosed in the same turn (C3, C4). |
| **G-L5-6** | After an ANSWER, a ticket for the answered scenario requires an `unresolved` signal, or new **problem** evidence (diagnostic tokens) that still points to it, or K = 2 further turns. Filler words and evidence for a *different* problem are not failure. |
| **G-L5-8** | CP3b becomes an **input** to L5: a forbidden effect is never decided; `ticket.state = withheld` is recorded and rendered honestly; a quarantined turn does not mutate decision state beyond the turn counter. |
| **G-L5-10** | Every route (pending answer, escalation, memory, social, close, diagnostic) appears in `evaluatedRules`. |
| **G-L5-11** | Escalation: an explicit human request, or a threat (legal action / cancellation / refund demand — the existing anger phrases of that kind), escalates immediately. Anger otherwise escalates only with context: repeated negative turns, or after a failed resolution (answered + unresolved). Sarcasm escalates only with negative context; without it, it is acknowledged, never escalated. A polite closing («خلاص كفاية كده شكرا») is not anger. Behind a setting (decision point D3). |
| **G-L5-12** | R6C removed (measured below). |
| *new* **G-L5-13** | An escalation or a superseding answer never discards the message's problem: diagnosis runs on the turn, and the ticket draft carries the leading scenario and trail. |
| *new* **G-L5-14** | Multi-problem continuity: when one problem is closed and another active problem (above activation, different category, supported by this conversation's evidence) remains, the conversation continues with it instead of closing. |
| **G-L8-2** | The Action layer stamps `lastTurnAt` on **every** persisted state, on every route. |
| **G-L8-5** | The executed effect equals the decided effect (asserted in code and tests). |
| **G-L6-2** (ticket part only, pulled forward from WP9) | "ticket still open" / "we opened a ticket" render only when `ticket.state ∈ {created, existing}`. |
| **G-BR-1** | Stage B (decision point D1): the bridge calls the layers in order, has one success return, no classifier, no state mutation, no customer text. |
| **G-L1-5** (amendment) | A leading «مش» is a "no" only when the message carries no diagnostic content; «اتحل» added to the resolved lexicon. |

**R6C measurement (owner decision 5):** 2,716 synthetic probe messages under the production profile.

| `maxSimultaneousResolvable` | R6C fired | answers | correct | wrong |
|---|---|---|---|---|
| ∞ (today) | 0 | 1,070 | 660 | 410 |
| 8 | 0 | 1,070 | 660 | 410 |
| 5 | 8 | 1,070 | 660 | 410 |
| 3 | 101 | 1,020 | 626 | 394 |
| 2 | 243 | 950 | 582 | 368 |

At every cap where it changes anything it suppresses more correct answers than wrong ones (cap 3: −34 correct, −16 wrong). **No measurable value → remove the rule.**

---

## 5. Tests and mutation tests

**Step 0 (red first, before any fix):**
- The new goldens in §2 (C4, C5, I3, I4, D4 ×2, D5, E2, E3, G2, F5, F6, F7 ×2), each red with its exact `failingNow`, under `production` and `defaults`.
- `sie-integration/tests/invariants.test.mjs`: replays every golden conversation and checks, per turn, (a) a state that claims a ticket has a real one (world tickets or an open account ticket), (b) every persisted state carries `lastTurnAt`, (c) the executed effect equals the decided effect. Red by design: the violating goldens are pinned and the pin must shrink to `[]` by the end of WP4.
- Runner additions: `stateEquals`, `decisionScenarioNotPrefix`, `effectsInclude`.

**Unit / integration:**
- Ticket lifecycle transition table.
- Prompt state machine with an injected clock (yes / no / content / unclear ×2 / expired / already-created).
- Escalation rule table (request, threat, anger ± context, sarcasm ± context, polite closing).
- Closing / multi-problem rules.
- R6B rule table.
- Polarity amendment cases.
- E2E per route: effect executed = effect decided.
- vNext `interpretation.js` parity: it uses the same rules (shadow agreement test).

**Mutations (W4-*), one per guarantee, each must be killed by a named test:**

| Id | Mutation |
|---|---|
| W4-1 | a proposal records `created` |
| W4-2 | a decline keeps `created` |
| W4-3 | CP3b withhold records `created` |
| W4-4 | duplicate/disabled record `created` |
| W4-5 | prompt never expires |
| W4-6 | re-ask unbounded |
| W4-7 | content no longer supersedes the prompt |
| W4-8 | created ticket re-proposed |
| W4-9 | close ignores diagnostic content |
| W4-10 | close wipes a remaining problem |
| W4-11 | R6B fires on filler |
| W4-12 | sarcasm escalates without context |
| W4-13 | anger escalates without context |
| W4-14 | escalation drops the problem |
| W4-15 | L8 skips the stamp on one route |
| W4-16 | executed effect substituted |
| W4-17 | R6C re-added with a finite cap |
| W4-18 | leading «مش» with content is a "no" |

---

## 6. Files likely to change

| Area | Files |
|---|---|
| L5 | `sie/decision/decision-engine.js` (lifecycle, R6B, R6C removal, closing input), `decision-types.js` (state shape, legacy reader), `decision-policy.js`, **new** `sie/decision/conversation-rules.js` |
| L8 | `sie/action/action-layer.js` (stamp every write, exact effect, ticket state committed with the ticket), `sie/action/action-types.js` |
| L6 | `sie/dialogue/templates/conversational.js`, `ar.js`, `en.js`, `dialogue-renderer.js` (escalation, close, decline, duplicate, disabled, withheld texts move in; ticket claim check) |
| L1 | `sie/language/reply-polarity.js`, `sie/language/emotion-detector.js` (lexicon «اتحل»; threat subset exposed to L5) |
| Bridge | `sie-integration/sie-chat-bridge.js` (routes delegated; stage B empties it) |
| vNext | `sie/pipeline/interpretation.js`, `sie/pipeline/pipeline.js` |
| Settings | `sie/config/settings-schema.js` (only if D2/D3 approve settings) |
| Tests | new unit files under `sie/decision/tests/`, `sie-integration/tests/invariants.test.mjs`, `golden/regressions.json`, `helpers/golden-runner.mjs`, `structure.test.mjs` (pins lower), `guarantees.test.mjs` registry, `scripts/mutation-check.mjs` |
| Docs | `docs/SIE-GUARANTEES.md`, `docs/REMEDIATION-PLAN-SIE-9-LAYERS.md` status |

**Existing tests that will change (none deleted, none weakened):**
- `structure.test.mjs`: pins lower; at stage B it becomes the green G-BR-1 assertion.
- `trust-integration.test.mjs`: the CP1-before-memory-write locator follows the moved call.
- `sie-handoff.test.mjs`: unchanged behaviour expected; it reads `pendingTicketConfirmation`, which is why the field name is kept.
- `sparse-equivalence.test.mjs`: reads `ticketAlreadyCreated`, kept as a derived field.

**Not changed:** the Rule-6 unit test (R1 is WP5).

---

## 7. Database changes

**None required.** `bot_state` is jsonb and owned by SIE; the Mad3oom app does not read SIE's state fields (verified by code search: no reference to `pendingTicketConfirmation`, `ticketAlreadyCreated` or `decisionState` in `moudabdelwahab/mad3oom`). The ticket RPC already commits `bot_state` in the same transaction as the ticket, which is what G-L5-1 needs. The ticket number arrives after the commit and is recorded on the next write. Optional, not needed: an RPC variant that stamps the ticket number into `bot_state` atomically.

---

## 8. Risks and behaviour changes

| Change customers will see | Risk / mitigation |
|---|---|
| Fewer escalations: anger/sarcasm without context is acknowledged and diagnosed, not handed to a human | An angry customer may want a human; mitigated by: explicit requests and threats still escalate, repeated anger escalates, and the setting (D3) |
| An escalation carries the diagnosed problem into the ticket | none (strictly more information) |
| A problem stated at the ticket question is diagnosed instead of re-asked; a second unclear answer drops the prompt | the customer may need to ask for the ticket again; the engine re-proposes when warranted |
| Ticket prompts expire (D2) | a late "yes" no longer opens a ticket from an old prompt |
| "Resolved + new problem" continues instead of closing; a second open problem is pursued | longer conversations; fewer silent losses |
| No ticket proposal for «طيب» / «مش فاهم» after an answer | fewer premature tickets |
| No second ticket question after a real ticket | none |
| R6C removed | no change today (it never fires) |

**Engineering risks:**
- The bridge refactor is large: mitigated by the goldens, invariants, E2E per route and mutations, and by staging (D1).
- The stored-state shape changes: mitigated by the legacy reader and tests on old-shape sessions.
- Trace route names stay the same.
- CPU impact negligible: no new I/O, except the duplicate check moving earlier, which is the same query.

**Rollback:** re-pin both functions to `d2bff13`.

---

## 9. Recommended implementation order

0. **Red first:** new goldens, invariants test, runner keys, registry entries; verify each fails for its declared reason. Commit.
1. **L1 amendments** (RC9): polarity rule, «اتحل». Flip D5.
2. **State model** (RC1): ticket lifecycle + extended prompt fields + legacy reader in `decision-types.js`; `decide()` stops writing intent. Unit tests.
3. **L8** (RC4): stamp every write; exact-effect execution; ticket state committed with the ticket. Flip G, G2 (stamp part).
4. **L5 conversation rules** (RC2, RC3, RC5, RC8, RC10): prompt state machine, escalation rule (+ diagnosis on escalation turns), closing + multi-problem continuity, CP3b as input, social/memory rules. Flip C3, C4, C5, D1-unclear, D3, D4, E, E2, E3, F2, F2b, F5–F7, G2.
5. **Diagnostic rules** (RC6, RC7): R6B semantics, remove R6C. Flip I, I2, I3, I4.
6. **Stage B — bridge emptied** (G-BR-1): texts to L6, one success return, layer order; vNext uses the same rules.
7. Registry, mutation run (all), full suite, production profile, audit tool `FIXED` map, PII sweep, commit, report. **No deployment without approval.**

### Decision points for the owner

- **D1** Stage the bridge emptying (G-BR-1) as a second commit after steps 0–5 (recommended), or do it within the same change.
- **D2** Prompt TTL: 30 minutes as a new setting `ticket_prompt_minutes` (recommended), or reuse `memory_context_minutes` (production: 245).
- **D3** Emotion escalation rule (G-L5-11): ship it as a correction with a kill-switch setting defaulting to the new rule (recommended), or behind a flag defaulting to today's behaviour.
- **D4** REG-J: keep red (recommended for WP4). Raising the trust boundary's token thresholds is a security trade-off for a separate decision, not part of WP4.
