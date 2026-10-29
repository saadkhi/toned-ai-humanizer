# Rewrite evaluation fixture

[ai-style-sample.txt](ai-style-sample.txt) is a 187-word machine-written sample about a fictional pilot. Its three paragraphs deliberately include eleven measured stock-phrase occurrences alongside dates, quantities, names, an exact quotation, a citation, a reference URL, and uncertainty markers.

`sample.js` exports `AI_STYLE_SAMPLE`. `evaluate.js` exports `evaluateRewrite(rewritten, sample = AI_STYLE_SAMPLE)` for live runners and regression tests. The evaluator reports:

- Stock-phrase occurrences before/after, including common inflections of leverage, delve, robust, and seamless.
- Exact required quantities, dates, entities, quotation text, citation, and URL coverage.
- Source uncertainty-marker occurrence coverage, so retaining a quotation alone cannot hide the loss of another `preliminary` occurrence.
- Added and omitted numeric-token occurrences, plus input/output word counts.

The fixture check passes only when output is nonempty, measured stock phrasing decreases, and all these source constraints pass. Full application success also requires a completed independent audit, no unresolved findings, working review/export flows, and human review; the fixture evaluator does not decide those workflow conditions.

These are conservative surface checks. They cannot prove semantic equivalence, detect every changed claim, identify whether an author is human, or establish an AI-detector score. Reordering the same numeric tokens could change meaning while preserving the numeric multiset. An evaluation across one synthetic sample is not a statistical writing-quality or factual-accuracy benchmark.

The smoother text in `tests/evaluation.test.js` is a static expected fixture for testing the evaluator. It is not presented as live model output. Automated tests make no model requests.

## Real application test

```bash
npm run evaluate:live
# Or test a running local development server:
npm run evaluate:live -- --origin http://127.0.0.1:5173
```

The manual Playwright runner submits this sample through the real editor and API. It checks free-only configuration, every pipeline stage through audit/finalization, the evaluator's source constraints, exact text download and clipboard contents, accept/reject controls, temporary-history behavior, and a 375-pixel mobile viewport. Public targets must use Neon protection; local development may use its normal in-memory limiter. It never mocks model responses. Each run writes input, output, screenshots, and detailed JSON/Markdown reports to ignored `evaluation-results/`; use `--report-dir PATH` to choose another location.

A failed check, incomplete audit, unresolved finding, or unavailable clipboard verification results in a nonzero exit. Review the actual text and audit as well as the report. A passing sample is evidence about that sample and deployment only.

In a cloud environment whose Chromium cannot use its proxy trust configuration, Node 24 can forward unchanged HTTPS resources while retaining certificate validation:

```bash
NODE_USE_ENV_PROXY=1 npm run evaluate:live -- --node-transport
```

The report records this transport. No provider response is replaced and no TLS verification is disabled. The test uses the selected free-only model route; provider quotas and production request limits still apply. Each API transport waits 310 seconds, matching the browser. The manual runner allows up to 60 minutes for the full pipeline, including sequential sections, retries, and repairs; use `--timeout-ms` for a shorter overall test deadline. This overall limit belongs to the manual test, not the editor's whole-document workflow.
