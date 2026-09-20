# Retrieval — Module 11

Decouples the cost of answering one customer from the size of the catalog.
Replaces "score all 650 scenarios" with "score the handful that share a token
with this message" — and does it **exactly**, not approximately.

## Files

| File | Responsibility |
|---|---|
| `scenario-index.js` | The inverted index: token → posting list with weights, IDF, per-scenario total weight. Cached in a `WeakMap` on the catalog array |
| `candidate-retrieval.js` | Turns token presences into scored candidates, most-specific tokens first |

## The equivalence claim

Confidence is a coverage ratio:

```
                 Σ presence(t) · w(s,t)     over t in signature(s)
confidence(s) = ────────────────────────
                      Σ w(s,t)             over t in signature(s)
```

A token the message never produced has presence 0 and contributes nothing to
the numerator. So a scenario sharing no token with the message has numerator 0
and confidence 0 — necessarily, for every message, with nothing to tune.

**Therefore retrieval is not a heuristic.** Scoring only the scenarios that
share a token produces identical confidences and an identical ranking to
scanning the whole catalog. `tests/equivalence.test.mjs` checks this against
the shipped catalog (all 516 signature tokens, 400 random multi-token
messages), against randomly generated catalogs with shapes the shipped one
does not have (fractional weights, zero weights, empty signatures), and by
confirming that every scenario retrieval *omits* really does score zero.

`limit` truncates after exact scoring, so a limit of K returns the true top K.

## Measured

`node --expose-gc bench/retrieval-bench.mjs`. Catalogs from
`bench/catalog-generator.mjs`, which reproduces the shipped catalog's sharing
structure (7.7% head fanout, power-law tail) rather than handing out unique
tokens.

| N | full scan | retrieve (typical) | retrieve (worst) | speedup (typical) | postings read (worst) |
|---|---|---|---|---|---|
| 650 | 0.13 ms | 0.055 ms | 0.027 ms | 2× | 49 |
| 1,000 | 0.16 ms | 0.017 ms | 0.044 ms | 10× | 76 |
| 3,500 | 0.61 ms | 0.005 ms | 0.111 ms | 136× | 270 |
| 10,000 | 1.69 ms | 0.019 ms | 0.466 ms | 91× | 770 |
| 100,000 | 27.6 ms | 0.062 ms | 4.955 ms | 446× | 7,681 |

"Worst" is a message consisting of nothing but the single hottest token —
every posting for it must be read. Equivalence with a full scan held in all 15
measured cells.

## What this does not fix

**Retrieval cost is not constant in N.** It is Σ over the message's tokens of
that token's posting-list length, and the hottest token's posting list is 7.7%
of the catalog at every size — 49 entries at 650, 7,681 at 100,000. The worst
case grew 183× while the catalog grew 154×. This is a much better constant, not
a better asymptote.

**Memory is the binding constraint, not CPU.**

| N | catalog | index | total resident |
|---|---|---|---|
| 10,000 | 2.5 MB | 4.1 MB | ~7 MB |
| 100,000 | 51.7 MB | 43.4 MB | **~95 MB** |

The engine holds both in the isolate. ~95 MB is not viable in a Supabase Edge
Function alongside a 1,011 KB bundle and the runtime itself. Index construction
also costs **542 ms** at 100,000, paid on every cold isolate.

**Honest verdict, by size:**

- **650 → 10,000: comfortable.** 7 MB resident, 14 ms index build, sub-millisecond
  worst-case retrieval. Nothing here is the limiting factor.
- **100,000: not reachable in-process.** CPU is fine (5 ms worst case against
  29 ms for a scan). Memory and cold-start are not. Reaching 100,000 requires
  the index to stop being resident — a database-backed inverted index (a
  Postgres GIN index or a postings table) with retrieval as a query. That is an
  architectural change this module does not make and should not pretend to.

Small memory figures (≲1 MB) are GC noise and should not be read closely; the
100,000 row is the one that matters.

## Vocabulary, and a correction

An earlier note in this work recorded a "vocabulary ceiling at ~10,107
scenarios", derived from a generator that sampled tokens from a Zipf
distribution with replacement. That ceiling was an artifact of the sampling
method. Sampling with replacement has no bound on the head, so the most common
token reached 47% of the catalog against 7.7% in the real one — the generator
ran out of distinct signatures because its own head had eaten the vocabulary.

Constructing the frequency profile directly instead, **100,000 distinct
scenarios are reachable**, with 0.10% exact signature collisions.

The real limit is lexical, not combinatorial, and it is worth stating
precisely. With the vocabulary held at the shipped glossary's **516 canonical
tokens**, exact signature collisions are:

| scenarios | colliding | rate |
|---|---|---|
| 650 | 0 | 0.00% |
| 3,500 | 2 | 0.06% |
| 10,000 | 59 | 0.59% |
| 30,000 | 510 | 1.70% |
| 100,000 | 4,008 | 4.01% |

A colliding scenario is one no message can ever distinguish from another; the
ranking tie-break picks between them by scenario id. So growing the catalog
without growing the glossary does not fail — it degrades, and the degradation
is measurable in advance. Roughly: the glossary needs to grow with the catalog
to hold collisions near zero (V/N ≈ 0.79 in the shipped catalog).

A large vocabulary with a small catalog is *not* realisable while holding a
heavy head, and the generator flags that regime rather than producing a
misleading benchmark.
