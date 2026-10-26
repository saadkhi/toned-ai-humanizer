# Toned AI Humanizer

Read README.md before changing the application. This repository is a React/Vite frontend with Node Vercel API functions. Browser-local storage holds rewrite history; there is no account system or application database.

- `src/`: screens, browser job store, and sequential pipeline client.
- `api/run-stage.js`: validated rewrite-and-audit stages.
- `api/_pipeline.js`, `_config.js`, `_security.js`: provider transport, server configuration, and spend protection.
- `api/health.js`: configuration readiness without secrets or a live provider call.
- `scripts/local-api.js`: Vite development adapter for the same production handlers.

Run `npm ci`, then `npm run dev` from this directory. Keep API keys in server environment variables or ignored `.env.local`; never use a `VITE_` credential or expose provider responses containing secrets. Do not log document bodies.

Use the existing checkout. Cloud tasks are already isolated; do not create a Git worktree unless the user requests it.

Run `npm run check` and `npm run test:e2e` for relevant changes. Browser tests use Chromium (`PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` may select an installed browser). Mock provider requests in automated tests; live model checks require a real configured key and may incur charges. Never mark incomplete, unaudited, or malformed model output as successfully verified. Human review is still required.
