# SIE production deployments

One row per deployment of the shared engine to production (Supabase project `srnelrdpqkcntbgudyto`).
Both edge functions that run the engine — `sie-api` (Website) and `sie-channel-telegram` (Telegram) —
are always pinned to the **same** engine commit (jsDelivr `gh/moudabdelwahab/sie@<commit>`) and
deployed together. "Rollback" is the previous verified engine commit: re-pin both functions to it.

Evidence levels used below: *tested locally* (unit/integration/golden suites), *production profile*
(the real runtime with production settings, synthetic data), *deployed* (live source verified),
*real traffic* (a real customer turn traced in `chat_engine_trace_events`).

| Date (UTC) | WP | Engine commit | `sie-api` | `sie-channel-telegram` | Rollback |
|---|---|---|---|---|---|
| 2026-10-06 22:34 | WP3 | `d2bff13` | v23 | v27 | `77210d9` |
| 2026-10-08 21:23 | WP4 | `cc3b9f7` | v24 (21:22:58) | v28 (21:23:34) | `d2bff13` |

## WP4 — 2026-10-08

- **Repo pin commit:** `e5c7312` (both functions re-pinned to `cc3b9f7802730729a66c375cb4cb119df12fe345`).
- **Deployed source:** identical to the previous versions except the engine pin (and one comment
  line of cold-start measurement in `handlers/chat-reply.ts`). `verify_jwt` unchanged (false on both;
  `sie-api` binds identity in the database, Telegram verifies its webhook secret).
- **Pre-deploy:** clean tree; full suite 1,362/1,362; mutations 80 killed / 0 survived / 6 SQL skipped;
  audit tool 17/21 fixed, 4 reproduce as expected (A control, B2, H, J); WP4 probes: only the six
  classified reds (P4/Q1/Q2 = R1 → WP5, P5/P6 intended hand-off, R1 → WP5); PII sweep clean;
  CDN warm-up: all 107 files of the engine's import graph returned 200, and the five WP4 modules'
  MD5 matched the repository.
- **Cold start (import + first turn, local harness):** Free 142–250 ms / Max 181–206 ms
  (`d2bff13`: 150–309 / 158–200 ms). Live boot 38–48 ms.
- **Live verification:** both functions' live source reference only `cc3b9f7` (sie-api: 2 imports;
  telegram: 10 imports); no other engine commit remains.
- **Smoke tests (pg_net):** `sie-api` health 200, engine loaded, catalog 635; chat reply without a
  token 401; is-admin without a token `false`; unknown path 404. Telegram self-check 200: engine
  loaded, catalog 635, identity table readable (1 linked chat), webhook registered and pointing at the
  function, 0 pending updates, no last error. Telegram POST without the webhook secret 401.
- **Logs:** boots only; one expected warning (the unauthenticated probe rejected); no errors, no 5xx.
- **Settings (unchanged):** `memory_use_past_conversations=false`, `shadow_run_enabled=false`;
  `language_typo_tolerance`, `ticket_prompt_minutes`, `emotion_escalation_requires_context` have no
  rows, so their defaults apply (false, 30, true). `trust_boundary_enabled=true`,
  `trust_boundary_enforce=true`; Trust CP1 reads the full received text.
- **Real traffic:** none since deployment — the last SIE trace in production is 2026-09-24. WP4
  behaviour is verified locally, under the production profile and as deployed, **not** yet on real
  customer turns.
- **Rollback compatibility:** sessions written by WP4 stay readable by `d2bff13` (new fields are
  additive). One known difference: a "yes" to a ticket question asked by WP4, answered after a
  rollback, falls back to the traditional engine for that one turn (WP4 no longer stores the old
  reply text with the question). No data loss.
