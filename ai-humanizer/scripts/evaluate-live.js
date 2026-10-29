import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium, expect } from '@playwright/test';
import { AI_STYLE_SAMPLE } from '../evaluation/sample.js';
import { evaluateRewrite } from '../evaluation/evaluate.js';
import { API_REQUEST_TIMEOUT_MS } from '../shared/timeouts.js';

const MAX_EVALUATION_TIMEOUT_MS = 3600000;

const help = `Usage: node scripts/evaluate-live.js [options]
  --origin URL         App origin (default https://ai-humanizer-pearl.vercel.app)
  --report-dir PATH    Artifact directory (default evaluation-results/<run-id>)
  --node-transport     Forward unchanged HTTPS resources through TLS-verified Node fetch
  --timeout-ms NUMBER  Overall pipeline wait, at most ${MAX_EVALUATION_TIMEOUT_MS} ms (default ${MAX_EVALUATION_TIMEOUT_MS})
  --help               Show this help without browser or model requests

This manual test uses real app/API/model requests with a synthetic fixture.
It requires free-only mode and never mocks AI responses or disables TLS checks.
`;

function options(argv) {
  const result = { origin: 'https://ai-humanizer-pearl.vercel.app', timeout: MAX_EVALUATION_TIMEOUT_MS, nodeTransport: false };
  for (let index = 0; index < argv.length; index++) {
    const argument = argv[index];
    if (argument === '--help' || argument === '-h') return { help: true };
    if (argument === '--node-transport') { result.nodeTransport = true; continue; }
    if (!['--origin', '--report-dir', '--timeout-ms'].includes(argument) || !argv[index + 1]) throw new Error('Invalid runner arguments; use --help');
    const value = argv[++index];
    if (argument === '--origin') result.origin = value;
    if (argument === '--report-dir') result.reportDir = value;
    if (argument === '--timeout-ms') result.timeout = Number(value);
  }
  const url = new URL(result.origin);
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (url.username || url.password || url.search || url.hash || url.pathname !== '/' || (url.protocol !== 'https:' && !(local && url.protocol === 'http:'))) throw new Error('Use an HTTPS app origin or local HTTP origin without credentials, paths, or queries');
  if (!Number.isSafeInteger(result.timeout) || result.timeout < 1000 || result.timeout > MAX_EVALUATION_TIMEOUT_MS) throw new Error(`Pipeline timeout must be between 1000 and ${MAX_EVALUATION_TIMEOUT_MS} ms`);
  result.origin = url.origin;
  result.scope = local ? 'local-development' : 'public-deployment';
  result.reportDir = path.resolve(result.reportDir || `evaluation-results/${new Date().toISOString().replace(/[:.]/g, '-')}`);
  return result;
}

