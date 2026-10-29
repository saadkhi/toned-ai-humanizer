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

The model catalog reported zero prompt and completion pricing for `openrouter/free` during verification. Availability and provider free-tier limits still apply. Hosting and production request-limit storage have separate plans and limits. Free-only routing does not promise unlimited use.

To explicitly enable potentially paid providers/models, set `AI_PROVIDER_MODE=configured` and configure at least one of these **server** credentials:

| Provider | Credential | Default fast / quality models | HTTPS destination |
| --- | --- | --- | --- |
| Google | `GOOGLE_API_KEY` (or `GOOGLE_API_KEY_1`) | `gemini-2.5-flash` / `gemini-2.5-pro` | `generativelanguage.googleapis.com` |
| OpenRouter | `OPENROUTER_API_KEY_1` | `google/gemini-2.5-flash` / `google/gemini-2.5-pro` | `openrouter.ai` |
| SambaNova | `SAMBANOVA_API_KEY_1` | `Meta-Llama-3.3-70B-Instruct` | `api.sambanova.ai` |
| Cloudflare | `CLOUDFLARE_API_KEY_1` and `CLOUDFLARE_ACCOUNT_ID` | Llama 3.1 8B / 70B Instruct | `api.cloudflare.com` |

Each provider supports `_KEY_2` and `_KEY_3` for rotation and a singular `*_API_KEY` alias. Override models with `<PROVIDER>_MODEL_FAST` and `<PROVIDER>_MODEL_QUALITY`. Model access and availability depend on your provider account. Configure only destinations you use. Google credentials use the `x-goog-api-key` header, not query strings. Provider error bodies and generated document fragments are never included in public error messages.

`GOOGLE_API_KEY_1` is not required when `GOOGLE_API_KEY` is set. Key rotation continues across requests within each running server instance; a new instance starts its own rotation. Changing the configured key set resets that provider's pool.

In configured mode, provider calls use Google → OpenRouter → SambaNova → Cloudflare for both structured and prose stages, skipping unconfigured providers. In both modes, calls allow **four minutes thirty seconds per attempt**, up to four attempts, and **four minutes forty seconds total per stage**, shared across all retries. A slow first attempt leaves only the remaining stage budget for fallback; retries do not multiply the total wait.

| Server setting | Default | Maximum |
| --- | --- | --- |
| `LLM_REQUEST_TIMEOUT_MS` | `270000` (4 minutes 30 seconds per attempt) | `280000` |
| `LLM_TOTAL_TIMEOUT_MS` | `280000` (4 minutes 40 seconds across attempts) | `280000` |
| `LLM_MAX_ATTEMPTS` | `4` | `4` |

The browser and live-test transport wait 310 seconds for each API response. Vercel's stage function is configured for 300 seconds; the model budget reserves up to 15 seconds for request protection and 5 seconds for validation and response handling. This is close to the hosting ceiling. Keep Fluid compute enabled for that function duration on Vercel Hobby. Timeouts cannot be unlimited on this host. Long documents still use sequential sections, each with a fresh stage budget, so the whole rewrite may take longer than five minutes. Stop/cancel controls remain available.

If Vercel already defines the old timeout overrides, **remove them to use the new defaults**, or set `LLM_REQUEST_TIMEOUT_MS=270000` and `LLM_TOTAL_TIMEOUT_MS=280000`, then deploy the latest `main`. Redeploying an older commit does not include the new code or higher configuration ceilings. Verify `/api/health` reports the new deployment revision. Blank overrides also use defaults. Lower explicit overrides remain supported; an explicit lower attempt limit may skip later providers. Retries may incur additional provider charges. Stopping a rewrite prevents subsequent browser requests; an already-running model call may still finish and incur a charge.

Never prefix a secret with `VITE_`: those variables are intended for browser bundles. Cloud environment settings and Vercel project environment variables are separate; configure the target where you run the application.

## Pipeline and accuracy

The browser drives individually bounded server requests: extraction → diagnosis → sequential section rewrites → lossless assembly → independent audit → up to two repairs and re-audits → finalization.

