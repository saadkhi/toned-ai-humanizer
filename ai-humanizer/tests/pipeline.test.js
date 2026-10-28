import test from 'node:test';
import assert from 'node:assert/strict';
import handler from '../api/run-stage.js';

const extraction = { claims: [{ text: 'The trial may include 42 participants.', paragraph: 0 }], numbers: [{ value: '42', paragraph: 0 }], named_entities: [], citations: [], quotations: [], hedge_markers: [{ text: 'may', paragraph: 0 }] };
const diagnosis = { purpose_guess: 'Report a trial.', audience_guess: 'Researchers.', patterns: [], ambiguous_sentences: [], plan: { register: 'Formal', target_sentence_length_distribution: 'Varied', transition_policy: 'Minimal', structural_changes: [] } };
const audit = { items: [{ source_id: 'claims:0', kind: 'claim', value: 'The trial may include 42 participants.', status: 'preserved', note: '' }, { source_id: 'numbers:0', kind: 'number', value: '42', status: 'preserved', note: '' }], certainty: [{ source_id: 'hedge_markers:0', marker: 'may', status: 'none', note: '' }], format_violations: [], summary: 'No differences found.' };
const source = 'The trial may include 42 participants.';
let ip = 0;
async function call(body, method = 'POST') {
  const res = { statusCode: 200, headers: {}, setHeader(k, v) { this.headers[k] = v; return this; }, status(status) { this.statusCode = status; return this; }, json(data) { this.body = data; return this; } };
  await handler({ method, body, headers: { host: 'localhost:5173' }, socket: { remoteAddress: `127.0.${Math.floor(ip / 250)}.${++ip % 250}` } }, res);
  return res;
}
function configure(t, results = []) {
  const originalFetch = globalThis.fetch;
  const names = Object.keys(process.env).filter((name) => /^(GOOGLE|OPENROUTER|SAMBANOVA|CLOUDFLARE)_API_KEY|^UPSTASH_REDIS_|^VERCEL$/.test(name));
  const previous = Object.fromEntries([...names, 'NODE_ENV', 'VERCEL_ENV', 'GOOGLE_API_KEY_1', 'OPENROUTER_API_KEY_1', 'AI_PROVIDER_MODE'].map((name) => [name, process.env[name]]));
  for (const name of names) delete process.env[name];
  process.env.GOOGLE_API_KEY_1 = 'synthetic-unit-test-key';
  process.env.NODE_ENV = 'test';
  process.env.AI_PROVIDER_MODE = 'configured';
  delete process.env.VERCEL_ENV;
  let calls = 0;
  globalThis.fetch = async () => {
    assert.ok(results.length, 'Unexpected upstream call');
    calls++;
    const data = results.shift();
    return new Response(JSON.stringify({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: typeof data === 'string' ? data : JSON.stringify(data) }] } }], usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 10 } }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  t.after(() => {
    globalThis.fetch = originalFetch;
    for (const [name, value] of Object.entries(previous)) { if (value === undefined) delete process.env[name]; else process.env[name] = value; }
  });
  return () => calls;
}
async function throughAssembly(t, rewritten = source) {
  const count = configure(t, [extraction, diagnosis, rewritten]);
  const job = { source_text: source };
  for (const stage of ['extract', 'diagnose', 'rewrite', 'assemble']) {
    const response = await call({ stage, job });
    assert.equal(response.statusCode, 200, JSON.stringify(response.body));
    Object.assign(job, response.body.patch);
  }
  return { job, count };
}

test('request parsing and method errors are actionable', async (t) => {
  configure(t);
  assert.equal((await call({}, 'GET')).statusCode, 405);
  assert.equal((await call('{')).statusCode, 400);
  assert.equal((await call({ stage: 'invented', job: { source_text: source } })).statusCode, 400);
  assert.equal((await call({ stage: 'extract', job: { source_text: source, input_tokens: -1 } })).statusCode, 400);
  assert.equal((await call({ stage: 'extract', job: { source_text: 'x'.repeat(20001) } })).statusCode, 413);
});

test('missing server keys return a service configuration error without calling upstream', async (t) => {
  const count = configure(t);
  delete process.env.GOOGLE_API_KEY_1;
  const response = await call({ stage: 'extract', job: { source_text: source } });
  assert.equal(response.statusCode, 503);
  assert.equal(response.body.code, 'provider_not_configured');
  assert.equal(count(), 0);
});

