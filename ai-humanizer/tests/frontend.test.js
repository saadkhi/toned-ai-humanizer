import test from 'node:test';
import assert from 'node:assert/strict';
import { requestJson } from '../src/lib/request.js';
import { jobStore } from '../src/lib/jobStore.js';
import { formatAuditFlag } from '../src/lib/audit.js';
import { createJob, runPipeline } from '../src/lib/humanize.js';

function setupStorage(t) {
  const previous = globalThis.localStorage;
  const values = new Map();
  globalThis.localStorage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  };
  t.after(() => { globalThis.localStorage = previous; });
  return values;
}

test('structured unresolved flags become readable text instead of invalid React children', () => {
  assert.equal(formatAuditFlag({ kind: 'number', value: '2026', status: 'missing', note: 'Not found' }), 'number · 2026 · missing · Not found');
  assert.equal(formatAuditFlag('Check the source'), 'Check the source');
  assert.match(formatAuditFlag(null), /Review/);
});

test('temporary rewrites never enter browser storage or history', async (t) => {
  const values = setupStorage(t);
  const job = await jobStore.RewriteJob.create({ source_text: 'Private sample', retention_days: 0 });
  await jobStore.RewriteJob.update(job.id, { final_text: 'Private result' });
  assert.equal((await jobStore.RewriteJob.get(job.id)).final_text, 'Private result');
  assert.equal((await jobStore.RewriteJob.list()).length, 0);
  assert.equal(values.size, 0);
  await jobStore.RewriteJob.delete(job.id);
  await assert.rejects(jobStore.RewriteJob.get(job.id), /no longer available/);
});

test('expired local history is purged before reading, not only on the history screen', async (t) => {
  const values = setupStorage(t);
  values.set('humanizer_jobs', JSON.stringify([
    { id: 'old', source_text: 'expired', expires_at: '2020-01-01T00:00:00Z' },
    { id: 'new', source_text: 'retained', expires_at: '2099-01-01T00:00:00Z' },
  ]));
  await assert.rejects(jobStore.RewriteJob.get('old'), /expired/);
  assert.deepEqual((await jobStore.RewriteJob.list()).map((job) => job.id), ['new']);
  assert.equal(JSON.parse(values.get('humanizer_jobs')).length, 1);
});

test('storage errors fail clearly without silently overwriting damaged history', async (t) => {
  const values = setupStorage(t);
  values.set('humanizer_jobs', '{broken');
  await assert.rejects(jobStore.RewriteJob.create({ source_text: 'sample', retention_days: 30 }), /could not be read/);
  assert.equal(values.get('humanizer_jobs'), '{broken');
});

test('health configuration can be read from a 503 but stage requests surface safe errors', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => Response.json({ configured: false }, { status: 503 }));
  assert.equal((await requestJson('/api/health', { allowUnavailable: true })).configured, false);
  t.mock.method(globalThis, 'fetch', async () => Response.json({ error: 'Rewriting is not configured.' }, { status: 503 }));
  await assert.rejects(requestJson('/api/run-stage'), /not configured/);
});

test('requests reject unreadable responses and bounded waits', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => new Response('<html>gateway failure</html>'));
  await assert.rejects(requestJson('/api/run-stage'), /unreadable response/);
  t.mock.method(globalThis, 'fetch', (_url, { signal }) => new Promise((_resolve, reject) => {
    signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
  }));
  await assert.rejects(requestJson('/api/run-stage', { timeoutMs: 5 }), /took too long/);
});

test('cancelling a request stops the client wait with a readable message', async (t) => {
  const controller = new AbortController();
  t.mock.method(globalThis, 'fetch', (_url, { signal }) => new Promise((_resolve, reject) => {
    signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
  }));
  const waiting = requestJson('/api/run-stage', { signal: controller.signal });
  controller.abort();
  await assert.rejects(waiting, { name: 'AbortError', message: 'Rewrite stopped. Your original text is unchanged.' });
});

test('the browser can receive a stage response after the former browser timeout', async (t) => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 1000 });
  let signal;
  t.mock.method(globalThis, 'fetch', (_url, init) => new Promise((resolve, reject) => {
    signal = init.signal;
    const timer = setTimeout(() => resolve(Response.json({ stage: 'audit', patch: { progress: 85 } })), 300000);
    signal.addEventListener('abort', () => {
      clearTimeout(timer);
      reject(new DOMException('aborted', 'AbortError'));
    }, { once: true });
  }));
  const waiting = requestJson('/api/run-stage');
  t.mock.timers.tick(300000);
  assert.deepEqual(await waiting, { stage: 'audit', patch: { progress: 85 } });
  assert.equal(signal.aborted, false);
});

test('the client rewrites chunks in order, re-audits repairs, and persists final patches', async (t) => {
  setupStorage(t);
  const job = await createJob({
    text: 'A sample draft.', style: 'technical_writer', purpose: 'Editing', prefs: {}, retentionDays: 30,
  });
  const stages = [];
  let audits = 0;
  t.mock.method(globalThis, 'fetch', async (_url, options) => {
    const { stage, chunk_index, job: current } = JSON.parse(options.body);
    stages.push(stage === 'rewrite' ? `rewrite:${chunk_index}` : stage);
    if (stage === 'extract') return Response.json({ chunk_count: 2, patch: { chunks: ['a', 'b'] } });
    if (stage === 'audit') return Response.json({ has_problems: ++audits === 1, patch: { audit: { items: [] } } });
    if (stage === 'finalize') {
      assert.deepEqual(current.audit, { items: [] });
      return Response.json({ status: 'completed', patch: { final_text: 'An edited draft.', status: 'completed' } });
    }
    return Response.json({ patch: {} });
  });
  const result = await runPipeline(job.id);
  assert.deepEqual(stages, ['extract', 'diagnose', 'rewrite:0', 'rewrite:1', 'assemble', 'audit', 'repair', 'audit', 'finalize']);
  assert.equal(result.job.final_text, 'An edited draft.');
});
