# Release verification · 28 October 2026

This report records checks against the repository in the cloud development environment. Public-site navigation to `https://ai-humanizer-pearl.vercel.app/` was blocked by the environment proxy, so these results do not establish the state of the deployed application.

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

The cloud instance did not have production Redis credentials, and its environment settings are separate from Vercel. Before opening public traffic, verify Vercel's OpenRouter binding, free mode, dedicated Upstash URL/token, and shared rate limits; then redeploy the pushed commit and run a real rewrite on the public URL. Production generation intentionally fails closed without usable durable limiting.

The cloud network draft includes the public app and font domains. Saving the draft does not apply it to the running environment or publish it. Live-site inspection can resume after those network settings are applied. See the [deployment guide](../ai-humanizer/README.md#production-deployment).