test('arbitrary JSON cannot masquerade as extracted facts', async (t) => {
  configure(t, [{}]);
  const response = await call({ stage: 'extract', job: { source_text: source } });
  assert.equal(response.statusCode, 502);
  assert.ok(!response.body.patch);
});

test('hallucinated extraction spans are rejected', async (t) => {
  configure(t, [{ ...extraction, numbers: [{ value: '1000', paragraph: 0 }] }]);
  const response = await call({ stage: 'extract', job: { source_text: source } });
  assert.equal(response.statusCode, 502);
});

test('cannot skip extraction or finalize an unaudited rewrite', async (t) => {
  configure(t);
  const response = await call({ stage: 'finalize', job: { source_text: source, rewritten_text: source } });
  assert.equal(response.statusCode, 409);
});

test('full sequential pipeline finishes only after a complete independent audit', async (t) => {
  configure(t, [extraction, diagnosis, source, audit]);
  const job = { source_text: source };
  for (const stage of ['extract', 'diagnose', 'rewrite', 'assemble', 'audit', 'finalize']) {
    const response = await call({ stage, job });
    assert.equal(response.statusCode, 200, JSON.stringify(response.body));
    Object.assign(job, response.body.patch);
  }
  assert.equal(job.status, 'completed');
  assert.equal(job.final_text, source);
  assert.ok(job.audit_fingerprint);
});

test('an incomplete model audit fails instead of giving a false clean result', async (t) => {
  configure(t, [extraction, diagnosis, source, { ...audit, items: [] }]);
  const job = { source_text: source };
  for (const stage of ['extract', 'diagnose', 'rewrite', 'assemble']) Object.assign(job, (await call({ stage, job })).body.patch);
  const response = await call({ stage: 'audit', job });
  assert.equal(response.statusCode, 502);
  assert.ok(!response.body.patch);
});

test('changed source invalidates cached stages', async (t) => {
  const { job } = await throughAssembly(t);
  job.source_text = 'The trial may include 43 participants.';
  const response = await call({ stage: 'diagnose', job });
  assert.equal(response.statusCode, 409);
});

test('partial section sets cannot be assembled', async (t) => {
  const { job } = await throughAssembly(t);
  job.chunks[0].text = '';
  const response = await call({ stage: 'assemble', job });
  assert.equal(response.statusCode, 409);
});

test('deterministic factual differences survive an overconfident model audit', async (t) => {
  configure(t, [extraction, diagnosis, 'The trial may include 420 participants.', audit]);
  const job = { source_text: source };
  for (const stage of ['extract', 'diagnose', 'rewrite', 'assemble', 'audit', 'finalize']) {
    const response = await call({ stage, job });
    assert.equal(response.statusCode, 200, JSON.stringify(response.body));
    Object.assign(job, response.body.patch);
  }
  assert.equal(job.status, 'needs_review');
  assert.ok(job.unresolved_flags.length > 0);
});

test('changing text after audit prevents stale finalization', async (t) => {
  configure(t, [extraction, diagnosis, source, audit]);
  const job = { source_text: source };
  for (const stage of ['extract', 'diagnose', 'rewrite', 'assemble', 'audit']) Object.assign(job, (await call({ stage, job })).body.patch);
  job.rewritten_text += ' Invented claim.';
  const response = await call({ stage: 'finalize', job });
  assert.equal(response.statusCode, 409);
});

test('repair invalidates audit and requires reauditing the repaired document', async (t) => {
  const badAudit = { ...audit, items: audit.items.map((item) => ({ ...item, status: 'altered' })) };
  configure(t, [extraction, diagnosis, 'The trial may include 420 participants.', badAudit, { text: source, fixes: [{ item: '42', action: 'Restored source number.' }] }]);
  const job = { source_text: source };
  for (const stage of ['extract', 'diagnose', 'rewrite', 'assemble', 'audit', 'repair']) {
    const response = await call({ stage, job });
    assert.equal(response.statusCode, 200, JSON.stringify(response.body));
    Object.assign(job, response.body.patch);
  }
  assert.equal(job.audit, null);
  assert.equal(job.repair_loops, 1);
  assert.equal((await call({ stage: 'finalize', job })).statusCode, 409);
});

