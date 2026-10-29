# Real rewrite evaluation · 29 October 2026

The production application did **not** pass the full sample test. The test suite is reproducible and fails visibly when the provider does not produce a complete, audited result. No AI-detector score or human-authorship claim is made.

Subsequent timeout update: the runs below used the earlier time limits. Current defaults allow 240 seconds per model attempt and 270 seconds total per stage; browser/API test transport waits 310 seconds. The manual full-pipeline test now allows 60 minutes. See the [current timeout settings](../ai-humanizer/README.md#provider-configuration). This change does not turn the recorded failures into passing live evaluations.

## Sample and acceptance checks

The [187-word synthetic sample](../ai-humanizer/evaluation/ai-style-sample.txt) describes a fictional pilot. It contains eleven deliberately formulaic expressions alongside nine exact source constraints: participant count, percentage, two dates, organisation, named speaker, verbatim quotation, citation, and reference URL. It also repeats uncertainty markers and numeric values.

The [manual browser test](../ai-humanizer/scripts/evaluate-live.js) uses real application and model responses. It checks free-only configuration; extraction, diagnosis, rewrite, assembly, independent audit and finalization; fewer measured stock phrases; preserved source constraints, numeric occurrences, and uncertainty; exact clipboard and `.txt`/`.md` exports; accept/reject controls; temporary-history behavior; and a 375-pixel mobile viewport. A missing audit, unresolved finding, incomplete check, or unavailable clipboard verification prevents a full pass. Empty output is never treated as successful editing.

## Observed real-provider runs

| Target and run | Result |
| --- | --- |
| Public deployment, short two-paragraph control after the Neon migration | Extraction, diagnosis, rewrite and assembly returned HTTP 200; audit returned HTTP 502 `invalid_schema`. No final result was accepted. |
| Public deployment, 187-word sample | Extraction returned HTTP 504 `timeout`. No rewrite was produced. |
| Local updated code, initial bounded structured retry | Extraction failed closed with HTTP 502 `invalid_extraction`. No rewrite was produced. |
| Local explicit `google/gemma-4-31b-it:free` comparison | Four provider attempts returned HTTP 429; application returned HTTP 503 `upstream_unavailable`. This route was not selected as a new default. |
| Local default free router with precise validation feedback | Extraction recovered and returned HTTP 200. Diagnosis returned HTTP 502 `truncated_response`; two completed model responses consumed all 3,000 completion tokens on reasoning without usable diagnosis JSON. |
| Local default free router with diagnosis reasoning mitigation | Extraction returned HTTP 200. Diagnosis exhausted its shared budget and returned HTTP 502 `invalid_json`; the attempted responses included non-JSON output, reasoning truncation, and timeouts. No rewrite was produced. |

One local attempt was interrupted by a development-server reload while code was changing. It was excluded from provider-quality conclusions. Runs listed above are retained as failures; the report does not select only successful provider responses.

The [public sample record](evaluation/public-run.json) and [final local record](evaluation/local-final-run.json) preserve the actual sanitized health/stage trace, check statuses, and fixture measurements. No final output existed in either run, so phrase reduction and factual preservation remain **unmeasured**. Dictionary matches in empty output are not evidence of editing quality. Review/export/mobile checks that required a generated result were **not run** in those real-model attempts; their mocked browser regressions passed separately.

The public record predates a correction to the evaluator's `styleImproved` flag for empty output. Its overall `pass` was already false; the current evaluator also makes that individual flag false and has explicit empty/whitespace regression checks. The preserved public record's old flag is not accepted as a quality result.

The public browser used TLS-verified Node forwarding because Chromium does not trust this environment's proxy certificate. HTTPS responses were forwarded unchanged; TLS verification stayed enabled and no application/model responses were mocked. Local browser checks used Chromium against real Node API handlers, with server-side model traffic using the environment proxy.

The successful public stage calls after the owner's SQL migration exercised production request protection. Current public health also reports free mode, configured provider/protection, and `protectionStore: "neon"`. Health alone does not establish database connectivity; the real stage calls provide that additional evidence. Local development runs used their supported in-memory counter store because this cloud instance has no injected Neon connection binding. They are not hosted-Neon integration tests.

## Changes made from the failures

- Structured-output validation now runs inside the existing four-attempt/120-second request budget. Retries regenerate invalid JSON, schemas, source spans, and incomplete audit coverage; validation rules remain strict.
- Server-only retry hints name allowlisted schema fields or source-span locations without echoing rejected values or provider output. They never enter public errors or serialized responses. Audit feedback requires complete coverage without forcing preserved findings.
- Completed responses rejected by validation contribute to reported token usage. Permanent credential rejections remain excluded during transient retries.
- Extraction and audit prompts clarify repeated occurrences and reserve `added`/null source IDs for genuinely new facts.
- Only OpenRouter's short diagnosis stage requests `reasoning: { effort: "minimal" }`. [OpenRouter documents](https://openrouter.ai/docs/guides/best-practices/reasoning-tokens#reasoning-tokens-and-max_tokens) that reasoning shares the output allowance and can leave no visible response. Minimal effort is a mitigation; routed models can ignore unsupported parameters or still exhaust capacity. Extraction and audit reasoning, output allowances, deadlines, and validators remain unchanged.

## Automated verification

Final code checks:

```text
npm run check
  ESLint passed
  tests 176
  pass 176
  fail 0
  production build passed

npm run test:e2e
  29 passed
```

The automated browser suite uses mocked provider responses. It verifies application behavior and failure handling, not live writing quality. The regression suite includes meaningful mutations of quantities, dates, quotations, URLs, uncertainty, and numeric additions, plus transport retries, strict validation, deadline accounting, safe feedback, provider isolation, and limiter behavior.

## Reproduce

From `ai-humanizer/`, with Chromium installed:

```bash
npm run check
npm run test:e2e
npm run evaluate:live
```

Run checks sequentially: the browser runner recreates its artifact directory, which can race a concurrent recursive ESLint scan. For this cloud environment's verified HTTPS transport:

```bash
NODE_USE_ENV_PROXY=1 npm run evaluate:live -- --node-transport
```

See the [evaluation guide](../ai-humanizer/evaluation/README.md) for local targets and report directories. Reports contain the actual synthetic input/output, stage trace, exact constraint checks, screenshots, audit and model metadata. A failed run exits nonzero. Do not substitute the evaluator's static expected fixture for live generated output.

## Production follow-up

Code commits `e6ac16f` (evaluation and strict retries) and `46c3670` (diagnosis reasoning mitigation) were pushed to `main`. The latest observed public `deploymentRevision` remained `e7d80bfda3ae` after the first fix was pushed. Eight fresh checks over approximately two minutes did not observe the new revision. A repository push is not proof of a Vercel deployment. Deploy the latest `main` from this repository with Vercel project root `ai-humanizer`, retain free-only routing and the working Neon settings, and repeat the manual test against the public URL. This session has no Vercel deployment/settings access.

Free-provider rate limits, capacity, and returned output quality are separate from database setup. A working Neon connection does not resolve those upstream failures. Check OpenRouter's free-account quota and current model availability. If choosing an explicit `OPENROUTER_FREE_MODEL`, use a currently available general text-generation model ending in `:free` and rerun the entire evaluation; a catalog listing or tiny probe is insufficient. The explicit Gemma comparison in this session was rate limited, so it is not a verified alternative. No paid fallback was enabled.

The sample has not established reliable phrase removal or complete factual preservation because no final audited output exists. Even a passing sample cannot prove semantic equivalence, statistical accuracy, human authorship, or AI-detector performance; review the actual text and audit before use.
