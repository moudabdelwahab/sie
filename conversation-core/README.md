# Conversation Core

The conversation layer between channel adapters and the agent runtime
(the Conversation Core + Agent Runtime audit, decisions D1–D6, stage B).

| Owns | Does not know |
|---|---|
| conversation and customer identity, ingest, idempotency, ordering (`seq`), ownership and handoff, `state_version`, `commitTurn`, outbound delivery state, conversation events | SIE, any LLM, MCP, channel implementations, provider APIs (Graph, Bot API), UI, credentials |

Every guarantee is enforced **inside one database transaction** by Mad3oom's
`migrations/064_conversation_core.sql`:

- `conv_ingest_message`: finds, adopts or creates the conversation without
  races, deduplicates the message by the channel's id, assigns `seq` and returns
  `{created, conversation, owner, stateVersion}`. Only `created: true` may
  start an agent (`shouldRunAgent`).
- `conv_commit_turn(expectedVersion)`: writes the reply, state, optional
  ticket, optional handoff, delivery record and event together, or writes
  nothing and returns `version_conflict | human_owner | closed`. A human
  takeover always wins.
- `conv_claim_delivery` / `conv_record_delivery`: one sender per outbound
  reply; a retry reuses the same row.

This module validates the canonical `Message` / `Part` model (`model.js`,
which uses a whitelist, so provider structures are refused), shapes the
requests (`core.js`), and calls those functions through an injected client
(`store-supabase.js`). Events are the existing `inbox_events` rows
(`events.js`). Rollout flags live in `sie_settings` and default to closed
(`flags.js`).

Storage is not unified: website, Telegram and Android use `chat_sessions` /
`chat_messages`, and WhatsApp uses `messages` (063).

Boundaries are tests (`tests/architecture.test.mjs`): Core imports only its
own files, the agent runtime never imports a channel implementation, and only
listed entry points may use the service-role key.

The concurrency proofs run on real PostgreSQL in Mad3oom's
`tests/sql/conversation-core.test.sql`.