test('new model-detected claims keep the result in needs_review', async (t) => {
  const addedAudit = { ...audit, items: [...audit.items, { source_id: null, kind: 'claim', value: 'The study is funded by a foundation.', status: 'added', note: 'Not present in original.' }] };
  configure(t, [extraction, diagnosis, `${source} The study is funded by a foundation.`, addedAudit]);
  const job = { source_text: source };
  for (const stage of ['extract', 'diagnose', 'rewrite', 'assemble', 'audit', 'finalize']) {
    const response = await call({ stage, job });
    assert.equal(response.statusCode, 200, JSON.stringify(response.body));
    Object.assign(job, response.body.patch);
  }
  assert.equal(job.status, 'needs_review');
  assert.ok(job.unresolved_flags.some((flag) => flag.status === 'added'));
});

test('uncertainty coverage is required even when every factual item is covered', async (t) => {
  configure(t, [extraction, diagnosis, source, { ...audit, certainty: [] }]);
  const job = { source_text: source };
  for (const stage of ['extract', 'diagnose', 'rewrite', 'assemble']) Object.assign(job, (await call({ stage, job })).body.patch);
  const response = await call({ stage: 'audit', job });
  assert.equal(response.statusCode, 502);
});

test('audit receives full original and rewritten text but never the rewrite plan', async (t) => {
  configure(t, [extraction, diagnosis, source]);
  const job = { source_text: source };
  for (const stage of ['extract', 'diagnose', 'rewrite', 'assemble']) Object.assign(job, (await call({ stage, job })).body.patch);
  globalThis.fetch = async (_url, request) => {
    const payload = JSON.parse(request.body);
    const prompt = payload.contents[0].parts[0].text;
    assert.ok(prompt.includes('FULL ORIGINAL:'));
    assert.ok(prompt.includes('REWRITTEN TEXT:'));
    assert.ok(!prompt.includes('target_sentence_length_distribution'));
    return new Response(JSON.stringify({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify(audit) }] } }] }), { status: 200 });
  };
  assert.equal((await call({ stage: 'audit', job })).statusCode, 200);
});

test('audit cannot collapse repeated uncertainty markers into a single occurrence', async (t) => {
  const repeatedSource = 'The trial may include 42 participants, and may expand.';
  const repeatedExtraction = { ...extraction, claims: [{ text: repeatedSource, paragraph: 0 }], hedge_markers: [{ text: 'may', paragraph: 0 }, { text: 'may', paragraph: 0 }] };
  const collapsedAudit = { ...audit, items: audit.items.map((item) => item.kind === 'claim' ? { ...item, value: repeatedSource } : item) };
  configure(t, [repeatedExtraction, diagnosis, repeatedSource, collapsedAudit]);
  const job = { source_text: repeatedSource };
  for (const stage of ['extract', 'diagnose', 'rewrite', 'assemble']) Object.assign(job, (await call({ stage, job })).body.patch);
  assert.equal(job.extraction.hedge_markers[0].source_id, 'hedge_markers:0');
  assert.equal(job.extraction.hedge_markers[1].source_id, 'hedge_markers:1');
  assert.equal((await call({ stage: 'audit', job })).statusCode, 502);
});

test('audit must cover repeated values in different source paragraphs', async (t) => {
  const repeatedSource = `${source}\n\n${source}`;
  const repeatedExtraction = { ...extraction, claims: [{ text: source, paragraph: 0 }, { text: source, paragraph: 1 }] };
  configure(t, [repeatedExtraction, diagnosis, repeatedSource, audit]);
  const job = { source_text: repeatedSource };
  for (const stage of ['extract', 'diagnose', 'rewrite', 'assemble']) Object.assign(job, (await call({ stage, job })).body.patch);
  assert.equal((await call({ stage: 'audit', job })).statusCode, 502);
});

test('mislocated extraction spans do not get accepted as valid paragraph evidence', async (t) => {
  configure(t, [{ ...extraction, numbers: [{ value: '42', paragraph: 10 }] }]);
  const response = await call({ stage: 'extract', job: { source_text: source } });
  assert.equal(response.statusCode, 502);
  assert.equal(response.body.code, 'invalid_extraction');
});

