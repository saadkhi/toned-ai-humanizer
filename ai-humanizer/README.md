# Toned AI Humanizer · Developer guide

[← Product overview](../README.md)

A writing editor that changes voice while checking the rewrite against the original. Paste text or open a `.txt`/Markdown document, choose a voice, then review paragraph changes, factual flags, and editor notes. Outputs can be copied or downloaded. Automated auditing reduces risk; it does not establish that the source is true or guarantee that a rewrite is accurate.

## Development

Requires Node.js 22 or 24 and npm. From this directory:

```bash
npm ci
cp .env.example .env.local
# Enter an OpenRouter key in .env.local (never commit it).
npm run dev
```

The Vite development server runs the frontend and real Node API handlers together. No CLI login, account linking, database, or separate backend process is required. Restart the server after changing environment variables. `npm run preview` serves only the built frontend; use `npm run dev` to exercise the API locally.

In a cloud environment that provides `HTTPS_PROXY`/`HTTP_PROXY`, start Node 24 with `NODE_USE_ENV_PROXY=1 npm run dev` so server-side model requests use the existing proxy. This preserves TLS verification. Browser access also depends on the environment's network allowlist; a blocked inspection request does not establish that the deployed site is down.

`GET /api/health` reports **configuration readiness**, not credential validity or upstream availability. Without a usable key for the selected mode the editor explains that rewriting is unavailable and leaves document input accessible. No API key is entered into the browser or sent to it.

## Provider configuration

The default **free-only** mode uses OpenRouter's `openrouter/free` route for both fast and quality stages. Set `OPENROUTER_API_KEY_1` on the server. Optional `_2`/`_3` keys rotate as needed. `OPENROUTER_FREE_MODEL` may select a model ending in `:free`; a paid model ID is rejected in this mode. Google, SambaNova, Cloudflare, and paid OpenRouter model overrides are excluded from fallback while free-only mode is active.

The model catalog reported zero prompt and completion pricing for `openrouter/free` during verification. Availability and provider free-tier limits still apply. Hosting and the production Redis service have separate plans and limits. Free-only routing does not promise unlimited use.

To explicitly enable potentially paid providers/models, set `AI_PROVIDER_MODE=configured` and configure at least one of these **server** credentials:

| Provider | Credential | Default fast / quality models | HTTPS destination |
| --- | --- | --- | --- |
| Google | `GOOGLE_API_KEY` (or `GOOGLE_API_KEY_1`) | `gemini-2.5-flash` / `gemini-2.5-pro` | `generativelanguage.googleapis.com` |
| OpenRouter | `OPENROUTER_API_KEY_1` | `google/gemini-2.5-flash` / `google/gemini-2.5-pro` | `openrouter.ai` |
| SambaNova | `SAMBANOVA_API_KEY_1` | `Meta-Llama-3.3-70B-Instruct` | `api.sambanova.ai` |
| Cloudflare | `CLOUDFLARE_API_KEY_1` and `CLOUDFLARE_ACCOUNT_ID` | Llama 3.1 8B / 70B Instruct | `api.cloudflare.com` |

Each provider supports `_KEY_2` and `_KEY_3` for rotation and a singular `*_API_KEY` alias. Override models with `<PROVIDER>_MODEL_FAST` and `<PROVIDER>_MODEL_QUALITY`. Model access and availability depend on your provider account. Configure only destinations you use. Google credentials use the `x-goog-api-key` header, not query strings. Provider error bodies and generated document fragments are never included in public error messages.

`GOOGLE_API_KEY_1` is not required when `GOOGLE_API_KEY` is set. Key rotation continues across requests within each running server instance; a new instance starts its own rotation. Changing the configured key set resets that provider's pool.

In configured mode, provider calls use Google → OpenRouter → SambaNova → Cloudflare for both structured and prose stages, skipping unconfigured providers. They default to 60 seconds per attempt, up to four attempts, and a 120-second total budget shared across attempts. This permits fallback after an immediate rejection without extending the request deadline. Override with `LLM_REQUEST_TIMEOUT_MS`, `LLM_MAX_ATTEMPTS` (maximum four), and `LLM_TOTAL_TIMEOUT_MS` (maximum 120,000); an explicit lower attempt limit may skip later providers. Retries may incur additional provider charges. Stopping a rewrite prevents subsequent browser requests; an already-running model call may still finish and incur a charge.

Never prefix a secret with `VITE_`: those variables are intended for browser bundles. Cloud environment settings and Vercel project environment variables are separate; configure the target where you run the application.

## Pipeline and accuracy

