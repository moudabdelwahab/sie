# Trust Boundary — Module 10

The defensive boundary between untrusted conversational input and SIE's
internal reasoning and state. Classifies each turn once, then enforces that
classification at the four places where user text stops being *input* and
starts being *control state*.

It produces no replies, makes no diagnoses, and decides nothing about the
customer's problem. Its only output is a `TrustEnvelope` and the narrowing it
causes.

## Files

| File | Responsibility |
|---|---|
| `trust-types.js` | `TRUST_LEVELS`, `RISK_KINDS`, the capability table, `envelopeFrom`, and `escalate` (the monotonicity invariant) |
| `risk-signals.js` | The sensors. Structural, statistical, and contextual. Carries the calibration measurements and one documented **removed** sensor |
| `admission-control.js` | **CP1** — the single decision point. Classifies the turn, emits the envelope |
| `evidence-guard.js` | **CP2** — caps how far one turn may move belief |
| `fact-guard.js` | **CP3** — authorizes writes to durable customer memory |
| `action-guard.js` | **CP3b** — authorizes effects that leave the engine |
| `egress-guard.js` | **CP4** — stops quoted user text from speaking in the engine's voice |
| `trust-boundary.js` | The facade: one import, plus the `enabled` / `observeOnly` flags |

## Why a boundary and not a tenth stage

The four crossings do not happen at the same moment. Evidence enters early,
facts are written late, actions are authorized later still, and text is quoted
on the way out. A single synchronous stage could only guess about three of
them.

```
normalize ─► extract ─► [CP1 admit] ─► accumulate ─► rank ─► decide
                            │              ▲                   │
                       TrustEnvelope       │                   ▼
                            ├──────────────┘            [CP3b action]
                            ├──► [CP2 evidence budget]          │
                            ├──► [CP3 fact writes]              ▼
                            └──► [CP4 quoted text] ────────► reply
```

CP1 sits between Language and Diagnostics rather than in front of everything,
because the most discriminative measurement available — how many distinct
diagnostic signals a message carries — does not exist until the glossary has
resolved the text. Normalization is pure; the first irreversible step in a
turn is evidence reaching the accumulator, and the boundary sits immediately
before that.

## Trust levels

Graded, never binary. Blocking a confused customer is also a failure.

| Level | Evidence budget | Writes facts | Mutates state | Triggers actions |
|---|---|---|---|---|
| `trusted` | ∞ | yes | yes | yes |
| `constrained` | 4.0 | no | yes | yes |
| `quarantined` | 0 | no | no | no |
| `rejected` | 0 | no | no | no |

Every level still gets an answer. `rejected` means the text is not
*interpreted*, not that the customer is ignored.

The envelope takes the **strictest** level any single sensor argued for. Risk
does not average out.

## What makes this not keyword matching

Two of the sensors contain word lists, and a reader is right to be suspicious
of them. The distinction they obey:

> The lists name **what the text is about**, not **how an attack is worded**.

`SPEAKER_ROLES` (who a line claims to be speaking), `SYSTEM_SELF_REFERENTS`
(the assistant's own configuration) and `PRIVILEGE_ROLES` (roles that would
change what is allowed) are small, stable and enumerable because the *domain*
bounds them. A phrase list is unbounded because the *attacker* picks from it.

They are also not load-bearing. `signal_flood`, `domain_spray` and the
breadth check in `evidence-guard.js` read no words at all, and the evidence
budget is arithmetic rather than detection: a turn classified `constrained`
moves belief by at most the weight of one ordinary sentence however it is
phrased. An attacker who defeats every sensor is left with a turn that behaves
like a normal turn.

## Calibration

Thresholds are set from a measured distribution, not chosen for how they
sound. Reference corpus: 345 distinct Arabic strings extracted from the
repository's test files — excluding `sie/trust/tests`, which holds the attack
corpus — plus the small-talk baseline fixture.

| Quantity | p50 | p90 | p95 | p99 | max | threshold |
|---|---|---|---|---|---|---|
| distinct evidence tokens | 2 | 6 | 7 | 9 | 12 | 18 / 30 |
| total evidence weight | 1.8 | 4.8 | 6.2 | 8.4 | 11.0 | budget 8.0 |
| distinct `entity_*` tokens | 0 | 1 | 1 | 2 | 2 | 5 / 8 |
| message length (chars) | 16 | 52 | 68 | 103 | 171 | 2000 / 8000 |
| scenarios crossing 0.6 in one turn | 1 | 2 | 3 | 11 | 11 | 15 / 40 |

