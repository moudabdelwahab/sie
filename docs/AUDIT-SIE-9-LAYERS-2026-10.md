# SIE — Nine-Layer Architectural & Functional Audit

**Date:** 2026-10-06 · **Code audited:** the `sie` repository @ `58e9aa5` (branch `claude/kind-knuth-imwds8`)
**Deployed engine:** website `sie-api` pinned to `ddd62a9`, Telegram `sie-channel-telegram` pinned to `39b31a6` (two different engine commits in production at once).
**Scope:** audit only. Nothing in the architecture or runtime code was changed.

---

## 0. Method and evidence

No conclusion in this report rests on "the code exists" or "the tests pass". Every claim is backed by one of:

| Evidence type | What it is |
|---|---|
| **[CODE]** | The actual call graph, traced from the two production entrypoints (`supabase/functions/sie-api/handlers/chat-reply.ts`, `channels/telegram/telegram-function.js`) through `sie-runtime.js → sie-chat-bridge.js::runSieTurn` into each module. |
| **[E2E]** | An audit harness (`scripts/audit-2026-10/`) that calls the **real** `getSieReply → runSieTurn` with **production's `sie_settings`**, the real catalogs, the real glossary and the real trust boundary. Only the database is replaced, by a recording double. It replays real conversations and adversarial ones and records which layers ran, what each produced and what the customer received. |
| **[PROD]** | Read-only SQL against the production database: `sie_settings`, `chat_engine_trace_events`, `chat_messages`, `chat_engine_*` tables. **This report contains no customer messages, identifiers or timestamps from production**; only aggregate counts, configuration values, scenario/rule identifiers and the engine's own template texts. Every conversation quoted below is synthetic. |
| **[TEST]** | The existing suite: **1,082 tests, all passing** (`npm test`, 117 s). |

**The harness reproduces production behaviour.** During the audit, replaying a chain of three real production chats through current HEAD produced the same scenario, the same confidence, the same rule (`R6_AMBIGUOUS`) and the same customer-visible replies as stored in `chat_messages`. That is what licenses treating the E2E results as production behaviour. The published harness contains **only synthetic conversations** written to trigger the same mechanisms; `node scripts/audit-2026-10/conversations.mjs` reproduces **21/21** findings with them (ids `A`–`K3` below).

### Production settings differ sharply from code defaults

Every test in the repository runs against `SIE_DEFAULT_SETTINGS`. Production runs this (read 2026-10-06):

| Setting | Code default | **Production** | Consequence audited below |
|---|---|---|---|
| `trust_boundary_enabled` / `_enforce` | false / false | **true / true** | Trust boundary enforces on real customers |
| `memory_use_past_conversations` | false | **true** | Cross-session evidence import (§2.3, P0) |
| `shadow_run_enabled` | false | **true** | Shadow run executes on every pipeline turn |
| `sparse_diagnostic_state` | false | **true** | |
| `search_past_tickets` | false | **true** | |
| `knowledge_priority` | articles_first | **live_first** | No effect: live knowledge is a stub |
| `allow_smart_guess` | false | **true** | |
| `answer_confidence` | 0.60 | **0.65** | |
| `max_clarifying_questions` | 3 | **4** | |
| `suggest_multiple_solutions` | false | **true** | |

**No test exercises this combination.** `memory_use_past_conversations`, `search_past_tickets` and `knowledge_priority` appear in no runtime test at all.

---

## Executive summary

The nine modules are individually well built: deterministic, explainable, fast (5–30 ms warm compute per turn) and thoroughly unit-tested. **The engine as a whole is not healthy**, and almost none of the damage is inside a numbered layer. It sits in three places the nine-layer model does not name:

1. **An unnamed tenth layer does most of the work.** `sie-chat-bridge.js` (1,271 lines) contains a conversation controller of substring classifiers and early returns that runs *before* diagnosis. In the production replay, **11 of 18 paid turns never reached Layer 3**. That controller is untraced, not unit-testable (its classifier is not even exported), and it is the source of most customer-visible failures below.
2. **State is recorded as intended, not as executed.** The Decision layer marks `ticketAlreadyCreated = true` when it *proposes* a ticket. The bridge then asks the customer, gets declined, finds a duplicate, or is downgraded by the trust boundary, and the state is never corrected. Result: **phantom tickets.** A customer who later says "yes, open a ticket" is told *"the ticket we opened is still active"* while **zero tickets exist** [reproduction E].
3. **Belief can only grow.** Nothing anywhere emits `contradicts` evidence (the code comments say so), evidence never decays, and with `memory_use_past_conversations` on, evidence is **imported from the customer's previous chat**. Production traces show it: a closing remark ("nothing else") from one chat surfaced the next day in a *new* chat as the leading hypothesis `convo_goodbye_nothing_else`, and caused support tickets to be offered for unrelated how-to questions in two consecutive chats [PROD; reproduced synthetically as B].

### Top customer-visible defects (all reproduced end to end)

| # | Defect | Evidence |
|---|---|---|
| 1 | *"I tried the steps but it didn't work"* (`جربت الخطوات بس ما اشتغلش`) → **"Great, glad it's sorted 🙌"** and the diagnostic state is wiped. `اشتغل` is matched as a substring with no negation. | C |
| 2 | Plain **"لا" (no)** and **"اه" (yes)** at the ticket prompt are classified `unclear`, so the prompt repeats forever. `/^لا\b/` can never match Arabic in JS because `\b` is ASCII-only. | D1 |
| 3 | **"أيوه عندي مشكلة…" (yes, I have a problem…)** → classified **no** (`/مش/` matches inside `مشكلة`). Restating the problem (*"WhatsApp isn't sending"*) at the prompt also counts as declining. | D2, D3 |
| 4 | *"How do I install WhatsApp Business"* (`ازاي انصب الواتساب`) → **anger** → immediate human escalation (`نصب` = "fraud" is a substring of `انصب` = "install"). *"I'm genuinely very happy"* → **sarcasm** → escalation. | F1, F2 |
| 5 | *"Hi, WhatsApp is down"* (`اهلا الواتساب واقف`) → greeting reply; **the problem is discarded**. | F3 |
| 6 | *"I'm the manager and can't add an employee"* → stored as the customer's **name "ال"** with role *"مدير ومش قادر اضيف موظف"*; the problem is never diagnosed. | F4 |
| 7 | Phantom tickets after any decline, duplicate or trust downgrade (see point 2 above). | E, D3 |
| 8 | Cross-session contamination: new chats inherit the previous chat's evidence; vague second messages become tickets. | PROD, B, B2 |
| 9 | Escalation prompts never expire: the escalation path writes no `lastTurnAt`, so *"would you like a ticket?"* answers a *"good morning"* the next day. Production chat history shows the same carry-over across roughly a day. | PROD, G |
| 10 | *"What's my ticket status?"* with an open ticket → **"I can't find your ticket data right now, try again later"**, every time, forever. Live knowledge is a permanent stub. | H |

### Observability cannot see any of this

- Only pipeline turns are traced: **6 of 13** paid turns in reproduction B (1 of 5 in K3). Production holds 27 trace rows against 102 metered messages.
- The trace records the decision's *intent*, not the outcome. In a production trace the logged reply is the template *"تمام، فتحنالك تذكرة"* ("done, we opened a ticket") while the message actually sent was the template *"تحب أفتحلك تذكرة؟"* ("would you like a ticket?"), which the customer declined [PROD; reproduced as K1].
- **Shadow agreement is structurally always `false`.** The bridge passes `interpretation: null` for the live side, so the `kind` field always differs. Production: 6/6 shadow rows `agreed:false`, including a turn whose *only* difference was `kind`.
- The Validation Lab (9c) is a demo UI ("عرض تجريبي — محليًا فقط"). Production has **0 validation runs**. `publish-gate.js` is called by nothing, and the publish RPC explicitly trusts "a JS decision that already happened" that never happens.

