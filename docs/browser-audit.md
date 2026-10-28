# Release verification · 28 October 2026

This report records checks against the repository in the cloud development environment. The initial public-site inspection was blocked by the environment proxy. A later live check reached the deployment and confirmed a configuration blocker; see the follow-up below.

## Changes verified

- **Free-only model routing:** both model tiers use OpenRouter's `openrouter/free` route by default. Paid tier overrides and other providers are excluded. Invalid paid overrides for `OPENROUTER_FREE_MODEL` disable generation rather than enabling paid fallback. Paid providers require explicit `AI_PROVIDER_MODE=configured`.
- **Document fidelity:** extraction uses explicit paragraph indices; Windows, Unix, and classic Mac line endings, whitespace-only paragraph separators, indentation, dense Unicode text, and section boundaries retain their source offsets. Code fences are kept whole; oversized fences fail visibly.
- **Review and exports:** accepted output matches the audited text exactly, rejecting all restores the source exactly, and mixed choices preserve surrounding whitespace. Insertions/deletions no longer shift later source matches. Ambiguous structural changes are reviewed as grouped passages. Saved review choices survive reload.
- **Accurate status:** incomplete, malformed, or unaudited results cannot display the completed-audit success message. Audit copy describes consistency with the source and requires human review.
- **Browser state and privacy:** starting a new draft or navigating between jobs prevents stale pipeline callbacks from replacing a newer selection. No-history results remain usable in memory without writing document text to local storage.
- **History and usage:** pagination exposes older records; totals include all records rather than a silent 100-item cutoff. Monthly charts use the same local calendar as totals. Corrupt records produce recovery instructions while preserving stored bytes; deletion failures are visible.
- **Usability:** mobile result tabs, long source identifiers/custom voices, multiline notes, and audit metadata wrap within the viewport. File validation, downloads, clipboard success/failure, navigation, cancellation, retention, and deletion flows are covered.
- **Provider failures:** bounded retries can reach fresh usable keys; permanent credential failures do not repeat indefinitely. Safe billing, timeout, malformed-output, and availability errors do not expose upstream bodies. Usage records the actual successful model and assigns zero estimated model cost to requested free routes.

## Results

| Check | Result |
| --- | --- |
| `npm run check` | ESLint, 128 unit tests, and production build passed; no tests skipped |
| `npm run test:e2e` | 26 Chromium tests passed, with mocked provider responses |
| `npm audit --audit-level=moderate` | Zero vulnerabilities reported |
| Desktop/mobile route inspection | 24 local route/viewport combinations checked; no page errors or horizontal overflow |
| Real free-model server pipeline | Extraction, diagnosis, rewrite, assembly, audit, and finalization passed; no unresolved flags; zero estimated model cost |
| Real free-model browser pipeline | Same six stages passed through the real local API handlers; no page errors; source numbers retained; no-history storage remained empty |

The real-provider sample was a short two-paragraph document containing `42`, `2026`, and the uncertainty marker `may`. OpenRouter's catalog reported zero input/output pricing for the requested free route. This demonstrates connectivity and the workflow for that sample, not statistical writing accuracy or unlimited free-tier availability. Another free-router response returned invalid JSON and was correctly rejected; a specific free-model probe encountered unavailable capacity.

## Deployment checks still required

The cloud instance did not have production store credentials, and its environment settings are separate from Vercel. Before opening public traffic, verify Vercel's OpenRouter binding, free mode, selected Neon/Upstash configuration, and shared rate limits; then redeploy the pushed commit and run a real rewrite on the public URL. Production generation intentionally fails closed without usable durable limiting.