test('section rewrite receives only facts located in its own source section', async (t) => {
  const firstSection = Array(800).fill('context').join(' ');
  const multiSource = `${firstSection}\n\n${source}`;
  const laterFacts = Object.fromEntries(Object.entries(extraction).map(([key, values]) => [key, values.map((item) => ({ ...item, paragraph: 1 }))]));
  configure(t, [laterFacts, diagnosis]);
  const job = { source_text: multiSource };
  for (const stage of ['extract', 'diagnose']) {
    const response = await call({ stage, job });
    assert.equal(response.statusCode, 200, JSON.stringify(response.body));
    Object.assign(job, response.body.patch);
  }
  globalThis.fetch = async (_url, request) => {
    const prompt = JSON.parse(request.body).contents[0].parts[0].text;
    assert.ok(prompt.includes('Facts located in this section only:'));
    assert.ok(prompt.includes('"claims":[]'));
    assert.ok(!prompt.includes('42'));
    return new Response(JSON.stringify({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: firstSection }] } }] }), { status: 200 });
  };
  const first = await call({ stage: 'rewrite', chunk_index: 0, job });
  assert.equal(first.statusCode, 200, JSON.stringify(first.body));
  Object.assign(job, first.body.patch);
  globalThis.fetch = async (_url, request) => {
    const prompt = JSON.parse(request.body).contents[0].parts[0].text;
    assert.ok(prompt.includes('"source_id":"numbers:0"'));
    return new Response(JSON.stringify({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: source }] } }] }), { status: 200 });
  };
  assert.equal((await call({ stage: 'rewrite', chunk_index: 1, job })).statusCode, 200);
});

test('newly introduced certainty shifts can be flagged without a source hedge ID', async (t) => {
  const changedAudit = { ...audit, certainty: [...audit.certainty, { source_id: null, marker: 'probably', status: 'weakened', note: 'Added uncertainty.' }] };
  configure(t, [extraction, diagnosis, `${source} Probably.`, changedAudit]);
  const job = { source_text: source };
  for (const stage of ['extract', 'diagnose', 'rewrite', 'assemble', 'audit', 'finalize']) {
    const response = await call({ stage, job });
    assert.equal(response.statusCode, 200, JSON.stringify(response.body));
    Object.assign(job, response.body.patch);
  }
  assert.equal(job.status, 'needs_review');
  assert.ok(job.unresolved_flags.some((flag) => flag.kind === 'certainty' && flag.value === 'probably'));
});

test('valid extraction paragraph indices work for CRLF and whitespace-only blank lines', async (t) => {
  configure(t);
  for (const separator of ['\r\n\r\n', '\n \n', '\r\n\t\r\n']) {
    const document = `Introduction.${separator}${source}`;
    const facts = Object.fromEntries(Object.entries(extraction).map(([key, values]) => [key, values.map((item) => ({ ...item, paragraph: 1 }))]));
    globalThis.fetch = async (_url, request) => {
      const prompt = JSON.parse(request.body).contents[0].parts[0].text;
      assert.ok(prompt.includes('<paragraph index="1">'));
      return Response.json({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify(facts) }] } }] });
    };
    const response = await call({ stage: 'extract', job: { source_text: document } });
    assert.equal(response.statusCode, 200, JSON.stringify(response.body));
    assert.equal(response.body.patch.extraction.claims[0].source_start, document.indexOf(source));
  }
});

test('source indentation survives validation, provider generation, and assembly', async (t) => {
  const indented = '    The trial may include 42 participants.\r\n';
  configure(t, [extraction, diagnosis, source]);
  const job = { source_text: indented };
  for (const stage of ['extract', 'diagnose', 'rewrite', 'assemble']) {
    const response = await call({ stage, job });
    assert.equal(response.statusCode, 200, JSON.stringify(response.body));
    Object.assign(job, response.body.patch);
  }
  assert.equal(job.source_text, indented);
  assert.equal(job.rewritten_text, indented);
});

test('accepted Unicode documents are rewritten in bounded sections without inserting paragraph seams', async (t) => {
  const document = '这是一个测试段落。'.repeat(2000);
  configure(t, [{ claims: [], numbers: [], named_entities: [], citations: [], quotations: [], hedge_markers: [] }, diagnosis]);
  const job = { source_text: document };
  const extracted = await call({ stage: 'extract', job });
  assert.equal(extracted.statusCode, 200, JSON.stringify(extracted.body));
  Object.assign(job, extracted.body.patch);
  assert.ok(extracted.body.chunk_count > 1);
  Object.assign(job, (await call({ stage: 'diagnose', job })).body.patch);
  globalThis.fetch = async (_url, request) => {
    const prompt = JSON.parse(request.body).contents[0].parts[0].text;
    const text = prompt.match(/<text>\n([\s\S]*?)\n<\/text>$/)?.[1];
    assert.ok(text.length <= 4000);
    return Response.json({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text }] } }] });
  };
  for (let index = 0; index < extracted.body.chunk_count; index++) {
    const response = await call({ stage: 'rewrite', chunk_index: index, job });
    assert.equal(response.statusCode, 200, JSON.stringify(response.body));
    Object.assign(job, response.body.patch);
  }
  Object.assign(job, (await call({ stage: 'assemble', job })).body.patch);
  assert.equal(job.rewritten_text, document);
});