---

## Phase 1 — The nine layers, as implemented

The codebase numbers its modules 1–9 in each README (`Module 1` … `Module 9`). Modules 10 (Trust) and 11 (Retrieval) were added later and are described as cross-cutting. **Runtime execution order is not numeric:** Knowledge (7) runs before Dialogue (6).

```
channel → sie-runtime.getSieReply → sie-chat-bridge.runSieTurn
  settings → handoff check → QUOTA SPENT → edition/catalog assembly
  ┌─ UNNAMED CONVERSATION CONTROLLER (bridge) ────────────────────────────┐
  │ pending ticket confirmation? ─────────────────────────────► exit (no trace)
  │ recallPreviousSession (imports other chat's evidence)                  │
  │ L1 normalize() ─ small-talk / emotion → escalate? ───────► exit (no trace)
  │ Trust CP1 · memory intent? ──────────────────────────────► exit (no trace)
  │ resolution signal + already answered? ───────────────────► exit (no trace)
  │ pleasantry? ─────────────────────────────────────────────► exit (no trace)
  └────────────────────────────────────────────────────────────────────────┘
  L2 resolveScenarioCatalog → L3 processTurn (+Trust CP2, +Retrieval scope)
  → L4 rankDiagnosticState → L5 decide (+ edition freeFloor)
  → L7 composeAnswerDecision → bridge rescueWithArticle → Trust CP3b
  → L6 renderDecision → [shadow run] → bridge ticket-confirm / duplicate / disabled overrides
  → L8 executeDecision → handoff RPC → L9 buildTraceEvent + logTraceEvent → reply
  (Telegram only: channel saveState() writes bot_state a second time)
```

| # | Layer | Responsibility | Main files | Inputs | Outputs | Depends on | Called from (bridge) | Consumed by | Mandatory? |
|---|---|---|---|---|---|---|---|---|---|
| 1 | **Language & Normalization** | Tokenize; glossary/dialect/Arabizi canonicalization; response language. Also hosts the conversational detectors (small talk, emotion, memory intent, resolution signal). | `sie/language/normalizer.js` (892 lines), `tokenizer`, `dialect-normalizer`, `response-language-policy`, `small-talk.js`, `emotion-detector.js`, `memory-intent.js`, glossary/Arabizi JSON | raw text, previous language, edition glossary layers | `normalizedTokens[]`, `responseLanguage`, `truncated` | glossary + Arabizi providers | L780 `normalize()`; L798 `detectSmallTalk(text)`; L805 `detectEmotion(text)`; L848 `detectMemoryIntent(text)`; L857 `detectResolutionSignal(text)` | L3 (tokens), Trust CP1 (tokens), L6/bridge (language), trace | Mandatory |
| 2 | **Scenario Catalog** | The closed set of diagnosable scenarios, signatures, resolutions, questions; edition packs; DB overlay. | `sie/scenarios/*` (635 core + 200 pro + 89 max = 924), `scenario-catalog.resolver.js`, `sie/editions/edition-catalog*.js` | settings, edition profile, optional `chat_engine_scenarios` overlay | a scenario provider | local JSON (fetched from CDN at cold start in edge) | L894 `resolveTurnScenarioProvider` | L3, L4, question-answer, freeFloor, shadow | Mandatory |
| 3 | **Diagnostic Engine** | Evidence extraction → append-only accumulator (noisy-OR) → per-scenario confidence (coverage ratio) and status. | `sie/diagnostics/diagnostic-engine.js`, `evidence-extractor`, `evidence-accumulator`, `hypothesis-tracker`, `sparse-state`, `question-answer`, `live-evidence-provider.stub` | tokens, previous `diagnosticState`, extra evidence, scope fn, evidence filter | `diagnosticState{accumulator, hypotheses}` | L2, Retrieval, Trust CP2 (callback) | L922 `processTurn` | L4, persisted `bot_state`, trace | Mandatory |
| 4 | **Ranking** | Cross-scenario ordering, specificity promotion, ambiguity flag, candidate discriminating questions. | `sie/ranking/ranking-engine.js` (287 lines) | hypotheses, catalog, activation threshold | `RankingResult` | L2, L3 | L959 `rankDiagnosticState` | L5, alternatives (L6), freeFloor, shadow, trace | Mandatory |
| 5 | **Decision** | Pick one of 12 actions by ordered rules R0–R9; maintain `decisionState`. | `sie/decision/decision-engine.js` (715), `decision-policy.js`, `decision-types.js` | ranking, turn, previous decisionState, policy from settings, customer signal | `{decision, decisionState}` | L4 | L966/L992 `decide` (via `freeFloor`) | L7, Trust CP3b, L6, L8, persisted state | Mandatory |
| 6 | **Dialogue** | Render a Decision into `{text, options}` (ar/en). | `sie/dialogue/dialogue-renderer.js`, `templates/{ar,en}.js`, `knowledge-formatters.js` | decision (+knowledgeData, alternatives, explainRootCause) | `{text, options}` | L5, L7 | L1062 `renderDecision` | L8, trace | Mandatory on pipeline turns only |
| 7 | **Knowledge** | Attach static/live data to ANSWER decisions with a `knowledgeSource`. | `sie/knowledge/answer-composer.js`, `static-knowledge.local.js` (7 entries), `live-knowledge.stub.js` | decision, userId | decision + `knowledgeData` | static JSON; live **stub** | L1007 `composeAnswerDecision`; L176 `rescueWithArticle` (bridge) | L6, trace | Optional (no-op for 920/924 scenarios) |
| 8 | **Action** | Sole writer: bot message + `bot_state` (+ ticket) in one RPC transaction; trace and review writes. | `sie/action/action-layer.js`, `supabase-port.supabase.js` | decision, rendered, nextBotState | `ActionResult` | Supabase RPCs `persist_bot_turn`, `create_ticket_with_message_and_session_update` | L1157–1197 + every short-circuit | bridge return value | Mandatory |
| 9 | **Observability** | 9a trace per turn; 9b learning queue; 9c replay / comparison / shadow / validation / publish gate. | `sie/observability/*`, `sie-integration/sie-shadow.js` | all turn artifacts | `chat_engine_trace_events` row; shadow record | L8 port | L1216 `buildTraceEvent` / `logTraceEvent` (pipeline turns only); L1093 shadow | Nothing at runtime; 9c consumed by nothing | Optional (best-effort) |

Cross-cutting, not in the nine: **Trust boundary** (`sie/trust`, CP1 L843, CP2 L929, CP3 L263, CP3b L1039; CP4 egress only via `memory-intent.js`), **Retrieval** (`sie/retrieval` via `edition-turn.scopeFor`), **Editions** (`sie/editions`), **vNext pipeline** (`sie/pipeline`, shadow only), **Conversation Core** (`conversation-core/`, not wired to the runtime).

---

## Phase 2 — Verification, layer by layer

### Layer 1 — Language & Normalization → 🟠 Partially functional

**What works [E2E][TEST].** The normalizer core is solid. Glossary canonicalization, Arabic/Arabizi promotion into the glossary token space, the 8,000-char resource bound and response-language selection all behave in every trace: `دفعت الاشتراك ومش ظاهر → [entity_payment, entity_subscription, symptom_not_visible]` → correct scenario at 0.83. Its output is consumed by L3 and Trust CP1.

**What does not:**

