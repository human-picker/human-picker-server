# Decision API — v0.1

## Contract

A decision is a typed, expiring request with 2–9 uniquely identified candidates. The core never chooses by itself. Every decision terminates in one of: `confirmed`, `cancelled`, `expired`.

```json
{
  "type": "text",
  "title": "Choose a commit message",
  "source": "pi-agent",
  "context": { "project": "Personal OS", "summary": "Add SQLite journal persistence" },
  "options": [
    { "id": "a", "text": "[DATA VAULT ONLINE] Storage core ready" },
    { "id": "b", "text": "[MEMORY ARCHIVED] Journal persistence enabled" }
  ],
  "expires_in_seconds": 3600
}
```

Create is `POST /api/v1/decisions`. The server returns `201`, the stored record and a `url` with a `/#/d/:id` hash route.

Confirm is `POST /api/v1/decisions/:id/resolve` with `{"option_id":"a"}` or `{"option_id":"a","text":"edited text"}`. If another caller already resolved or cancelled the decision, return `409` without changing the stored state. Missing decisions return `404`. `POST /api/v1/decisions/:id/cancel` similarly rejects already-closed decisions.

Polling: `GET /api/v1/decisions/:id`. Long poll: `GET /api/v1/decisions/:id/wait?timeout_ms=15000`, returning the latest stored decision after a state change or timeout. Keep wait calls to ≤25 seconds to accommodate common MCP client timeouts. SSE: `GET /api/v1/events` sends `ready` and `decision` events; event data includes `{id,status}` only, not full sensitive contents.

## Security boundary

- Service listens only on `127.0.0.1`.
- All decision endpoints, SSE and MCP require the same Bearer token.
- Token persisted to `.data/token` with restrictive default file permissions (Windows ACLs still depend on account settings).
- Origin/Host checking restricts browser cross-origin abuse; caller must also know the token.
- No user-supplied callback URLs are executed.
- The web UI stores its token in `sessionStorage`, not a persistent cookie; clients provide it via Authorization.
- No state-changing GET endpoints.
- No automatic defaults on cancellation or expiration.
- Request body size is restricted to 128 KiB.

This is a **local-development security posture**, not a public-hosting architecture. Harden authentication, CSP, CSRF/cross-origin handling, host validation, audit logs and tenancy before remote hosting.

## Planned extensions

- Renderer kinds: `svg`, `web`, `audio`, `approval`, `batch`
- MCP capabilities or prompts for better selection UX
- Agent hook integrations with explicit interception policies
- Signed, short-lived per-request browser links
- Per-client token scopes and actor identity