test('model metadata records the successful provider fallback instead of configured primary', async (t) => {
  const names = ['OPENROUTER_API_KEY_1', 'OPENROUTER_MODEL_FAST', 'LLM_MAX_ATTEMPTS'];
  const previous = Object.fromEntries(names.map((name) => [name, process.env[name]]));
  configure(t);
  t.after(() => { for (const [name, value] of Object.entries(previous)) { if (value === undefined) delete process.env[name]; else process.env[name] = value; } });
  process.env.OPENROUTER_API_KEY_1 = 'synthetic-fallback-metadata-key';
  process.env.OPENROUTER_MODEL_FAST = 'test/actual-fallback-model';
  process.env.LLM_MAX_ATTEMPTS = '2';
  globalThis.fetch = async (url) => {
    if (String(url).includes('generativelanguage.googleapis.com')) return new Response('', { status: 401 });
    assert.equal(String(url), 'https://openrouter.ai/api/v1/chat/completions');
    return Response.json({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(extraction) } }], usage: { prompt_tokens: 11, completion_tokens: 12 } });
  };
  const response = await call({ stage: 'extract', job: { source_text: source } });
  assert.equal(response.statusCode, 200, JSON.stringify(response.body));
  assert.equal(response.body.patch.model_fast, 'openrouter/test/actual-fallback-model');
  assert.equal(response.body.patch.provider_fast, 'openrouter');
  assert.equal(response.body.patch.provider, 'openrouter');
  assert.equal(response.body.patch.input_tokens, 11);
  assert.equal(response.body.patch.output_tokens, 12);
});

test('text rewriting persists the last successful quality model without losing fast metadata', async (t) => {
  const previous = process.env.GOOGLE_MODEL_QUALITY;
  t.after(() => { if (previous === undefined) delete process.env.GOOGLE_MODEL_QUALITY; else process.env.GOOGLE_MODEL_QUALITY = previous; });
  process.env.GOOGLE_MODEL_QUALITY = 'test-quality-response-model';
  const { job } = await throughAssembly(t);
  assert.ok(job.model_fast.startsWith('google/'));
  assert.equal(job.model_quality, 'google/test-quality-response-model');
  assert.equal(job.provider_quality, 'google');
  assert.equal(job.provider, 'google');
});

test('free-router JSON and prose stages keep cost zero while recording real usage and actual models', async (t) => {
  configure(t);
  process.env.AI_PROVIDER_MODE = 'free';
  process.env.OPENROUTER_API_KEY_1 = 'synthetic-free-route-only-key';
  const results = [extraction, diagnosis, source, audit];
  globalThis.fetch = async (url, request) => {
    assert.equal(String(url), 'https://openrouter.ai/api/v1/chat/completions');
    assert.equal(JSON.parse(request.body).model, 'openrouter/free');
    const result = results.shift();
    assert.ok(result, 'Unexpected free-route call');
    return Response.json({ model: 'test/selected-model:free', choices: [{ finish_reason: 'stop', message: { content: typeof result === 'string' ? result : JSON.stringify(result) } }], usage: { prompt_tokens: 100, completion_tokens: 200 } });
  };
  const job = { source_text: source };
  for (const stage of ['extract', 'diagnose', 'rewrite', 'assemble', 'audit', 'finalize']) {
    const response = await call({ stage, job });
    assert.equal(response.statusCode, 200, JSON.stringify(response.body));
    Object.assign(job, response.body.patch);
    if (['extract', 'diagnose', 'rewrite', 'audit'].includes(stage)) {
      assert.equal(response.body.patch.cost_estimate, 0);
      assert.ok(response.body.patch.input_tokens > 0);
      assert.equal(response.body.patch.provider, 'openrouter');
    }
  }
  assert.equal(results.length, 0);
  assert.equal(job.cost_estimate, 0);
  assert.equal(job.model_fast, 'openrouter/test/selected-model:free');
  assert.equal(job.model_quality, 'openrouter/test/selected-model:free');
});

test('configured paid-provider stages retain an approximate nonzero estimate', async (t) => {
  configure(t, [extraction]);
  const response = await call({ stage: 'extract', job: { source_text: source } });
  assert.equal(response.statusCode, 200, JSON.stringify(response.body));
  assert.ok(response.body.patch.cost_estimate > 0);
  assert.equal(response.body.patch.cost_estimate, 0.00006);
});