| Finding | Evidence | Class |
|---|---|---|
| The four **conversational detectors** route turns by raw-substring match, with no negation and no word boundaries, and they run *before* diagnosis. Each misfire removes the turn from the pipeline. | Resolution: `ما اشتغلش`, `مش اشتغل`, `تمت عملية الدفع بس الاشتراك مش ظاهر`, `حلت المشكلة؟ لا` → all `resolved`. Emotion: `انصب` → anger; `انا مبسوط جدا بصراحة`, `ما شاء الله على السرعة` → sarcasm → human; `خلاص كفاية كده شكرا` → anger. Small talk: `اهلا الواتساب واقف`, `هاي عندي مشكلة` → greeting. Memory: `انا المدير ومش قادر اضيف موظف` → name "ال"; `متنساش ترد عليا`, `سجل عندك ان الدفع اتخصم مرتين` → memory turn, no diagnosis. | **Potentially causing incorrect behavior** |
| The detectors **ignore Layer 1's own output**: they re-read raw `text`, not `normalizedTokens`. The normalizer's truncation flag is also ignored, so Trust CP1, the detectors and the trace all see untruncated text. | bridge L798/805/848/857/844/1219 pass `text` | **Output partially ignored** |
| No negation or polarity: `الواتساب شغال` and `الواتساب مش شغال` produce the same evidence apart from a bare `مش` token. | `evidence-extractor.js`: every text token is `polarity:'supports'` | **Missing functionality** |
| `typo-tolerance.js` has zero importers. | grep | **Implemented but not used** |
| Conversational intents are handled twice: by the detectors here and by 205 `convo_*` scenarios in Layer 2. | §L2 | **Redundant** |
| Stopwords become 0.8-weight evidence (`طب`, `اعمل`, `ايه`, `السلام`, `عليكم`) and are persisted forever in the accumulator. | C state dump | Noise, state bloat |

### Layer 2 — Scenario Catalog → 🟡 Needs improvement

**What works.** The catalog resolves correctly per edition (prod trace `engine.catalogSize: 924`, `edition: max`), the resolver merges rather than replaces, and the edition fall-back to Free is logged and traced.

| Finding | Evidence | Class |
|---|---|---|
| **205 of 924 scenarios (22%) are conversational** (`convo_goodbye_nothing_else`, `convo_customer_angry`, `convo_asks_for_human_politely`, …), i.e. not problems. They enter belief like problems, never decay, and **win as the "leading problem"** that tickets get opened about. | Production traces: `CREATE_TICKET scen=convo_goodbye_nothing_else` four times in one day; reproduction B | **Incorrectly integrated / redundant with L1** |
| **0 scenarios declare a `source:'live'` token**, so `REQUEST_ACCOUNT_DETAILS` and `hasMissingLiveEvidence` are unreachable. | catalog scan | Implemented, unreachable |
| Discriminating questions exist on only **82/924 (8.9%)**, so ambiguity usually has no question to ask and falls to a ticket (L5). | catalog scan | Missing functionality |
| 20 single-token signatures, plus `unknown` as a catch-all that scores 0.25 on generic text. | catalog scan; audit replay `unknown:0.25` | Over-eager matches |
| The 8 published DB scenarios are ignored (`use_published_scenarios=false`). They were published with **0 validation runs** (see L9). | PROD | Config, but ungated |
| Raising `answer_confidence` from 0.60 to 0.65 silently made `wa_group_messages_not_sending` unanswerable on its canonical phrasing (0.64). No check ties catalog reachability to the live threshold. | C2 (0.64 < 0.65) vs production traces from before the change (answered at 0.64) | Silent regression from settings |

### Layer 3 — Diagnostic Engine → 🟠 Partially functional

**What works.** Deterministic noisy-OR accumulation; exact retrieval-scoped scoring (prod `scope.retrieved 1–100 of 924`); sparse-state round-trips. Output is consumed by L4.