- Structured model results are validated before advancing a stage. Invalid JSON, schema failures, missing extracted facts, and incomplete audit coverage trigger a fresh model attempt within the same four-attempt/280-second budget. Validation stays strict; exhausting that budget returns an error. Usage includes completed responses rejected by validation.
- The short diagnosis stage requests OpenRouter's `reasoning.effort=minimal`, leaving more of its output allowance for the required JSON when the free router selects a reasoning model. Extraction and auditing retain their existing reasoning behavior. Provider limits or truncation can still cause a visible failure.
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
2. Configure **one** shared request-limit store: [Neon Postgres](#neon-postgres-setup) or [Upstash Redis](#upstash-redis-setup). Both offer Free plans with quotas. Use `RATE_LIMIT_STORE=neon` or `RATE_LIMIT_STORE=upstash` to make the choice explicit. Keep connection credentials server-only and allow outbound requests to the actual database hostname.
3. Review `RATE_LIMIT_REQUESTS` (default 60 stage calls per client per 600 seconds) and `DAILY_STAGE_LIMIT` (default 1,000 stage calls globally per UTC day). These count API stage requests, including browser retries, not documents or currency. Internal model retries share one stage admission and have their own bounded attempt budget. A normal document uses multiple calls. Apply provider-side billing limits and deployment firewall/bot protection appropriate to your traffic.
4. Run checks below. Validate a representative rewrite with the actual model/key and review its audit. Test deployment routes and headers. A green health response alone does not validate a key, database connectivity, installed Neon schema, or output quality.
5. Deploy through your normal release process. This setup does not publish or deploy the app.

Production billable endpoints fail closed if durable rate limiting is unconfigured or unavailable. Local development without store settings uses an in-memory limiter. Neon and Upstash store hashed client identifiers and counters, not source documents. Browser history does not move to Neon. The API rejects cross-origin browser calls, oversized requests, and malformed stage state. Rate limits cap abuse but are not user authentication; the application currently has no accounts or paid subscriptions. Use deployment access protection for private releases.

### Neon Postgres setup

Neon can provide the shared request-limit store without an Upstash account. Its Free plan has storage/compute quotas and can suspend idle compute; waking a database may add latency. Check [Neon's current plans](https://neon.com/pricing) for their limits.

1. Open [Neon Console](https://console.neon.tech/), create a project on the **Free** plan, and select the database and branch you will use for production.
2. Open that database's **SQL Editor** and run the complete [db/neon-rate-limits.sql](db/neon-rate-limits.sql) migration once. Use the same database/branch and role as the connection string. The migration creates the counters and atomic limiter function and can be rerun safely.
3. Open **Connect** and copy the PostgreSQL URI starting with `postgresql://` or `postgres://`. Keep its password private. When Neon displays `psql 'postgresql://…'`, the URI inside the quotes is the environment value. The server also accepts a simple pasted `psql 'URI'`, quoted URI, or `DATABASE_URL=URI` assignment as data; it never executes that text. The URL must use the project's `*.neon.tech` hostname and `sslmode=require` or `sslmode=verify-full`; pooled Neon connection strings are supported. An optional `channel_binding=require` or `prefer` parameter is accepted; other connection query parameters are rejected.
4. In **Vercel → Project → Settings → Environment Variables**, add these values for **Production**:

| Variable | Value |
| --- | --- |
| `RATE_LIMIT_STORE` | `neon` |
| `NEON_DATABASE_URL` | The full PostgreSQL connection string copied from Neon |
| `AI_PROVIDER_MODE` | `free` to keep free-only model routing |

`NEON_DATABASE_URL` is the preferred app variable and takes precedence when both names are set. `DATABASE_URL` remains a supported fallback for Neon CLI compatibility; use one current connection binding consistently. A Neon API key, dashboard URL, or database name alone is not a connection string. The Neon connection is used for counters only, so it does not create accounts or synchronize document history.

Add Preview scope too if preview deployments should rewrite. Save the variables, then choose **Deployments → latest production deployment → Redeploy**. Setting `RATE_LIMIT_STORE=neon` explicitly selects Neon even if old Upstash variables remain. Upstash credentials are not required for this option.

After deploying, confirm `/api/health` reports `configured: true` and `protectionConfigured: true`, then run a real rewrite. Health checks configuration presence/format only: it does not query Neon, check the migration, or verify the role's permissions. A missing migration, incorrect password, inaccessible database, or exhausted Free-plan quota will keep stage requests unavailable rather than bypassing limits.

The server uses Neon's HTTPS driver, with a 15-second request deadline to allow a suspended Free compute to wake. In a cloud environment with restricted networking, allow the SDK's regional `api.<region>.<cloud>.neon.tech` destination for your database; allowing only the PostgreSQL endpoint hostname may be insufficient. Preserve TLS verification.

#### Neon CLI workflow

The included `neon.ts` declares a Postgres-only policy and leaves branch lifetime and compute settings unchanged. Link this app directory to your own project with `neon init`, then run `neon deploy`. If a global CLI install is unavailable, use `npx neon@latest` for those commands. The CLI writes its project link to ignored `.neon` and pulls the pooled `DATABASE_URL` and direct `DATABASE_URL_UNPOOLED` into an ignored local environment file. Keep `RATE_LIMIT_STORE=neon` and `AI_PROVIDER_MODE=free` in server settings.

The CLI needs an authenticated Neon session or a securely injected `NEON_API_KEY`. A database connection string authorizes SQL, while deployment also needs project-management access. On a remote runner, a scoped API key can be easier than browser OAuth. Never put either credential in source control or chat. Restricted network environments must allow `api.neon.tech` for management, `oauth2.neon.tech` for browser sign-in, and the actual database HTTP endpoint for application requests. Some database endpoints include a routing label such as `c-6`; preserve that label in the SDK destination.

Apply the tracked schema through a direct connection after deployment:

```bash
npx neon@latest psql production -- -v ON_ERROR_STOP=1 -f db/neon-rate-limits.sql
npm run db:check
npm run db:check -- --exercise-guard
```

The final command consumes one real request allowance. The check reads `.env.local` and `.env` while preserving injected environment values, verifies connectivity/schema/permissions, and prints sanitized status records. A nonzero exit means verification did not pass; missing configuration is never reported as a successful connection. Start `npm run dev` and exercise a real rewrite afterward. `neon deploy` provisions backend settings; Vercel remains the frontend/API host and requires its own server environment configuration and redeployment.

### Upstash Redis setup

Open [Upstash Console](https://console.upstash.com/), create a dedicated Redis database, and choose the **Free** plan. Open its **REST API** section and copy the REST URL and standard REST token. Free-plan quotas apply; [check the current limits](https://upstash.com/pricing/redis).

In **Vercel → Project → Settings → Environment Variables**, set these variables for **Production**:

| Variable | Required value |
| --- | --- |
| `RATE_LIMIT_STORE` | `upstash` |
| `UPSTASH_REDIS_REST_URL` | The database's HTTPS REST URL, such as `https://<database>.upstash.io`. Use the REST URL, not a `redis://` connection string; do not add a path or query. |
| `UPSTASH_REDIS_REST_TOKEN` | The database's REST token with EVAL/write permission; a read-only token cannot enforce counters. |

Save, then redeploy the production deployment. Neon credentials and its SQL migration are not required for this option.

With `RATE_LIMIT_STORE=auto` (the default), any supplied Upstash REST variable selects Upstash; otherwise a supplied Neon URL selects Neon. A partial or invalid selected store fails closed. Explicit store selection avoids ambiguity when several integrations add environment variables. Local development can omit all store credentials.

### Rewriting is unavailable after deployment

Inspect the deployed `/api/health` response. When it reports `providerConfigured: true` and `protectionConfigured: false`, the model provider has configuration but production request limiting does not. Waiting or adding another model key will not resolve this setup issue.

With `protectionStore: "neon"`, a false protection status means the running deployment has a missing or rejected connection value; it has not attempted a database connection yet. The `protectionIssue` field identifies the validation failure without returning credentials:

| Issue | Adjustment |
| --- | --- |
| `neon_url_missing` | Set `NEON_DATABASE_URL` in Production, then redeploy. Saved project variables are separate from those captured by an existing deployment. |
| `neon_url_invalid` | Copy the complete PostgreSQL URI from Neon Connect. Verify its username, password, database path, and Neon hostname locally; keep the value private. |
| `neon_url_requires_tls` | Use exactly one `sslmode=require` or `sslmode=verify-full` query parameter. |
| `neon_url_unsupported_parameters` | Use the standard Neon URI with `sslmode` and optional `channel_binding=require`/`prefer`. Remove other connection query options. |

If `NEON_DATABASE_URL` exists, it takes precedence over `DATABASE_URL`; keep one current connection binding. `deploymentRevision` reports the running Git commit prefix when Vercel supplies it, so you can verify that a new deployment includes a fix. Neither field establishes database connectivity or schema readiness.

If health is configured but a rewrite fails, the API distinguishes these database setup errors without exposing upstream messages:

| Stage error code | Adjustment |
| --- | --- |
| `rate_limit_schema_missing` | Run the complete `db/neon-rate-limits.sql` migration in the database/branch used by `NEON_DATABASE_URL` (or its CLI-compatible fallback). |
| `rate_limit_database_auth_failed` | Refresh the connection string from Neon Connect for the intended database role, then redeploy. |
| `rate_limit_database_permission_denied` | Run the migration with the same role as the app connection, or grant that role the scoped table/function permissions listed in the SQL file. |

Temporary networking, compute capacity, and other unclassified database failures retain `rate_limit_unavailable`; they never bypass shared limits.

Follow either the [Neon](#neon-postgres-setup) or [Upstash](#upstash-redis-setup) setup above. Enter database credentials securely in Vercel; they are separate from Codex cloud environment bindings. Add Preview scope too if preview deployments should rewrite. **Redeploy after saving:** changing variables does not update an already-built deployment.

In Vercel, open **Deployments**, select the latest production deployment, and choose **Redeploy** after saving the selected store's variables. Do not paste database passwords or tokens into the editor, source files, chat, or a variable prefixed with `VITE_`.

After redeployment, health should return HTTP200 with `configured`, `providerConfigured`, and `protectionConfigured` all `true`. Then run a real rewrite: health checks presence/format only, so incorrect credentials, missing Neon schema, an inaccessible store, or an unavailable model can still cause a stage error. Keep free-only routing enabled; its production request protection is still required.

## Data and privacy

History and preferences are stored in this browser's `localStorage`; they do not synchronize between devices. Source and rewritten text travel through the API to the configured AI provider during processing. Provider data-retention terms apply. Browser extensions or anyone using the same browser profile may access locally saved history. Settings provide retention preferences and deletion controls; clearing site data also removes history. There is no background purge when the browser is closed.

## Checks

See the [release verification report](../docs/browser-audit.md) for the browser audit, real free-model sample, and remaining deployment checks.

```bash
npm run check          # lint, Node regression tests, production build
npm run test:e2e       # browser checks with mocked AI responses; no billable calls
npm run evaluate:live  # manual real free-model check of the public deployment
```

Install a Playwright Chromium browser using `npx playwright install chromium`, or set `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium` when using a system browser. CI installs the pinned Playwright browser. Unit and browser tests exercise failure handling and deterministic fixtures, not statistical model accuracy.

The [manual rewrite evaluation](evaluation/README.md) submits a 187-word synthetic AI-style document through the real editor, provider, audit, review controls, clipboard, downloads, and mobile layout. It records the actual input/output, stage trace, constraint checks, and screenshots. It fails on incomplete auditing or unverified required checks and uses only free model routing. A passing sample cannot establish human authorship, detector performance, perfect accuracy, or broad model reliability; those require different evidence and a larger evaluation set.

## Provider availability and billing errors

The application tries alternate keys and configured fallbacks within a bounded request budget. A model/request rejection does not exhaust every key for that same unavailable model. Authentication, rate-limit, and server failures can rotate to another key without leaking upstream error bodies.

`provider_billing_required` identifies an upstream account allowance failure. In configured mode, some providers reserve credits for the maximum requested output, so a small request can be rejected even when a tiny probe succeeds. Review the provider account's allowance; do not disable validation or silently reduce the output budget to make a check pass. Free-only mode prevents paid provider fallback and reports zero estimated model cost for known free routes.