The cloud network draft includes the public app and font domains. Saving a draft does not apply it to the running environment or publish it. See the [deployment guide](../ai-humanizer/README.md#production-deployment).

## Live deployment follow-up · 28 October 2026

The public health endpoint returned HTTP 503:

```json
{"mode":"free","configured":false,"providerConfigured":true,"protectionConfigured":false,"providers":["openrouter"]}
```

A synthetic extraction request to the public `/api/run-stage` also returned HTTP 503 with `code: "rate_limit_unavailable"`. This confirms production request protection is missing or malformed in the deployment configuration. It does not indicate a missing model key or validate the configured OpenRouter credential.

Chromium reproduced the deployed banner with the rewrite button disabled and no page errors. The cloud proxy's certificate was not trusted by Chromium directly, so unchanged live resources were forwarded through Node's TLS-verified environment proxy; no application or API responses were mocked.

The editor previously described this permanent setup issue as temporarily unavailable and suggested waiting. It now distinguishes incomplete site setup from temporary connectivity failures. Regression tests cover both missing configuration flags, disabled generation without a stage request, and recovery after configuration changes while preserving the draft.

After this fix, `npm run check` passed lint, all 128 unit tests, and the production build. The full Chromium suite passed all 29 tests with no skips.

The deployment still needs a shared limiter configured in Vercel's Production environment, followed by redeployment. It can now use Neon or Upstash. This session has no Vercel settings access. See [the recovery steps](../ai-humanizer/README.md#rewriting-is-unavailable-after-deployment).

## Neon alternative · 28 October 2026

Neon Postgres is supported alongside Upstash. Set `RATE_LIMIT_STORE=neon`, supply a server-only `DATABASE_URL` (or `NEON_DATABASE_URL`), and run [the SQL migration](../ai-humanizer/db/neon-rate-limits.sql) once in the same database/branch and role. Neon stores hashed request counters only; document history stays in the browser. Both limits are checked and consumed within one PostgreSQL function call. Rejected requests do not consume allowance or create new empty client counters.

Automated tests exercise the actual Neon SDK with mocked HTTPS responses, plus the migration and limiter function on PGlite's embedded PostgreSQL engine. An integration test forwards the real guard/SDK's parameterized query into that engine and parses its response through the SDK. They cover repeatable migration, limits, expiration cleanup, invalid inputs, failed-update rollback, error privacy, and queued capacity requests. PGlite serializes its submissions; this is not a multi-connection Neon load test.

Validation after the Neon addition: lint, all 146 unit/integration tests, production build, and all 29 Chromium tests passed with no skips. The dependency audit reported zero vulnerabilities, and the browser build excludes the Neon server transport.

No live Neon connection string was injected into this environment during those checks, so hosted Neon connectivity and the production schema remain unverified. Run the migration and configure Vercel using the [Neon setup guide](../ai-humanizer/README.md#neon-postgres-setup), redeploy, then test a public rewrite.

## Neon CLI setup attempt · 28 October 2026

- Global `npm i -g neon@latest` failed because the runner's home install directory is unwritable. The requested `npx neon@latest` fallback installed and ran CLI 8.13.1.
- The default initializer's global plugin install hit the same home-directory limitation. A supported project-scoped retry installed the `neon` and `neon-postgres` agent skills and generated `neon.ts` with its dependencies.
- The directory is linked locally to the requested project/production branch, with `.neon` ignored. The CLI explicitly reported `Written offline (--no-checks): nothing was verified.` The Postgres-only policy leaves branch lifetime and compute settings unchanged.
- `neon deploy` and `neon login` failed with `Could not reach the Neon API`. Direct requests to management and OAuth endpoints received proxy CONNECT 403, including after a network escalation attempt. Required host additions and a secure `NEON_API_KEY` binding were saved in the cloud environment draft; the binding was still unfilled at the last check.
- The app already reads the CLI's pooled `DATABASE_URL`. A local ignored environment file sets only `RATE_LIMIT_STORE=neon` and `AI_PROVIDER_MODE=free`; no connection credential was invented or copied into source.

Validation completed: `npm run build` passed, `npm run check` passed lint, 146 tests, and build, the full Chromium suite passed 29 tests, and the dependency audit reported zero vulnerabilities. The app started; its root returned HTTP 200. Health returned HTTP 503 with `protectionStore: "neon"`, `providerConfigured: true`, and `protectionConfigured: false`. A synthetic stage request returned HTTP 503 `rate_limit_unavailable` without calling a model.

The new `npm run db:check` command correctly exited 1 with `neonUrlPresent: false`; it did not claim a working database. Deployment, environment download, schema application, real Neon access, and a real Neon-backed rewrite remain blocked pending network access and CLI authentication. No end-to-end Neon success is claimed. See [the CLI workflow](../ai-humanizer/README.md#neon-cli-workflow).

## Live configuration recheck · 28 October 2026

After the owner's Vercel environment updates, fresh public health requests returned HTTP503 with `mode: "free"`, `providerConfigured: true`, `protectionStore: "neon"`, and `protectionConfigured: false`. A public synthetic rewrite returned HTTP503 `rate_limit_unavailable`. Chromium reproduced the disabled editor banner with no page errors. These are current deployed responses, not mocked fixtures.

This combination isolates the active failure to a missing or rejected Neon connection value before any database query. It does not establish an invalid database password, missing SQL migration, or AI-provider failure. The supplied screenshots show variable names/scopes but hide their values, so the exact rejected value cannot be determined from them.

The existing validator rejected Neon's copied `psql 'postgresql://…'` clipboard form even when the enclosed URI was valid. The parser now accepts a simple psql wrapper, matching quotes, or a connection-variable assignment as data before applying the existing destination/TLS checks. It never executes pasted command text and rejects extra flags/commands. Health now reports a secret-free `protectionIssue` and a sanitized deployed Git revision. SQL schema/authentication/permission failures have separate safe stage codes to make subsequent setup failures identifiable.

Deployment adjustments: use the full raw PostgreSQL URI in Vercel's `DATABASE_URL`, keep `RATE_LIMIT_STORE=neon` and `AI_PROVIDER_MODE=free`, check for an outdated higher-priority `NEON_DATABASE_URL`, and redeploy after saving. Run the supplied SQL migration in the same database/branch before testing a real rewrite. See [the troubleshooting guide](../ai-humanizer/README.md#rewriting-is-unavailable-after-deployment).

After these fixes, lint, all 153 unit/integration tests, the production build, and all 29 Chromium tests passed. The current live deployment still needs to serve the new revision before its new diagnostics and normalization can be evaluated remotely.