| Finding | Evidence | Class |
|---|---|---|
| **Belief is monotonic.** No code path emits `contradicts` evidence (`stand-off.js:48`: *"Nothing in production emits 'contradicts' evidence"*), evidence never decays, and confidence can only rise within a session. The `rejected` status (requires falling below 0.05 after ≥0.15) and its hysteresis machinery are effectively unreachable. One "nothing else" pins `convo_goodbye` at 0.53 for the rest of the conversation. | code + PROD; B | **Architecturally ineffective** |
| **Cross-session evidence import.** `recallPreviousSession` copies another chat's `diagnosticState` whenever the current one has none. The small-talk path then persists it (`sie: {...prevSie}`). Because `closeConversation` empties the state, the next message re-imports an older chat's evidence. This undoes the "clean slate". | PROD (a chain of three chats); B; B2 (ticket-status chat contaminates a subscription-status chat seconds later → 1.00/1.00 tie → ticket) | **Potentially causing incorrect behavior (P0)** |
| Confidence is pure **coverage** (fraction of the scenario's signature present). Nothing penalizes evidence the scenario does not explain, so small signatures beat specific ones and accumulated stale tokens keep old hypotheses alive. | `hypothesis-tracker.js` formula | Design limitation |
| Live evidence is a permanent stub (`async () => []`). | `live-evidence-provider.stub.js` | Implemented, never real |
| Text evidence is extracted twice per turn (CP1 and `processTurn`). Cheap, and documented. | bridge L840 | Duplicate processing (minor) |

### Layer 4 — Ranking → 🟡 Needs improvement

**What works.** Stable sort with a tie-breaker, specificity promotion, subsumption, catch-all non-promotion. Output is fully consumed by L5, the alternatives renderer and freeFloor.

| Finding | Evidence | Class |
|---|---|---|
| Ambiguity is a fixed 0.10 margin between any two candidates ≥ 0.15. Two weak, stale hypotheses (0.53 vs 0.50) count as an "ambiguous" pair, and with no question available (91% of scenarios) that becomes a ticket. | PROD; B (1·3, 1·4, 2·2) | Correct code, wrong policy |
| It ranks whatever L3 holds, including imported and conversational hypotheses, so it faithfully amplifies L3/L2 defects. | B2: `subscription_status 1.00 \| ticket_status 1.00 (imported)` | Inherited |
| `rankDiagnosticState` re-fetches the full catalog (924) and rebuilds a Map every turn, while L3 already holds the scoped set. | code | Unnecessary processing (minor) |

### Layer 5 — Decision → 🟠 Partially functional

**What works.** Rules are ordered, total and explainable; every decision carries `evaluatedRules` (visible in prod traces). It is the strongest code in the engine.

| Finding | Evidence | Class |
|---|---|---|
| **`ticketAlreadyCreated` records intent, not outcome.** `updateDecisionState` sets it whenever the decision *is* CREATE_TICKET/ESCALATE. The bridge then overrides the action in five places without telling the state: ask-before-ticket, customer decline, duplicate-ticket, tickets disabled, and Trust CP3b downgrade. Every later ticket decision gets `ticketDraft:null`, so `executeDecision` persists *"the ticket we opened is still active"* and opens nothing. | E: decline then "yes" → 0 tickets, phantom text. D3: state `ticketAlreadyCreated:true`, tickets 0. A production trace shows the same phantom text. | **Incorrect behavior (P0)** |
| **R6 ambiguity → CREATE_TICKET as early as turn 2**, because 91% of scenarios have no discriminating question. | PROD, B | Policy too aggressive |
| **R6C is dead.** `MAX_SIMULTANEOUS_RESOLVABLE = Infinity`; production traces print `maxSimultaneousResolvable=Infinity`. | `decision-policy.js:48` | Implemented, never fires |
| **R6B treats any new detail after an ANSWER as "the solution failed" → ticket.** `"في جروب العملاء"` ("in the customers group") after the group-messages answer → CREATE_TICKET. | I | Wrong inference |
| ASK_FOR_SCREENSHOT/ATTACHMENT/LOGS are dead ends: the runtime accepts only `text` (`runSieTurn({text,…})`; the option value `__attach_image__` is just text). The next turn only flips `supplementaryEvidenceRequested` and proceeds to a ticket. | E, D3 | **Output ignored downstream** |
| VERIFY_INFORMATION offers *"أيوه صح / لأ مش كده"* (yes, right / no, not that), but nothing consumes the answer: `question-answer.js` only handles `pendingQuestion`, which VERIFY never sets. With `allow_smart_guess` on, a "no, that's not it" can be followed by R9 answering the same scenario. | code | Missing functionality |
| `REQUEST_ACCOUNT_DETAILS` is unreachable (L2: 0 live tokens). | code + catalog | Unreachable |

### Layer 6 — Dialogue → 🟡 Needs improvement

**What works.** Never throws; falls back safely; Arabic/English structural parity is tested. Consumes `knowledgeData`, `alternatives`, `hedged` and `alreadyTicketed`.

| Finding | Evidence | Class |
|---|---|---|
| **Renders only pipeline turns.** Every short-circuit reply (small talk, emotion acknowledgement, memory, ticket confirm/decline/disabled, escalation, duplicate ticket, closing, greeting personalisation) is a constant in the bridge or Layer 1. That is the majority of what customers read in production, so "presentation-only, one place" is not true at runtime. | bridge constants L208–404, L1153; `SMALL_TALK_REPLIES`, `MEMORY_REPLIES`, `EMOTION_ACKNOWLEDGEMENT` | **Bypassed in most scenarios** |
| States facts it cannot verify: the `alreadyTicketed` template says a ticket exists (inherits the L5 defect); the emotion prefix says *"glad it sorted"* while the body asks for more details (C2 turn 2). | C2, E | Contradictory output |
| The generic clarifying question is identical every time (prod: the same sentence on 6 different turns). | PROD | Weak |
| `TICKET_DECLINE_TEXT` (bridge L401) is dead. | grep | Dead code |

### Layer 7 — Knowledge → 🔴 Broken / ineffective

| Finding | Evidence | Class |
|---|---|---|
| Only **4 of 924** scenarios declare a `knowledgeSource`; 7 static entries exist. For 99.6% of decisions the layer is a pass-through. | catalog scan | Effectively not used |
| **Live knowledge is a permanent stub** (`available:false`). `ticket_status_inquiry` and `subscription_status_inquiry` therefore *always* render the fallback *"I can't find your ticket data right now, try again later"*, even when the customer has an open ticket. | H | **Incorrect behavior** |
| **Published DB knowledge is never read.** Production has 9 published `chat_engine_knowledge_entries`; `static-knowledge.supabase.js` exists, but nothing in the runtime imports it. The bridge and `rescueWithArticle` both use the local JSON. | grep + PROD | Implemented but not used |
| `knowledge_priority=live_first` and `knowledge_use_live_data` are production settings with no effect. | code | No-op controls |
| It runs **after** Decision, so the decision to ANSWER is made without knowing whether an answer exists. `rescueWithArticle` (in the bridge, not this layer) is the patch for the inverse case. | bridge L1007–1026 | **Wrong order** |

### Layer 8 — Action → 🟢 Healthy (with integration caveats)

**What works.** `executeDecision` maps exactly one decision to exactly one atomic RPC; ticket + message + state commit together; writer/caller split is correct (tested; matches Mad3oom 062). The structural write discipline is good.

| Finding (outside `action-layer.js`, at its integration) | Evidence | Class |
|---|---|---|
| **Quota is spent before any work** (`tryConsumeSieMessage` at bridge L738). Any later failure returns null after the charge. The pinned-commit note in `chat-reply.ts` records that every website turn once died at HTTP 546 *after* quota was spent. There is no refund path. | code + `chat-reply.ts` comments; production chat history contains the website's "temporary problem" fallback notice | Failure mode |
| Telegram writes `bot_state` twice: once in the transaction, then again via a non-versioned `sessions.saveState`. The second write can clobber a concurrent turn or a human takeover's state. | `channels/core/sie-client.js:109` | Duplicate processing, race |
| `logTraceEvent` returns an `ActionResult` that the bridge discards, so a failed trace insert is silent. | bridge L1245 | Error handling |
| Writes faithfully persist whatever state the bridge hands over, including the incorrect `ticketAlreadyCreated` (L5) and imported evidence (L3). | — | Inherited |

### Layer 9 — Observability → 🔴 for 9b/9c, 🟠 for 9a

| Finding | Evidence | Class |
|---|---|---|
| **9a traces only pipeline turns.** Every short-circuit exit (escalation, small talk, memory, ticket confirmation, closing) writes no trace. B: 6 traces for 13 paid turns; K3: 1 for 5. Production: 27 rows total vs 102 metered messages. The most damaging paths (escalation, false close, decline) are the invisible ones. | B, K3, PROD | **Bypassed** |
| **Trace records intent, not outcome.** `responseText: rendered.text` and `decision: finalDecision` are logged even when the customer received the confirmation prompt, the duplicate notice or the disabled notice. | K1; PROD (trace text vs sent text for the same turn) | **Misleading output** |
| **Shadow comparison can never agree.** Live `interpretation` is hard-coded `null` (bridge L1097), the shadow returns `kind:'diagnostic'`, and `kind` is a diffed field. `agreementRate` is therefore 0 by construction. It still costs 8–20 ms on the customer's critical path and up to 17 KB of `bot_state`. | PROD 6/6 `agreed:false`; K2 | **Output meaningless** |
| A clean trust verdict is `null` in the trace, so "boundary off" and "boundary ran and passed" look identical, and the false-positive rate the rollout was meant to measure cannot be computed. | `trustTrace()`; PROD all `has_trust:false` while enforce=true | Can't measure |
| **9b learning queue** only sees traced turns and flags only FALLBACK / unknown-escalation / conf < 0.2. A ticket opened about `convo_goodbye` at 0.53 is not flagged. Production view: 3 rows. | PROD | Ineffective |
| **9c is not wired.** The Review Center Validation Lab is a local demo (*"تم النشر (محليًا فقط — عرض تجريبي)"*). Replay, comparison, shadow-run engine and validation policy have no runtime caller. `publish-gate.js` is called by nothing. `sie-runtime.publishScenarioVersion` calls the RPC directly, and the RPC's own comment says it trusts *"a JS decision that already happened"*. **0 validation runs** in production; 8 scenarios and 9 knowledge entries published. | grep, SQL comment, PROD | **Implemented but not used** |

---

## Phase 3 — End-to-end execution traces

All traces below are real runs of `getSieReply` at HEAD with production settings (harness in `scripts/audit-2026-10/`). Notation: ✔ = ran and contributed, ∅ = ran and contributed nothing, ✖ = skipped.

### Trace A — Happy path, knowledge-backed answer (`بكام الاشتراك؟ عايز اعرف الاسعار`; reproduction `A`)

| Layer | Contribution | Output used? |
|---|---|---|
| Controller | no pending/small-talk/emotion/memory/resolution match → pipeline | — |
| L1 | `[intent_pricing, entity_subscription, عايز, اعرف, intent_pricing]`, lang `ar` | ✔ by L3 |
| Trust CP1 | trusted | ✔ (no-op) |
| L2 | Free catalog, 500 scenarios (edition cap) | ✔ |
| L3 | `pricing_inquiry 0.95`, `billing_enterprise_quote 0.77` | ✔ by L4 |
| L4 | leader `pricing_inquiry`, not ambiguous (gap 0.18) | ✔ by L5 |
| L5 | `R7_CONFIDENT_LEADER` → ANSWER | ✔ |
| L7 | `knowledgeData` = static `pricing` text | ✔ by L6 (1 of only 4 scenarios where this happens) |
| L6 | renders the three plans | ✔ |
| Shadow | `agreed:false`, diff = `kind` only | ✖ meaningless |
| L8 | `persist_bot_turn` | ✔ |
| L9 | trace row with knowledge_data | ✔ |

**Every layer contributes.** This is the path the unit tests model, and it works.

### Trace B — Cross-chat contamination (synthetic, three chats, one customer; reproduction `B`)

Synthetic reproduction of a chain observed in production: same customer, three chats, production settings (`memory_use_past_conversations: true`).

| Turn | Text (synthetic) | Path | What each layer did | Customer saw |
|---|---|---|---|---|
| 1·1 | `صباح الخير` | controller | greeting; L2–L9 skipped; no trace | greeting |
| 1·2 | `احكيلي عن مدعوم` | controller | `platform_info` small talk; no trace | platform blurb |
| 1·3 | `مفيش مشكلة، بس عندي سؤال عام عن المنصة` | pipeline | L3 `convo_has_question 0.67`, `dashboard_not_updating 0.60` → L4 ambiguous → L5 R6 → discriminating question about **dashboard time zones** | a question about time zones |
| 1·4 | `لا مفيش حاجة تانية` ("no, nothing else") | pipeline | L1 `trigger_nothing_else` → L3 **`convo_goodbye_nothing_else 0.67`** (a conversational scenario enters belief) → L4 ambiguous → L5 **R6 → CREATE_TICKET**; state `ticketAlreadyCreated:true` | **"would you like a ticket?"** in reply to "nothing else" |
| 2·1 | `هاي` (new chat) | controller | `recallPreviousSession` **imports chat 1's evidence**; the small-talk path **persists it into chat 2** | greeting |
| 2·2 | `مين صاحب المنصة` ("who owns the platform") | pipeline | L3 top = `convo_goodbye 0.67` (**from chat 1**) → R6 → CREATE_TICKET | "would you like a ticket?" |
| 2·3 | `حسابي عنده مشكلة` ("my account has a problem") | controller | consumed as the answer to the pending prompt; `/مش/` inside `مشكلة` → **decline** → review queue; the problem is never diagnosed; no trace | "noted for the team" |
| 2·4 | `لأ مش دلوقتي` | pipeline | now diagnosed as a *problem*; still `convo_goodbye 0.67` → R6 → ticket prompt | "would you like a ticket?" |
| 2·5 | `متشكر` ("thanks") | controller | classifier `unclear` → re-ask | "would you like a ticket?" |
| 2·6 | `وضحلي الـ api` ("explain the API") | controller | classifier `unclear` → re-ask | "would you like a ticket?" |
| 3·1 | `وضحلي الـ api` (new chat) | pipeline | **imports chat 2's evidence** → R6 → ticket prompt on turn 1 | "would you like a ticket?" |
| 3·2 | `لأ مش دلوقتي` | controller | decline → review queue | "noted for the team" |
| 3·3 | `ازاي استخدم الـ API بتاعكم` | pipeline | `howto_use_api 1.00` **ties** imported `platform_info_inquiry 1.00` → R6 → CREATE_TICKET | "would you like a ticket?" instead of the API steps |

**What this shows:** a customer with no problem was asked "would you like a ticket?" **seven times** across three chats. A clean how-to question that is answered correctly in a fresh chat (Trace C, turn 1) became a ticket because of imported evidence. The lead "problem" throughout was the conversational scenario for *"nothing else"*. Only 6 of the 13 paid turns left a trace. Layers 3–5 each worked exactly as written; the failure is in what they were fed (L2 conversational scenarios, L3 imported state), in what the state claimed (L5 intent-as-outcome) and in the controller's confirmation classifier. Production traces show the same chain with the same scenario and rule.

### Trace C — False resolution (`ازاي استخدم الـ API بتاعكم` → `جربت الخطوات بس ما اشتغلش`; reproduction `C`)

| Turn | Path | Layer contribution | Customer saw |
|---|---|---|---|
| 1 | pipeline | L1→L9 all ✔, ANSWER `howto_use_api` 1.00 | the API steps |
| 2 | **controller** | L1 `detectResolutionSignal` → `resolved` (substring `اشتغل` in `ما اشتغلش`); `alreadyAnswered` → `closeConversation`; **L2–L7, L9 skipped**; L8 writes a wiped state | **"Great, glad it's sorted 🙌"** |
| 3 | pipeline | starts from nothing (state wiped) → R5 | "can you explain more?" |

**Skipped:** Diagnostics, Ranking and Decision never see the "didn't work". `R6B_ALREADY_ANSWERED` + `customerSignal:'unresolved'` exists exactly for this case but is pre-empted by the controller.

### Trace D — Phantom ticket (`مش قادر ادخل على حسابي` ×2 → decline → repeat → accept; reproduction `E`)

| Turn | Path | Contribution | State | Customer saw |
|---|---|---|---|---|
| 1 | pipeline | `login_cannot_access 0.67` → R7 → ASK_FOR_SCREENSHOT | `supplementaryEvidenceRequested` | "attach a screenshot?" |
| 2 | pipeline | same → R7 → CREATE_TICKET → bridge asks | **`ticketAlreadyCreated: true` (nothing created)** | "would you like a ticket?" |
| 3 | controller | `لأ` → decline → review queue | flag stays true | "noted for the team" |
| 4 | pipeline | R7 → CREATE_TICKET, `alreadyTicketed`, `ticketDraft:null` | — | "would you like a ticket?" |
| 5 | controller | "yes" → executes pending decision with `ticketDraft:null` → `persist_bot_turn` only | — | **"The ticket we opened is still active…"** |

**Tickets created: 0.** The screenshot request in turn 1 was a dead end (no attachment path). A production trace shows the same sequence, logging the phantom template `"التذكرة اللي فتحناها لسه شغالة"`.

### Trace E — Trust boundary on a genuine multi-problem message (production enforce mode; reproductions `J`, `D3`)

A customer lists eight real problems in one message. CP1 → **quarantined** (`signal_flood, domain_spray`), CP2 drops **all 33 evidence items**, L3 sees nothing, L5 R5 → "can you explain more?". The customer had explained more than anyone. The next three turns re-diagnose normally, then turn 4 (*"WhatsApp isn't sending"*, restated at the ticket prompt) is classified as a **decline** by `/مش/`.

**Contribution:** Trust converted the most informative message of the session into zero evidence. That is defensible against a flooding attack, but there is no softer setting between "trusted" and "drop everything", and the cost to genuine customers is invisible because clean verdicts are not traced.

### Trace F — Live-data questions (reproduction `H`)

`ايه حالة التذكرة بتاعتي؟` (with an open ticket): L3 `ticket_status_inquiry 1.00` → L5 ANSWER → **L7 live stub `available:false`** → L6 fallback **"can't find your ticket data right now, try again later"**. Every layer "worked"; the answer is false by construction.

---

## Phase 4 — Efficiency & quality, per layer

| Layer | Correctness | Reliability / errors | Perf | Determinism | Hallucination risk* | Maintainability / scale | Notable failure modes |
|---|---|---|---|---|---|---|---|
| 1 Language | Normalizer good; detectors poor (substring, no negation, `\b` bug) | total; never throws | normalize ≈1 ms per 500 chars; capped | ✔ | **High** for routing: wrong-intent replies ("glad it's sorted") | Phrase lists in code (~900 phrases); every fix adds a phrase and a new collision | negation, embedded substrings, mixed greeting+problem |
| 2 Catalog | Valid schema; semantic overlap with L1 | CDN fetch at cold start; degrades to Free | 924 scenarios, WeakMap-cached index | ✔ | Medium: `convo_*` scenarios answer as if they were problems | V/N vocabulary ceiling (doc §7.3); 8.9% question coverage | conversational scenarios as tickets |
| 3 Diagnostics | Correct math; wrong model (monotonic, coverage-only) | total | 5–30 ms warm with retrieval | ✔ | Medium: stale or imported belief | `bot_state` 11.5 KB after 2 turns even sparse; grows with conversation | contamination, stickiness |
| 4 Ranking | Correct | total | rebuilds Map of 924 per turn | ✔ (explicit tie-break) | Low | Thin, clean | ambiguity on weak/stale pairs |
| 5 Decision | Rules correct in isolation; state semantics wrong | total | <1 ms | ✔ | **High** for state claims (phantom ticket) | Excellent explainability; 12 actions, 4 unreachable or dead branches | intent-as-outcome; early tickets |
| 6 Dialogue | Correct for what it sees | never throws | trivial | ✔ | Medium: repeats false claims | Customer text in ≥5 files | contradictory prefixes |
| 7 Knowledge | Correct for 4 scenarios | stub never fails, never succeeds | trivial | ✔ | **High**: "try again later" is permanently false | DB content not read; two sources of truth | live questions |
| 8 Action | Correct, atomic | errors returned, not thrown; quota not refunded | 1 RPC | ✔ | Low | Clean ports | double write (Telegram) |
| 9 Observability | 9a partial, 9c unwired | best-effort, silent failures | shadow adds 8–20 ms on critical path | ✔ | n/a — but makes every other risk invisible | Large unused surface (6 modules) | blind to short-circuits |

\* Not LLM hallucination (there is no LLM). Here it means the engine *asserting something false to the customer*: a non-existent ticket, a resolution that did not happen, a "temporary" outage that is permanent.

**Latency.** Engine compute is 5–30 ms warm, 135–380 ms cold (fetching 924 scenarios + glossary). Production `processing_time_ms` is 400–1,000 ms: the turn is **I/O-bound**. Five sequential engine round-trips (handoff read, `sie_consume_message`, `recallPreviousSession`, `persist_bot_turn`, trace insert) plus the edge function's `getUser`, session read and rate-limit RPC. The trace insert and handoff RPC are awaited before the reply returns.

**Duplicate or unnecessary processing:** evidence extracted twice (CP1 + L3); catalog fetched by L3, L4, freeFloor and shadow per turn; `recallPreviousSession` queried on every turn of a chat until it has its own state (including small-talk turns); shadow pipeline re-runs normalization and diagnosis; Telegram writes `bot_state` twice.

**Version skew:** website (`ddd62a9`) and Telegram (`39b31a6`) run different engine commits. The functional diff is the turn writer only, but nothing enforces parity.

---

## Phase 5 — Testing gaps

The suite (1,082 tests) is extensive and honest about what it tests. The gap is structural: **almost every test proves "the function works in isolation"**. Only 6 test files drive `runSieTurn`/`getSieReply`, and **none of them** uses production settings, multi-session customers, or the controller's classifiers. `trust-integration.test.mjs` says so itself: *"Deliberately mirrors the call order rather than importing runSieTurn"*. A re-implementation of the order cannot catch a bug in the real order.

| Layer | Tests exist (≈) | What they prove | Not covered (in isolation) | Missing integration tests | Adversarial / edge cases to add |
|---|---|---|---|---|---|
| 1 Language | 118 | Tokenization, glossary, Arabizi, dialect folding, typo function, detectors on *positive* phrases | Negated phrases (`ما اشتغلش`, `مش اشتغل`); embedded substrings (`انصب`, `مشكلة`); greeting+problem; `انا`+role+problem; `\b` on Arabic. **`classifyTicketConfirmationReply` is not exported and has zero tests.** | Detector → bridge route → customer reply, for each detector | A corpus of real problem statements that must **not** be captured by any detector (precision tests), not just phrases that must be |
| 2 Catalog | 82 | Schema integrity, uniqueness, reachability, resolver merge, editions | Conversational-vs-problem separation; reachability at the **live** `answer_confidence` | Catalog change → full conversation outcome | A `convo_*` scenario must never be a ticket's scenario |
| 3 Diagnostics | 77 | Noisy-OR math, hysteresis, sparse equivalence, retrieval equivalence | Contradicting evidence (none exists); decay; cross-session import | `recallPreviousSession` + small talk + close → what state persists | Evidence from chat N must not affect chat N+1 unless the customer confirms it is the same problem |
| 4 Ranking | 23 | Ordering, ambiguity margin, specificity | Ambiguity among stale/weak candidates | Ranking over imported state | Two weak conversational hypotheses must not form an "ambiguous pair" |
| 5 Decision | 60 | Each rule fires on its trigger; state transitions | That state matches **executed** effects | decide → bridge override (confirm/decline/duplicate/disabled/trust) → next decide | Decline then accept → exactly one ticket. Trust downgrade → later legit ticket still opens. VERIFY "no" → no answer for the rejected scenario |
| 6 Dialogue | 30 | Every action renders in ar/en; never throws | Short-circuit texts (outside the layer) | Prefix + body coherence | Rendered claims vs facts (ticket exists, resolved) |
| 7 Knowledge | 57 | Composer ordering, static provider, Supabase provider in isolation | That the Supabase provider is ever used; live answers | Status question → customer text with stub | "try again later" must not render when the source is permanently unavailable |
| 8 Action | 37 + turn-writer 5 | One decision → one RPC; writer split | Quota-without-reply; Telegram double write | Failure after quota → refund/trace | Concurrent turn + saveState race |
| 9 Observability | 97 | Trace shape, learning-queue filter, replay/comparison/validation/publish-gate in isolation | Coverage (what % of turns are traced); intent vs outcome | **Every exit path writes a trace**; shadow agreement on identical decisions = true | Publish without a validation run must be refused |
| Bridge / controller | ~13 indirect | Handoff, writer, editions, trust order (structurally) | Almost everything in this report | **Production-settings conversation suite** (the reproductions in this report) | Every E2E case in §Phase 3 as a golden conversation |

**The single highest-value test addition:** a golden-conversation suite that runs multi-turn, multi-session conversations through `getSieReply` **with the production settings row**, and asserts on (a) the customer-visible reply, (b) tickets actually created, (c) trace rows written. The harness in `scripts/audit-2026-10/` is a starting point.

---

## Phase 6 — Layer health report

| Layer | Status | Actually executed? | Output used? | Test coverage | Main problem | Priority |
|---|---|---|---|---|---|---|
| 1 Language & Normalization | 🟠 Partially functional | Yes, every turn (normalizer); detectors before everything | Tokens yes; truncation flag no; detectors bypass the normalizer | High unit, **no precision/negation tests**, private classifier untested | Substring conversational routing without negation sends real problems to the wrong path (false "resolved", false anger, swallowed problems) | **P0** |
| 2 Scenario Catalog | 🟡 Needs improvement | Pipeline turns only (~40–60%) | Yes | High integrity, no behavioural | 205 conversational scenarios compete as problems; 8.9% have discriminating questions; 0 live tokens | P1 |
| 3 Diagnostic Engine | 🟠 Partially functional | Pipeline turns only | Yes | High unit, none on cross-session | Monotonic belief + cross-session import → sticky, contaminated hypotheses | **P0** |
| 4 Ranking | 🟡 Needs improvement | Pipeline turns only | Yes | Moderate | Ambiguity on weak/stale pairs → premature tickets | P2 |
| 5 Decision | 🟠 Partially functional | Pipeline turns only; overridden afterwards by the bridge in 5 ways | Yes, but its state is wrong after overrides | High unit, none on override→state | `ticketAlreadyCreated` is intent not outcome → phantom tickets; R6C dead; evidence requests dead-end | **P0** |
| 6 Dialogue | 🟡 Needs improvement | Pipeline turns only; most customer text bypasses it | Yes | Good unit | Not the single source of customer text; repeats false claims | P2 |
| 7 Knowledge | 🔴 Broken / ineffective | Every pipeline turn, effective on 4/924 scenarios | Rarely | Good unit, provider unused | Live stub returns permanent "try later"; DB knowledge never read; wrong order vs Decision | P1 |
| 8 Action | 🟢 Healthy | Every handled turn | Yes | Good | (Integration) quota charged before work; Telegram double write | P2 |
| 9 Observability | 🔴 Broken / ineffective (9b/9c) · 🟠 (9a) | 9a pipeline turns only; 9c never | 9a: rarely read; shadow: meaningless; 9c: no | High unit, zero on coverage | Blind to short-circuit paths; logs intent not outcome; shadow agreement always false; validation lab is a demo; publish ungated | **P0** (you cannot fix what you cannot see) |
| *(unnamed)* Conversation controller in bridge | 🔴 Broken / ineffective | Every turn, first | Decides the route for every turn | ~0 direct | Untraced, untestable early-exit cascade holding most defects; no expiry on pending prompts | **P0** |
| *(cross-cutting)* Trust boundary | 🟡 Needs improvement | Yes (enforce in prod) | Yes | Good, corpus-based | Binary quarantine drops all evidence from genuine multi-problem messages; clean verdicts untraced | P2 |

---

## Phase 7 — Missing or new layers

I evaluated each area you listed and recommend **four** genuinely new layers. The rest are fixes inside existing layers, or should not be layers.

### N1. Turn Interpreter (dialogue-act layer) — **Priority P0**

- **Problem:** the bridge's controller (pending answers, small talk, emotion, memory, resolution, escalation) is an implicit, order-dependent, untraced classifier spread over ~120 lines with dozens of return points. It produces most of the defects in this report.
- **Why the 9 can't:** Layer 1 answers "what tokens?" and Layer 3 "which problem?". Nothing answers **"what kind of turn is this?"**, i.e. answer-to-our-question vs new problem vs closing vs meta-request vs mixed. That question needs conversation context (a pending question) that Layer 1 is designed not to have.
- **Inputs:** normalized tokens (not raw text), negation scopes, conversation state (pending question with its expected answer type), turn history.
- **Outputs:** a typed `TurnKind` (`ANSWER_TO_PENDING{yes|no|other}`, `PROBLEM`, `PROBLEM_WITH_GREETING`, `RESOLVED`, `NOT_RESOLVED`, `META_MEMORY`, `HUMAN_REQUEST`, `CLOSING`, …) plus annotations (emotion, facts), with **a confidence and a "mixed" flag**: a greeting plus a problem is a problem.
- **Position:** after Layer 1, before Trust CP1 and Layer 3.
- **Interaction:** the bridge becomes a dispatcher over `TurnKind`. Every kind, including short-circuits, flows into Dialogue (L6), Action (L8) and Trace (L9).
- **Measurable scenario:** `جربت الخطوات بس ما اشتغلش` → `NOT_RESOLVED` → R6B CREATE_TICKET path instead of "glad it's sorted"; `لا` → `ANSWER_TO_PENDING{no}`; `اهلا الواتساب واقف` → `PROBLEM_WITH_GREETING`.
- **Cost:** medium. `sie/pipeline/interpretation.js` already exists as the vNext shadow and states this exact rationale. It needs negation-aware matching on tokens and a golden corpus.
- **Not an LLM by default:** deterministic first. An LLM *classifier* (never a decider) is a later option behind the same contract, measured against the corpus.

### N2. Conversation State & Commitment Ledger — **Priority P0**

- **Problem:** state holds intentions (`ticketAlreadyCreated` on proposal), imports other chats' evidence, has prompts that never expire, and is written twice on Telegram.
- **Why the 9 can't:** Layer 5 owns `decisionState` but never learns what Layer 8 and the bridge actually did. Layer 3 owns evidence but has no notion of an episode (one problem's lifetime).
- **Inputs:** previous state, executed `ActionResult`s (ticket id / declined / duplicate / downgraded), the TurnKind, timestamps.
- **Outputs:** an explicit, versioned state with **episodes** (one problem = one evidence ledger; closing ends it; a new chat starts a new episode and may only *offer* "is this about X again?") and **commitments** (`pendingPrompt{kind, expiresAt}`, `ticket{id|declined|duplicateOf}`), each written *after* the effect commits.
- **Position:** wraps the turn. Read before N1, written by Action in the same transaction (`conv_commit_turn(expectedVersion)` in `conversation-core/` already provides that transaction, but it is unwired).
- **Measurable scenario:** Trace D creates exactly one ticket on "yes". Trace B: chat B starts empty and asks "is this about last time?" instead of importing `convo_goodbye`.
- **Cost:** medium. Conversation Core exists; the change is ownership of state semantics.