function safeText(value) {
  return String(value ?? '')
    .replace(/\b(?:sk-or-v1-[a-f\d]{24,}|AIza[A-Za-z\d_-]{25,}|AQ\.[A-Za-z\d_-]{30,}|cfut_[A-Za-z\d_-]{24,}|npg_[A-Za-z\d]{10,})/gi, '[REDACTED]')
    .replace(/postgres(?:ql)?:\/\/[^\s"'`]+/gi, '[REDACTED_CONNECTION]');
}
const safeCode = (value) => typeof value === 'string' && /^[a-z][a-z\d_]{0,80}$/.test(value) ? value : undefined;
const skipped = () => ({ status: 'not-run' });

async function forwardVerifiedResources(page, origin, failures) {
  await page.route('**/*', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (!['http:', 'https:'].includes(url.protocol)) return route.continue();
    if (url.protocol === 'http:' && url.origin === origin) return route.continue();
    if (url.protocol !== 'https:' || (url.origin !== origin && !['fonts.googleapis.com', 'fonts.gstatic.com'].includes(url.hostname))) return route.abort();
    try {
      const response = await fetch(request.url(), {
        method: request.method(), headers: await request.allHeaders(),
        body: request.postDataBuffer() || undefined, redirect: 'error', signal: AbortSignal.timeout(API_REQUEST_TIMEOUT_MS),
      });
      const headers = Object.fromEntries(response.headers);
      delete headers['content-encoding'];
      delete headers['content-length'];
      delete headers['transfer-encoding'];
      await route.fulfill({ status: response.status, headers, body: Buffer.from(await response.arrayBuffer()) });
    } catch {
      failures.push({ path: url.pathname, error: 'Verified resource transport failed' });
      await route.abort();
    }
  });
}

async function run(config) {
  await mkdir(config.reportDir, { recursive: true });
  const report = {
    startedAt: new Date().toISOString(), origin: config.origin, scope: config.scope,
    transport: config.nodeTransport ? 'TLS-verified Node forwarding of unchanged resources' : 'Chromium network transport',
    sampleId: AI_STYLE_SAMPLE.id, completed: false, pass: false, verificationComplete: false,
    health: [], stages: [], pageErrors: [], transportFailures: [],
    checks: { prerequisites: skipped(), pipeline: skipped(), renderedText: skipped(), download: skipped(), markdownDownload: skipped(), clipboard: skipped(), rejectAll: skipped(), acceptAll: skipped(), noHistory: skipped(), mobile: skipped() },
  };
  let browser;
  let page;
  let finalText = '';
  let job = { source_text: AI_STYLE_SAMPLE.source };
  const pending = new Set();
  const record = (promise) => { pending.add(promise); void promise.then(() => pending.delete(promise), () => pending.delete(promise)); };
  try {
    const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || (existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined);
    browser = await chromium.launch({ executablePath });
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
    let clipboardPermission = false;
    try { await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: config.origin }); clipboardPermission = true; } catch { /* Browser support is reported separately below. */ }
    page = await context.newPage();
    page.setDefaultTimeout(15000);
    page.on('pageerror', error => report.pageErrors.push(safeText(error.message).slice(0, 1000)));
    page.on('response', response => {
      const pathname = new URL(response.url()).pathname;
      if (!['/api/health', '/api/run-stage'].includes(pathname)) return;
      record((async () => {
        try {
          const data = await response.json();
          if (pathname === '/api/health') {
            report.health.push({ status: response.status(), mode: data.mode, configured: data.configured, providerConfigured: data.providerConfigured, protectionConfigured: data.protectionConfigured, protectionStore: data.protectionStore, protectionIssue: safeCode(data.protectionIssue), deploymentRevision: typeof data.deploymentRevision === 'string' && /^[a-f\d]{7,40}$/i.test(data.deploymentRevision) ? data.deploymentRevision : undefined });
          } else {
            const request = response.request().postDataJSON();
            const item = { stage: safeCode(request?.stage), status: response.status(), code: safeCode(data.code), flagCount: data.flag_count, hasProblems: data.has_problems };
            report.stages.push(item);
            console.log(JSON.stringify({ event: 'stage', ...item }));
            if (data.patch && typeof data.patch === 'object') job = { ...job, ...data.patch };
          }
        } catch { report.transportFailures.push({ path: pathname, error: 'Unreadable API response' }); }
      })());
    });
    if (config.nodeTransport) await forwardVerifiedResources(page, config.origin, report.transportFailures);
    await page.goto(`${config.origin}/editor`, { waitUntil: 'networkidle', timeout: 45000 });
    await page.evaluate(() => localStorage.setItem('humanizer_settings', JSON.stringify([{ id: 'synthetic-evaluation-settings', retention_days: 0 }])));
    await page.reload({ waitUntil: 'networkidle', timeout: 45000 });
    await Promise.allSettled([...pending]);
    const health = report.health.at(-1);
    const ready = health?.status === 200 && health.configured === true && health.mode === 'free'
      && (config.scope === 'local-development' || health.protectionStore === 'neon');
    report.checks.prerequisites = { status: ready ? 'passed' : 'failed', freeOnly: health?.mode === 'free', configured: health?.configured === true, store: health?.protectionStore ?? null };
    if (!ready) { report.failure = 'The target is not configured for the required free-only evaluation'; return report; }
    await expect(page.locator('main')).toContainText('Not saved: this rewrite is kept only while this page is open.');
    await page.getByRole('textbox', { name: 'Your document' }).fill(AI_STYLE_SAMPLE.source);
    const start = page.getByRole('button', { name: 'Rewrite this document', exact: true });
    await expect(start).toBeEnabled();
    await page.screenshot({ path: path.join(config.reportDir, 'source-desktop.png'), fullPage: true });
    await start.click();
    await page.waitForFunction(() => document.querySelector('[role="tab"]') || document.querySelector('main .text-destructive')?.textContent, {}, { timeout: config.timeout });
    await Promise.allSettled([...pending]);
    report.completed = await page.getByRole('tab', { name: 'Claim audit', exact: true }).count() > 0;
    const flags = Array.isArray(job.unresolved_flags) ? job.unresolved_flags : [];
    const audited = report.completed && job.status === 'completed' && !!job.audit && flags.length === 0
      && report.stages.some(stage => stage.stage === 'audit' && stage.status === 200)
      && report.stages.some(stage => stage.stage === 'finalize' && stage.status === 200);
    report.checks.pipeline = { status: audited ? 'passed' : 'failed', jobStatus: job.status ?? null, auditPresent: !!job.audit, unresolvedFlagCount: flags.length };
    if (!report.completed) {
      report.failure = safeText(await page.locator('main .text-destructive').first().textContent()).slice(0, 1500);
      return report;
    }
    await page.getByRole('tab', { name: 'Clean result', exact: true }).click();
    const article = page.getByRole('tabpanel').locator('article');
    finalText = await article.textContent() || '';
    report.checks.renderedText = { status: finalText && finalText === job.final_text && finalText !== AI_STYLE_SAMPLE.source ? 'passed' : 'failed', nonempty: !!finalText.trim(), changed: finalText !== AI_STYLE_SAMPLE.source, matchesFinalState: finalText === job.final_text };
    await page.screenshot({ path: path.join(config.reportDir, 'result-desktop.png'), fullPage: true });
    for (const [extension, name] of [['.txt', 'download'], ['.md', 'markdownDownload']]) {
      try {
        const event = page.waitForEvent('download');
        await page.getByRole('button', { name: extension, exact: true }).click();
        const download = await event;
        const file = await download.path();
        const exported = file ? await readFile(file, 'utf8') : null;
        report.checks[name] = { status: exported === finalText ? 'passed' : 'failed', exactUtf8Match: exported === finalText };
      } catch { report.checks[name] = { status: 'failed', error: `${extension} download could not be verified` }; }
    }
    if (clipboardPermission) {
      try {
        await page.getByRole('button', { name: 'Copy', exact: true }).click();
        await expect(page.getByRole('button', { name: 'Copied', exact: true })).toBeVisible({ timeout: 5000 });
        const copied = await page.evaluate(() => navigator.clipboard.readText());
        report.checks.clipboard = { status: copied === finalText ? 'passed' : 'failed', exactMatch: copied === finalText };
      } catch { report.checks.clipboard = { status: 'unverified', reason: 'The browser environment did not permit clipboard write/read verification' }; }
    } else report.checks.clipboard = { status: 'unverified', reason: 'Clipboard permissions are unavailable in this browser environment' };
    for (const [button, expectedText, name] of [['Reject all', AI_STYLE_SAMPLE.source, 'rejectAll'], ['Accept all', finalText, 'acceptAll']]) {
      try {
        await page.getByRole('tab', { name: 'Tracked changes', exact: true }).click();
        await page.getByRole('button', { name: button, exact: true }).click();
        await page.getByRole('tab', { name: 'Clean result', exact: true }).click();
        await expect.poll(() => page.getByRole('tabpanel').locator('article').textContent(), { timeout: 10000 }).toBe(expectedText);
        report.checks[name] = { status: 'passed', exactTextMatch: true };
      } catch { report.checks[name] = { status: 'failed', error: 'Review choice did not restore the expected exact text' }; }
    }
    const noHistory = await page.evaluate(() => !localStorage.getItem('humanizer_jobs') || JSON.parse(localStorage.getItem('humanizer_jobs')).length === 0);
    report.checks.noHistory = { status: noHistory ? 'passed' : 'failed', savedRewriteCount: noHistory ? 0 : null };
    await page.getByRole('tab', { name: 'Claim audit', exact: true }).click();
    report.audit = { summary: safeText(job.audit?.summary), items: job.audit?.items ?? [], certainty: job.audit?.certainty ?? [], formatViolations: job.audit?.format_violations ?? [], unresolvedFlags: flags };
    await page.screenshot({ path: path.join(config.reportDir, 'audit-desktop.png'), fullPage: true });
    await page.setViewportSize({ width: 375, height: 812 });
    const width = await page.evaluate(() => document.documentElement.scrollWidth);
    report.checks.mobile = { status: width <= 375 ? 'passed' : 'failed', viewportWidth: 375, documentWidth: width };
    await page.screenshot({ path: path.join(config.reportDir, 'result-mobile.png'), fullPage: true });
    return report;
  } catch (error) {
    report.failure = `Browser evaluation did not finish: ${safeText(error.message).slice(0, 1500)}`;
    return report;
  } finally {
    await Promise.allSettled([...pending]);
    finalText ||= typeof job.final_text === 'string' ? job.final_text : typeof job.rewritten_text === 'string' ? job.rewritten_text : '';
    report.draftOnly = !report.completed;
    report.metrics = evaluateRewrite(finalText);
    report.job = { status: job.status ?? null, provider: job.provider ?? null, modelFast: job.model_fast ?? null, modelQuality: job.model_quality ?? null, inputTokens: job.input_tokens ?? 0, outputTokens: job.output_tokens ?? 0, estimatedModelCost: job.cost_estimate ?? null, repairLoops: job.repair_loops ?? 0 };
    const required = Object.entries(report.checks).filter(([name]) => name !== 'clipboard');
    report.applicationPass = report.metrics.pass && required.every(([, check]) => check.status === 'passed') && report.pageErrors.length === 0 && report.transportFailures.length === 0;
    report.verificationComplete = Object.values(report.checks).every(check => check.status === 'passed');
    report.pass = report.applicationPass && report.verificationComplete;
    report.outcome = report.pass ? 'passed' : report.applicationPass ? 'incomplete' : 'failed';
    report.finishedAt = new Date().toISOString();
    if (page) try { await page.screenshot({ path: path.join(config.reportDir, 'final-state.png'), fullPage: true }); } catch { /* Page may have closed after a transport failure. */ }
    if (browser) await browser.close();
    await writeFile(path.join(config.reportDir, 'source.txt'), AI_STYLE_SAMPLE.source, 'utf8');
    await writeFile(path.join(config.reportDir, 'result.txt'), safeText(finalText), 'utf8');
    await writeFile(path.join(config.reportDir, 'report.json'), JSON.stringify(report, (_key, value) => typeof value === 'string' ? safeText(value) : value, 2) + '\n', 'utf8');
    await writeFile(path.join(config.reportDir, 'report.md'), markdown(report), 'utf8');
    console.log(JSON.stringify({ event: 'summary', outcome: report.outcome, pass: report.pass, verificationComplete: report.verificationComplete, scope: report.scope, completed: report.completed, stageCount: report.stages.length, stockPhrasesBefore: report.metrics.styleCounts.before, stockPhrasesAfter: report.metrics.hasText ? report.metrics.styleCounts.after : null, factsPreserved: report.metrics.factsPreserved, failedChecks: Object.entries(report.checks).filter(([, check]) => check.status === 'failed').map(([name]) => name), reportDir: config.reportDir }));
  }
}