The browser drives individually bounded server requests: extraction → diagnosis → sequential section rewrites → lossless assembly → independent audit → up to two repairs and re-audits → finalization.

- Structured model results are validated before advancing a stage.
- Source/settings fingerprints invalidate stale pipeline state.
- Long paragraphs are split into bounded sections; assembly requires all sections.
- The auditor sees the full original and rewrite, without the rewrite plan. Stable source IDs require coverage of each extracted occurrence, including repeated facts and uncertainty markers. It checks additions, omissions, certainty, and requested formatting.
- Deterministic checks supplement the model; failures remain visible even when the model says a fact was preserved.
- Repair invalidates the previous audit. Finalization requires an audit of the current text, and unresolved findings produce **Needs review**.
- Accepting/rejecting changes after the audit changes the exported text; audit results describe the generated rewrite, not every possible edited combination.
- Review aligns source and rewritten passages, preserving whitespace and line endings. Ambiguous structural changes are grouped for review rather than assigning an unrelated source paragraph to a change. Choices persist with saved history.

The browser input limit is 20,000 characters. The client holds pipeline state; fingerprints prevent accidental stale results, but are not an authorization or billing ledger. Token/cost figures are estimates, not enforceable spending balances. Do not use them for billing.

Code fences are kept intact; an oversized fenced block is rejected rather than split and corrupted. Dense documents may still exceed a model's structured-output limit. These fail visibly rather than returning a falsely successful result; shorten the input or choose a model with sufficient output capacity.

## Production deployment

Deploy the `ai-humanizer` directory as the Vercel project root. `vercel.json` configures the Vite build, SPA routes, Node function durations, and security headers.

Before allowing public traffic:

1. Keep `AI_PROVIDER_MODE=free` with a valid OpenRouter key for free-only routing, or explicitly opt in to configured mode with a valid provider credential and any model overrides in Vercel server environment settings.
2. Create a dedicated Upstash Redis database and set `UPSTASH_REDIS_REST_URL` (HTTPS REST URL) and `UPSTASH_REDIS_REST_TOKEN`. Allow outbound requests to that exact database hostname. The token needs permission to execute EVAL. These values remain server-only.
3. Review `RATE_LIMIT_REQUESTS` (default 60 stage calls per client per 600 seconds) and `DAILY_STAGE_LIMIT` (default 1,000 stage calls globally per UTC day). These count requests, including retries, not documents or currency. A normal document uses multiple calls. Apply provider-side billing limits and deployment firewall/bot protection appropriate to your traffic.
4. Run checks below. Validate a representative rewrite with the actual model/key and review its audit. Test deployment routes and headers. A green health response alone does not validate a key, Redis connectivity, or output quality.
5. Deploy through your normal release process. This setup does not publish or deploy the app.

Production billable endpoints fail closed if durable rate limiting is unconfigured or unavailable. Local development uses an in-memory limiter. Redis stores hashed client identifiers and counters, not source documents. The API rejects cross-origin browser calls, oversized requests, and malformed stage state. Rate limits cap abuse but are not user authentication; the application currently has no accounts or paid subscriptions. Use deployment access protection for private releases.

## Data and privacy

History and preferences are stored in this browser's `localStorage`; they do not synchronize between devices. Source and rewritten text travel through the API to the configured AI provider during processing. Provider data-retention terms apply. Browser extensions or anyone using the same browser profile may access locally saved history. Settings provide retention preferences and deletion controls; clearing site data also removes history. There is no background purge when the browser is closed.

## Checks

See the [release verification report](../docs/browser-audit.md) for the browser audit, real free-model sample, and remaining deployment checks.

```bash
npm run check          # lint, Node regression tests, production build
npm run test:e2e       # browser checks with mocked AI responses; no billable calls
```

Install a Playwright Chromium browser using `npx playwright install chromium`, or set `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium` when using a system browser. CI installs the pinned Playwright browser. Unit and browser tests exercise failure handling and deterministic fixtures, not statistical model accuracy. A real-provider evaluation set is still needed before making measured accuracy claims.

## Provider availability and billing errors

The application tries alternate keys and configured fallbacks within a bounded request budget. A model/request rejection does not exhaust every key for that same unavailable model. Authentication, rate-limit, and server failures can rotate to another key without leaking upstream error bodies.

`provider_billing_required` identifies an upstream account allowance failure. In configured mode, some providers reserve credits for the maximum requested output, so a small request can be rejected even when a tiny probe succeeds. Review the provider account's allowance; do not disable validation or silently reduce the output budget to make a check pass. Free-only mode prevents paid provider fallback and reports zero estimated model cost for known free routes.