### N3. Account Context Provider (live data) — **Priority P1**

- **Problem:** both live ports (L3 evidence, L7 knowledge) are stubs. The engine cannot answer "what's my ticket/subscription status", and cannot use "subscription expired yesterday" as evidence, the most discriminating signal a support engine can have.
- **Why the 9 can't:** each layer has a port but no provider. Two independent providers would double-query the same tables.
- **Inputs:** userId; a declared, closed set of facts (open tickets, subscription state and expiry, WhatsApp connection status, recent failed payments).
- **Outputs:** one cached `AccountContext` per turn, consumed by L3 (as `source:'live'` evidence) and L7 (as answer data).
- **Position:** fetched once at turn start (in parallel with the handoff check), before L3.
- **Measurable scenario:** `ايه حالة التذكرة بتاعتي؟` answers "#77 is open, last update…" instead of a permanent "try later"; `subscription_expired` resolves from live evidence without a question.
- **Cost:** medium, plus catalog work (today 0 scenarios declare live tokens).

### N4. Pre-commit Response Verifier — **Priority P1**

- **Problem:** the engine sends claims it has not checked: a ticket exists, the issue is resolved, data is temporarily unavailable.
- **Why the 9 can't:** Dialogue renders whatever the decision says; Action writes whatever it is given. No stage compares the outgoing text's *claims* with the committed facts.
- **Inputs:** the rendered reply plus structured claim tags emitted by the templates (`claims: ['ticket_exists', 'issue_resolved']`), committed state and AccountContext.
- **Outputs:** pass, or a deterministic substitution (for example "I'll open a ticket" instead of "your ticket is still open") plus a trace flag.
- **Position:** between Dialogue (L6) and Action (L8), for **all** turns including short-circuits.
- **Measurable scenario:** Trace D's phantom-ticket text and Trace F's "try later" are blocked and counted.
- **Cost:** low: a small invariant table. It does not replace fixing the root causes; it bounds the damage of the next one.

