# Toned AI Humanizer

Read README.md before changing the application. This repository is a React/Vite frontend with Node Vercel API functions. Browser-local storage holds rewrite history; there is no account system or server document database. Production uses Neon Postgres or Upstash Redis for request-limit counters only.

- `src/`: screens, browser job store, and sequential pipeline client.
- `api/run-stage.js`: validated rewrite-and-audit stages.
- `api/_pipeline.js`, `_config.js`, `_security.js`: provider transport, server configuration, and spend protection.
- `api/health.js`: configuration readiness without secrets or a live provider call.
- `scripts/local-api.js`: Vite development adapter for the same production handlers.
- `db/neon-rate-limits.sql`: repeatable Neon request-limit schema migration; run once in the database used by the server connection string.

Run `npm ci`, then `npm run dev` from this directory. Keep API keys in server environment variables or ignored `.env.local`; never use a `VITE_` credential or expose provider responses containing secrets. Do not log document bodies.

Use `RATE_LIMIT_STORE=neon` with `DATABASE_URL` (or `NEON_DATABASE_URL`) for Neon, or `RATE_LIMIT_STORE=upstash` with both Upstash REST variables. Neon requires its schema migration before live stage requests. Auto selection prioritizes any supplied Upstash binding, then Neon; partial or invalid configured stores fail closed. Never bypass production limits or treat a green configuration-only health response as proof of database connectivity, installed schema, or provider access.

Use the existing checkout. Cloud tasks are already isolated; do not create a Git worktree unless the user requests it.

Run `npm run check` and `npm run test:e2e` for relevant changes. Browser tests use Chromium (`PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` may select an installed browser). Mock provider requests in automated tests; live model checks require a real configured key and may incur charges. Never mark incomplete, unaudited, or malformed model output as successfully verified. Human review is still required.