### The first calibration was wrong, and the failure mode is worth knowing

The corpus was originally extracted with `grep -E "[\u0600-\u06FF]"`. GNU grep
has no `\uXXXX` escape, so that bracket expression matched the literal ASCII
characters `\`, `u`, `0`–`6` and `F`. The resulting corpus of 1,077 "Arabic
messages" was mostly English test titles and code fragments.

It was convincing: plausible size, plausible percentiles, and a 0%
false-positive rate. Every threshold derived from it was calibrated against
noise, and several were roughly half what they should have been.

What exposed it was a contradiction, not a review: an end-to-end test failed
reporting 11 scenarios over the resolution threshold, on a message the corpus
said could reach at most 5. **A measurement that disagrees with an observed
execution is wrong, whatever its percentiles look like.** The extraction now
runs in JavaScript, and `adversarial.test.mjs` asserts a canary message is
present, so a silently empty corpus fails instead of passing.

**Remaining limit, stated plainly:** the corpus is still test-suite text, not
production traffic. It under-represents long messages and contains no pasted
logs. The 0% false-positive rate below is measured *against this corpus* and
is a lower bound on the real one. `observeOnly: true` exists to replace it
with a real number.

## Measured results

Run `npm run test:trust`.

- **18/18** attacks in the corpus caught at or above their required level
- **0/6** attack-shaped legitimate messages escalated
- **0/345** legitimate corpus messages escalated (0.00%)
- **29** invariant tests covering monotonic escalation, budget arithmetic,
  closed fact vocabulary, speech-is-never-gated, and inertness when disabled

## A sensor that cannot discriminate, and is kept anyway

The breadth check in `evidence-guard.js` asks how many scenarios one turn
carries over the resolution threshold. At the low end it cannot tell an attack
from a customer, and the measurement says so exactly:

- legitimate maximum: **11**, reached by `عايز اعرف عن منصه ازاي بتشتغل`
  ("how does the platform work?")
- attacker's best single token: **11**

The populations do not merely overlap, they coincide — the vague question and
the single-token probe *are* the same input as far as the engine is concerned.
No threshold separates them. What the sensor can still see is the multi-token
flood (three tokens reach 19 scenarios, thirty reach 98), so the threshold sits
at 15: above every legitimate case, below any flood. It catches the flood and
does not pretend to catch the rest.

The same measurement is why `maxSimultaneousResolvable` in `decision-policy.js`
ships **off**. Setting it to 6 preserves 98.1% of the corpus's automatic
resolutions and costs the platform-info flow — a product trade-off for an
operator to make deliberately, not a default.

## One sensor was removed, on evidence

`repetition_pump` was designed, implemented, calibrated and then deleted.
Repeating a token cannot achieve anything against a noisy-OR accumulator: it
saturates by the third occurrence (0.80 → 0.96 → 0.992), and a
glossary-matched token saturates on the first. The sensor could only have
fired on repetitions that had already stopped paying, while its threshold sat
above two entirely ordinary phrasings. `risk-signals.js` keeps the full
measurement and the condition under which the sensor should come back.

## Two real defects found while building this

Both verified against the code, both recorded in `SIE-ARCHITECTURE.md`:

1. **Markdown link injection on the Telegram path.** `MEMORY_REPLIES.recalled`
   renders stored customer text as `• ${f.value}`; `telegram-api.js` sends with
   `parse_mode: 'Markdown'`; nothing between them escapes anything. CP4
   neutralises it. *Checked and cleared:* the admin review centre escapes
   customer text correctly — there is no XSS.
2. **71.5% of the catalog (465/650) is auto-resolvable from a single token.**
   A one-word message reaches `R7_CONFIDENT_LEADER` with ten other scenarios
   tied behind it, and `isAmbiguous` reports `false` because it measures the
   top-two gap rather than the distribution. `R6C_NON_DISCRIMINATING_EVIDENCE`
   makes this visible in every trace and can enforce against it, but ships off:
   no threshold separates the probe from a legitimate vague question. The real
   fix is signatures with enough facets to discriminate, so that confidence
   reflects evidence rather than catalog authorship — see
   `SIE-ARCHITECTURE.md`.

## Status

**Disabled by default.** `openTurn()` returns a trusted envelope unless
`{ enabled: true }` is passed. A security layer that ships silently switched
on is one nobody has measured.