### Evaluated and *not* recommended as separate layers

| Area | Verdict |
|---|---|
| Contradiction detection / negation | **Inside L1 + L3**: L1 emits negation scopes, L3 accepts `contradicts` evidence (the accumulator already supports it). Not a layer. |
| Confidence estimation / calibration | **Inside L3/L4 + offline evaluation**: add a precision term (unexplained evidence) and calibrate thresholds from labelled traces. Not a runtime layer. |
| Evaluation / feedback loop | **Make Layer 9 real**, not a new layer: trace 100% of turns with the *outcome*, label outcomes (answered→resolved, ticket, declined, escalated, re-contact within 24 h), and gate catalog publishes and settings changes on a replay of golden conversations. The modules exist (`replay-engine`, `validation-policy`, `publish-gate`) but are unwired. |
| Escalation to humans | Belongs in N1 (detect) + N2 (commitment) + Action. The handoff RPC is already correct. |
| Memory | Split into **episode memory** (N2) and **customer facts** (existing `sie_customer_memory`, CP3-guarded). Only explicit, confirmed fact statements should write; incidental `انا X` phrasing should not. |
| Policy / safety validation | The trust boundary already is this. Improve its grading (§Phase 2), don't add a second one. |
| Tool / action orchestration | Premature: the engine performs one effect type (ticket). Revisit when it can *do* things (reset a session, resend a template). |
| Retrieval / knowledge quality | Content work (knowledge on 4/924 scenarios, questions on 8.9%), not architecture. |
| Personalization | Name-in-greeting is enough until the outcome metrics exist. Low value per unit of risk. |
| Online learning | **Do not.** A deterministic engine should learn offline through reviewed catalog changes gated by replay, which is what 9c was designed for. |