function markdown(report) {
  const rows = Object.entries(report.checks).map(([name, check]) => `| ${name} | ${check.status} |`).join('\n');
  const stages = report.stages.map(stage => `| ${stage.stage} | ${stage.status} | ${stage.code || ''} |`).join('\n');
  const facts = report.metrics.checks.map(check => `| ${check.label} | ${check.preserved ? 'passed' : 'failed'} |`).join('\n');
  const uncertainty = report.metrics.uncertainty.map(check => `| ${check.marker} | ${check.before} | ${check.after} | ${check.preserved ? 'passed' : 'failed'} |`).join('\n');
  const editing = report.metrics.hasText
    ? `Measured stock-phrase occurrences: ${report.metrics.styleCounts.before} → ${report.metrics.styleCounts.after}. Word counts: ${report.metrics.wordCounts.before} → ${report.metrics.wordCounts.after}. Source constraints passed: ${report.metrics.factsPreserved}. Result is ${report.draftOnly ? 'an unaudited draft from an incomplete pipeline' : 'the generated final result; inspect audit findings before use'}.`
    : 'No rewrite was produced. Style improvement and factual preservation could not be evaluated; zero dictionary matches in an empty result are not a successful reduction.';
  return `# Synthetic live rewrite evaluation\n\nOutcome: **${report.outcome}**. Scope: ${report.scope}. Origin: ${report.origin}.\n\nTransport: ${report.transport}. No AI responses were mocked.\n\n${report.failure ? `Failure: ${safeText(report.failure)}\n\n` : ''}## Workflow checks\n\n| Check | Result |\n| --- | --- |\n${rows}\n\n## Real API stages\n\n| Stage | HTTP status | Error code |\n| --- | --- | --- |\n${stages}\n\n## Editing measurements\n\n${editing}\n\n| Source constraint | Result |\n| --- | --- |\n${facts}\n\n| Uncertainty marker | Before | After | Coverage |\n| --- | --- | --- | --- |\n${uncertainty}\n\n${report.metrics.limitations}\n\n[Detailed report](report.json) · [Synthetic source](source.txt) · [Actual result](result.txt) · [Final screenshot](final-state.png)\n`;
}

let config;
try { config = options(process.argv.slice(2)); } catch { console.error('Invalid evaluation arguments; use --help'); process.exitCode = 1; }
if (config?.help) console.log(help);
else if (config) {
  try { const report = await run(config); if (!report.pass) process.exitCode = 1; }
  catch { console.error('Evaluation artifacts could not be completed'); process.exitCode = 1; }
}
