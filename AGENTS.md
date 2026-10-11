# human-picker-server — Agent Instructions

## Product contract

This project is a local-first, web-first human decision inbox for AI agents. The human remains the authority on subjective choices. Never silently choose a default when a request is cancelled, expires, or becomes inaccessible.

## Architecture

- `src/server/`: Fastify REST/SSE, stateless MCP bridge, authentication, SQLite decision storage.
- `src/shared/`: shared decision contracts and validation helpers.
- `web/`: Vue 3 inbox and selection/confirmation UI.
- `tests/`: protocol and state invariants.
- Preserve a single decision state machine regardless of transport (REST, MCP, future hooks).

## Safety & scope

- No implicit `git commit`, `git rebase`, force-push, or filesystem mutation as the result of selecting wording.
- Only listen on loopback in this initial release. Never claim public-hosting security.
- A selected option becomes final *only after* explicit confirmation.
- Do not introduce user-provided network callback URLs without SSRF protection and authentication.
- Never include tokens in git history, application audit logs, API responses, or remote telemetry. The local interactive startup console may display the generated token once for setup.

## Development

- Keep docs and `README.md` honest about implemented vs planned capabilities.
- Before proposing changes, run `npm test` and `npm run build` when dependencies are available.
- Conventional Commits are recommended; describe actual engineering changes, not fictional product milestones.