---

## Phase 8 — Architectural assessment

**1. Are the nine layers well designed?** *Individually, yes.* Pure functions, ports and adapters, single writer, explicit rules, deterministic ordering and honest documentation are above average for this kind of system. *As a system, no.* The nine-layer model describes the diagnostic pipeline, but the engine's behaviour is decided mostly **around** it: in a controller the model does not name, in state transitions no layer owns, and in effects no layer reports back.

**2. Overlaps.**
- L1 conversational detectors ↔ L2 `convo_*` scenarios (same intents, two mechanisms, different winners by message length).
- L6 Dialogue ↔ bridge/L1 reply constants (customer text in at least five files).
- L7 `composeAnswerDecision` ↔ bridge `rescueWithArticle` (two knowledge lookups with opposite directions).
- L9 `sie-shadow` ↔ `observability/shadow-run-engine` (two shadow mechanisms).
- Trust CP1 size check ↔ `normalize()` cap (documented and justified; fine).

**3. Missing.** A turn interpreter (N1), an owner for conversation state and commitments (N2), a real account-context provider (N3), and outcome-level observability. N1 and N2 are not optional for reliability.

**4. Wrong order.**
- **Knowledge after Decision:** the engine decides to ANSWER before knowing an answer exists. Availability must be an input to Decision.
- **Quota before work:** charge on commit (inside the turn transaction), not before the first read.
- **Emotion escalation before everything:** an emotion read on raw substrings can pre-empt a pending answer, a resolution signal and diagnosis. Emotion should annotate N1's output, not route ahead of it.
- **Trace last and best-effort:** it should be written in the same commit as the turn, so a turn without a trace cannot exist.

