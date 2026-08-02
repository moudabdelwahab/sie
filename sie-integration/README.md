# SIE Integration Layer

This folder is the boundary between the engine under `/sie` and the Mad3oom
platform. Everything here depends on `/sie`'s public exports only — never the
other way around.

```
Mad3oom  (chat-logic.js · chat-widget.js · admin/* · tickets · future modules)
        ↓  imports ONLY this file
sie-runtime.js            ← the single public gateway
        ↓
sie-chat-bridge.js        ← INTERNAL: turn orchestration
sie-entitlement.js        ← INTERNAL: customer_sie_access + quota
        ↓
/sie/**                   ← INTERNAL: the nine engine modules
        ↓
Supabase (the SAME project Mad3oom uses — chat_messages, chat_sessions,
          tickets, chat_engine_*, customer_sie_access)
```

## The rule

**Mad3oom imports `sie-runtime.js` and nothing else from SIE.** If Mad3oom
needs a new capability, it gets a new export there — never a deeper import.
That is what lets any SIE module change shape without a single Mad3oom file
knowing.

| File | Responsibility |
|---|---|
| `sie-runtime.js` | **Public.** Chat, entitlement, admin. Every export is total: it never throws, and degrades to a documented safe value, so an engine bug cannot take down the chat widget or the admin panel. |
| `sie-chat-bridge.js` | Internal. Wires Language → Diagnostics → Ranking → Decision → Knowledge → Dialogue → Action for one turn, in the order each module's README specifies. |
| `sie-entitlement.js` | Internal. The one place the enabled / expired / quota rules live, in both readings: `evaluateSieAccessRow()` (read-only, for the UI) and `tryConsumeSieMessage()` (enforcing, spends a turn). |

## No HTTP layer — on purpose

SIE is the intelligence subsystem of Mad3oom, not a standalone product. It runs
in the customer's own browser tab, on the same origin, against the same Supabase
session Mad3oom already holds. There is no network boundary between them, so
there is no HTTP client here, no base URL, no circuit breaker, no retry policy
and no token forwarding.

The database enforces this: `sie_consume_message()` rejects any call where
`p_user_id <> auth.uid()`, so the caller **must** be the customer's own session.
A separate backend service could not consume a turn even if one existed.

## Wiring it into Mad3oom

Four call sites import from the runtime. Each is a one-line import change:

| File | Import |
|---|---|
| `assets/js/chat-logic.js` | `import { getSieReply } from '/sie-integration/sie-runtime.js';` |
| `chat-widget.js` | `import { getSieReply } from '/sie-integration/sie-runtime.js';` |
| `assets/js/admin/users.js` | `import { isCurrentUserSieAdmin, getSieAccessStatus, adminSetAccess, adminResetUsage } from '/sie-integration/sie-runtime.js';` |
| `assets/js/chatbot-mode-service.js` | `import { getSieAccessStatus } from '/sie-integration/sie-runtime.js';` |

Export names and signatures match what those files already call, so nothing else
in them changes.

### ⚠️ The one thing that must not be missed

`getSieReply()` returns `alreadyPersisted: true`. SIE's Action Layer has already
written the bot message, the session's `bot_state`, and any ticket — all in one
database transaction, which is why a ticket can never exist without its message.
The caller must therefore skip its own insert:

```js
const sieResult = await getSieReply({ text, supabase, sessionId, userId, botState });
if (sieResult) {
    renderQuickOptions(sieResult.options);
    return;                       // ← skip the normal chat_messages insert
}
// null → not entitled, quota spent, or an internal failure.
// Nothing was written; fall through to the traditional engine.
```

**Without that `return`, every bot message is written twice.**

## Serving

`/sie` and `/sie-integration` must be reachable from Mad3oom's own origin, so
that `/sie-integration/sie-runtime.js` resolves in the browser. Within this repo
every import is relative, so the tree can be mounted anywhere as long as the two
folders keep their relative positions.

## Two independent gates

Both must be open for a customer to actually get an SIE reply:

1. **The customer chose it** — `profiles.chatbot_mode === 'sie'`, a personal
   preference they can change at any time.
2. **An admin granted it** — a `customer_sie_access` row that is enabled, not
   expired, and has quota left. Purely an administrative decision.

These are deliberately separate: being able to pick SIE from the mode menu must
not by itself grant access to it.
