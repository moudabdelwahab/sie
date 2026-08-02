# Diagnostic Engine — Test Suite

Permanent regression suite, same approach as Modules 1 and 2: Node's
built-in test runner, no external dependencies.

## Running the tests

```bash
node --test diagnostics/tests/
```

## What's covered

| File | Covers |
|---|---|
| `evidence-types.test.mjs` | `checkEvidenceShape` guard cases, empty-state factories |
| `evidence-extractor.test.mjs` | Weight-by-source mapping, filtering of non-evidence-bearing tokens, discriminating-answer evidence construction |
| `evidence-accumulator.test.mjs` | Noisy-OR combination (support and contradict), purity (no mutation), presence bounded to [0,1], contradiction genuinely lowering presence over time |
| `hypothesis-tracker.test.mjs` | Confidence formula correctness, all three status transitions, hysteresis band, history append-on-change-only, record permanence (never deleted), reactivation |
| `diagnostic-engine.test.mjs` | Orchestration (extraction → merge → scoring wiring), live-evidence opt-in behavior and failure resilience, additional-evidence injection, multi-turn state carry-forward, **and full end-to-end integration using real Module 1 + Module 2 data** |

## Why `diagnostic-engine.test.mjs` uses real Module 1 + Module 2 data

`tests/helpers/node-providers.js` wires up genuine normalization
(`normalizeReal`) and the real shipped scenario catalog
(`createRealScenarioCatalogProvider`) — not hand-crafted fixtures — so a
handful of tests exercise the actual cross-module path: raw Arabic/mixed
text in, a scored `DiagnosticState` out. This is what caught a real gap
during development (see below) rather than only ever testing against
idealized inputs.

## A former limitation, now a regression test for the fix

`diagnostic-engine.test.mjs` used to carry a test named
`"KNOWN LIMITATION: a word with an attached Arabic definite article ..."`,
which asserted that `الباسورد` did **not** match the evidence token
`باسورد`. Its own comment said that if it ever started failing, it meant
article-stripping had been added to Module 1 and the test should be revisited.

It was, so it has been: the test now asserts the opposite — that `الباسورد`
does reach the forgotten-credentials scenario. Module 1 strips Arabic clitics
when the remainder is a word the glossary knows, so Arabic evidence tokens no
longer need to be listed once per article form.

## Adding tests when Module 4 (Ranking Engine) is built

The Ranking Engine will consume `DiagnosticState.hypotheses` (specifically
`confidence`, `status`, `supportingEvidenceTokens`, `missingEvidenceTokens`)
without recomputing them. If the shape of `Hypothesis` changes, update
`evidence-types.js` first, then check whether `hypothesis-tracker.test.mjs`
and `diagnostic-engine.test.mjs` still hold.
