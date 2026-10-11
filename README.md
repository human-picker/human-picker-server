<div align="center">

# HUMAN PICKER / SERVER

**Human decisions. Machine execution.**

`LOCAL-FIRST` · `HUMAN-IN-THE-LOOP` · `MCP` · `REST` · `WEB INBOX`

> AI proposes. Human decides. Agent continues.

</div>

---

**human-picker-server** is the shared decision infrastructure for the [human-picker](https://github.com/human-picker) family. AI agents, local scripts and MCP clients can submit choices to a persistent local queue; humans review them in a web browser; callers fetch or wait for the confirmed result.

**Current status: V0.1 scaffold / initial implementation.** The first renderer supports text choices. SVG, HTML, audio and other pickers are planned. This is **not** an autonomous Git history editor and does not run AI models itself.

## SYSTEM TOPOLOGY

```text
 ┌───────────────────┐      POST /api/v1       ┌────────────────────────┐
 │ Pi / Codex / CLI  ├────────────────────────►│ human-picker-server    │
 │ Agent & workflows │      MCP /mcp           │                        │
 └─────────┬─────────┘                          │ Fastify + SQLite       │
           │                                    │ Decision state machine │
           │ wait / query                       └──────────┬─────────────┘
           │                                               │ SSE
           │                                               ▼
           │                                    ┌────────────────────────┐
           │                                    │  Web Decision Inbox    │
           │                                    │  Preview → Select      │
           │                                    │  Edit → Confirm        │
           │                                    └──────────┬─────────────┘
           │                                               │
           └◄────────────────── confirmed / cancelled ◄──────┘
```

## RUN LOCALLY

**Requirements:** Node.js 22+, npm, a working toolchain for `better-sqlite3` native modules if prebuilt binaries are unavailable.

```bash
git clone https://github.com/human-picker/human-picker-server.git
cd human-picker-server
npm install
npm run dev
```

**Note:** The clone URL becomes available *after the repository is created and pushed*. The source ZIP can also be extracted locally and run with `npm install`.

- Web UI (development): `http://127.0.0.1:5173`
- API / MCP: `http://127.0.0.1:4173`
- Production: `npm run build && npm start` (UI and API on port 4173)
- Tests: `npm test`
- Type check: `npm run typecheck`

When the server starts, it prints a **local access token**. Paste it into the Web Inbox authentication gate. The token is saved to `.data/token`, excluded from Git. For automation, supply your own secret via `HP_TOKEN` (at least 24 characters). See `.env.example` for configuration variables; environment variables must be set in your shell (the file is not loaded automatically).

All endpoints except the minimal health check require `Authorization: Bearer <token>`. V0.1 binds only to `127.0.0.1`. **Do not port-forward it or deploy it publicly as-is.**

## DECISION FLOW

1. An Agent POSTs a text decision with 2–9 candidates.
2. The new request appears in the Inbox via Server-Sent Events (SSE).
3. The human selects a candidate, optionally edits the final wording, and clicks **Confirm**.
4. The decision is stored in SQLite and becomes available to clients waiting or polling.
5. If the user cancels or the request expires, clients receive that state — **no silent default**.

### Create a decision

```bash
curl -X POST http://127.0.0.1:4173/api/v1/decisions \
  -H "Authorization: Bearer $HP_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "type":"text",
    "title":"Choose commit wording",
    "source":"pi-agent",
    "context":{"project":"Personal OS","summary":"SQLite persistence added"},
    "options":[
      {"id":"a","text":"feat(storage): [DATA VAULT ONLINE] Data core connected"},
      {"id":"b","text":"feat(storage): [MEMORY CORE ONLINE] Archive protocol enabled"}
    ]
  }'
```

Response includes `id`, `status: "pending"`, and a `url` with an Inbox deep-link. Other useful endpoints:

| Method | Endpoint | Purpose |
|---|---|---|
| GET | `/api/v1/health` | Minimal health check |
| POST | `/api/v1/decisions` | Create request |
| GET | `/api/v1/decisions?status=pending` | List requests |
| GET | `/api/v1/decisions/:id` | Read result or current state |
| GET | `/api/v1/decisions/:id/wait?timeout_ms=15000` | Wait up to 25s for decision |
| GET | `/api/v1/events` | Authenticated SSE notifications |
| POST | `/api/v1/decisions/:id/resolve` | Confirm selection |
| POST | `/api/v1/decisions/:id/cancel` | Cancel selection |
| POST | `/mcp` | Stateless MCP Streamable HTTP |

Example confirmation payload: `{"option_id":"a","text":"Optional human-edited text"}`. Omitting `text` selects the original candidate verbatim. Invalid IDs and duplicate confirmations are rejected.

### MCP

Connect a Streamable HTTP MCP client to `http://127.0.0.1:4173/mcp` and supply the Bearer token in its HTTP headers. It exposes:

- `human_picker_create`
- `human_picker_get_result`
- `human_picker_wait_result`

**MCP is an adapter over the same decision service, not a separate database or decision engine.** `wait_result` returns after confirmation, cancellation, expiry, or 1–25 seconds. If still `pending`, call again; clients may impose shorter transport timeouts. See [API documentation](docs/API.md).

## PROJECT STRUCTURE

```text
src/
  server/
    index.ts       # local server entry
    app.ts         # REST + SSE + static UI
    mcp.ts         # MCP Streamable HTTP adapter
    db.ts          # SQLite repository & transaction guards
    service.ts     # decision events / wait coordination
    auth.ts        # local access token
  shared/
    decision.ts    # data types + invariant helpers
web/
  index.html
  src/
    App.vue        # inbox, review, copy, confirm
    style.css
    main.ts
tests/
  decision.test.mjs
```

## NON-GOALS / V0.1

- No LLM calls or automatic candidate generation.
- No automatic `git commit`, `git rebase`, `force push`, or filesystem mutation.
- No remote/multi-user deployment or browser-to-agent command injection.
- No agent-runtime interception yet — deterministic hooks/extensions belong in later adapters.

Forcing an agent to invoke a Picker requires integration with its workflow, not merely publishing an MCP tool. For clients without MCP, **Copy Result** is always available.

## NEXT TRANSMISSIONS

- [x] Local REST decision service with SQLite
- [x] Web Inbox for text options
- [x] Confirm, cancel, edit and copy workflows
- [x] Authenticated SSE updates and result waiting
- [x] Streamable HTTP MCP bridge
- [ ] Multi-item / batch review
- [ ] SVG, Web and Audio renderers
- [ ] Agent hooks and Pi extension
- [ ] Remote deployment with hardened authentication
- [ ] Comprehensive integration and browser tests

> **Decision authority stays with the human.**

---

<sub>Initial repository scaffold. The feature checklist reflects implemented code paths, not a claim of full end-to-end production validation.</sub>