**5. Merge.**
- Ranking (L4) and Diagnostics (L3) can stay separate; the boundary is clean and cheap.
- **Knowledge (L7) should merge into a "grounding" step consumed by Decision**, rather than a post-decision patch.
- The two shadow mechanisms should become one, or both be removed until fixed.

**6. Split.**
- **L1 → (a) Normalization (keep) and (b) Turn Interpretation (N1).** The detectors do not belong in a layer whose contract is "tokens".
- **L9 → (a) runtime tracing (part of the commit) and (b) offline Validation Lab (tooling, not runtime).**
- **L2 → problem catalog vs conversational intents** (move the 205 `convo_*` into N1's inventory or delete those already covered).

**7. Remove.** `typo-tolerance.js` (dead), R6C at `Infinity` (dead; either set a finite cap from data or delete), `TICKET_DECLINE_TEXT` (dead), the shadow run as currently wired (meaningless output on the critical path), and the Validation Lab's demo publish button (it implies a gate that does not exist). Also: `REQUEST_ACCOUNT_DETAILS` and the live-evidence branches until N3 exists. Unreachable branches give false confidence in coverage.

**8. The target architecture** (reliable, deterministic, scalable, hallucination-resistant):

```
Channel adapter
  └─► Conversation Core ............. ingest · idempotency · ordering · ownership/handoff · state_version
        └─► TURN (one transaction at the end)
              1. Normalize ................ tokens + negation scopes + language            (L1a)
              2. Interpret ................ TurnKind + annotations, given pending prompt     (N1)
              3. Load context ............. episode state · AccountContext · customer facts (N2, N3)
              4. Trust envelope ........... graded, traced on every turn                     (Trust)
              5. Diagnose ................. support AND contradict evidence, episode-scoped  (L3 + L2 problems only)
              6. Rank & calibrate ......... precision-aware confidence, calibrated margins   (L4)
              7. Ground ................... is there an answer? static · DB · live          (L7, moved before 8)
              8. Decide ................... pure; outputs INTENT                            (L5)
              9. Realize .................. ALL customer text, every TurnKind                (L6)
             10. Verify ................... claims ⇔ facts invariants                        (N4)
             11. Commit ................... message + state(with executed outcomes) + ticket
                                            + quota + TRACE, one transaction                (L8 + L9a)
  Offline: trace store → outcome labels → golden replay → publish/settings gate          (L9b/9c, wired)
```

Properties this buys: every turn is traced (commit includes trace); state can never claim an effect that did not commit (outcomes written by commit); belief can go down (contradicts + episodes); no customer text bypasses verification; quota is charged only for delivered replies; and every catalog or settings change is gated by replaying real conversations. That last one is the only defence that scales with catalog size.

### Recommended order of work (still audit, not implementation)

1. **Make failures visible first:** trace every exit path with the *actual* outcome, fix shadow `kind`, record clean trust verdicts. Without this, none of the fixes below can be measured.
2. **Stop the P0 customer harms** (small, local, testable): the confirmation classifier (`\b`, `مش` inside `مشكلة`); negation in `detectResolutionSignal`; `انصب`/sarcasm escalation; `lastTurnAt` on every write path; `ticketAlreadyCreated` set only from executed outcomes; `memory_use_past_conversations` off (one settings change) until episodes exist.
3. **Golden-conversation suite on production settings**, including every trace in this report, in CI.
4. Then the structural work: N1 (promote `interpretation.js`), N2 (wire Conversation Core), Knowledge-before-Decision, N3, N4.

---

## Appendix — Reproducing this audit

```bash
cd sie
node scripts/audit-2026-10/conversations.mjs            # 21 synthetic reproductions on production settings, summary table
node scripts/audit-2026-10/conversations.mjs --verbose  # plus per-turn traces (path, tokens, hypotheses, rule, reply)
node scripts/audit-2026-10/probes.mjs          # classifier and trust probes in isolation
```

The harness replaces only the Supabase client. It embeds a snapshot of the production `sie_settings` **configuration values** (no customer data). Every conversation in it is synthetic. Production evidence was gathered with read-only queries: `sie_settings`; `chat_engine_trace_events` (27 rows, July–September 2026); `chat_messages` for a handful of SIE chats (used only to confirm the replay matched; no content is reproduced here); counts on `chat_engine_validation_runs` (0), `chat_engine_scenarios` (8 published), `chat_engine_knowledge_entries` (9 published), `chat_engine_learning_queue` (3), `chat_engine_conversation_reviews` (6).

**Reproductions are not regression tests.** Each case reports `REPRODUCED` while its defect exists. When a defect is fixed its case should stop reproducing and be replaced by a regression test asserting the correct behaviour.
