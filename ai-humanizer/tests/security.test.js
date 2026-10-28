import assert from 'node:assert/strict';
import test from 'node:test';
import { getSecurityConfig, guardApiRequest } from '../api/_security.js';

const production = {
  NODE_ENV: 'production', VERCEL: '1',
  UPSTASH_REDIS_REST_URL: 'https://example.upstash.io',
  UPSTASH_REDIS_REST_TOKEN: 'synthetic-test-token',
};

function request(overrides = {}) {
  return {
    method: 'POST',
    headers: { host: 'toned.example', origin: 'https://toned.example' },
    socket: { remoteAddress: '192.0.2.1' },
    body: { stage: 'extract', job: { source_text: 'Sample source.' } },
    ...overrides,
  };
}

function response() {
  return {
    statusCode: 200, headers: {},
    setHeader(name, value) { this.headers[name] = value; },
    status(code) { this.statusCode = code; return this; },
    json(data) { this.data = data; return this; },
  };
}

test('cross-site and malformed browser origins are rejected without spending capacity', async () => {
  for (const headers of [
    { host: 'toned.example', origin: 'https://evil.example' },
    { host: 'toned.example', origin: 'null' },
    { host: 'toned.example', origin: 'https://toned.example/path' },
    { host: 'toned.example', 'sec-fetch-site': 'cross-site' },
    { host: 'toned.example', origin: 'https://evil.example', 'x-forwarded-host': 'evil.example' },
  ]) {
    const res = response();
    assert.equal(await guardApiRequest(request({ headers }), res, {
      billable: true, env: production, fetchImpl: () => { assert.fail('must not reach Redis'); },
    }), false);
    assert.equal(res.statusCode, 403);
    assert.equal(res.data.code, 'origin_not_allowed');
  }
});

test('same-origin and non-browser nonbillable checks do not need Redis', async () => {
  for (const req of [request(), request({ method: 'GET', headers: {} })]) {
    const res = response();
    assert.equal(await guardApiRequest(req, res, { env: { NODE_ENV: 'production' } }), true);
    assert.equal(res.headers['Cache-Control'], 'no-store');
    assert.equal(res.headers['X-Content-Type-Options'], 'nosniff');
  }
});

test('oversized parsed and raw bodies and content lengths are rejected', async () => {
  for (const req of [
    request({ headers: { 'content-length': '1048577' } }),
    request({ body: 'x'.repeat(1048577) }),
    request({ body: { text: 'x'.repeat(1048577) } }),
  ]) {
    const res = response();
    assert.equal(await guardApiRequest(req, res), false);
    assert.equal(res.statusCode, 413);
    assert.equal(res.data.code, 'request_too_large');
  }
});

test('production and partially configured local environments fail closed', async () => {
  for (const env of [
    { NODE_ENV: 'production' }, { VERCEL: '1' }, { VERCEL_ENV: 'preview' },
    { UPSTASH_REDIS_REST_URL: production.UPSTASH_REDIS_REST_URL },
    { UPSTASH_REDIS_REST_TOKEN: 'synthetic-test-token' },
  ]) {
    const res = response();
    assert.equal(await guardApiRequest(request(), res, { billable: true, env }), false);
    assert.equal(res.statusCode, 503);
    assert.equal(res.data.code, 'rate_limit_unavailable');
  }
});

test('untrusted Redis URLs cannot receive the authorization token', async () => {
  for (const url of [
    'http://example.upstash.io', 'https://example.upstash.io.evil.example',
    'https://evil.example', 'https://example.upstash.io/path',
    'https://user:password@example.upstash.io', 'https://example.upstash.io?token=secret',
  ]) {
    const res = response();
    assert.equal(await guardApiRequest(request(), res, {
      billable: true, env: { ...production, UPSTASH_REDIS_REST_URL: url },
      fetchImpl: () => { assert.fail('must not send credential to invalid destination'); },
    }), false);
    assert.equal(res.statusCode, 503);
  }
});

test('durable limiter atomically checks client and global counters without sending text or raw IPs', async () => {
  let calls = 0;
  const res = response();
  const allowed = await guardApiRequest(request({ headers: {
    host: 'toned.example', 'x-forwarded-for': '203.0.113.42',
  } }), res, {
    billable: true, env: production, now: 100000000,
    fetchImpl: async (url, options) => {
      calls += 1;
      assert.equal(url, 'https://example.upstash.io');
      assert.equal(options.headers.Authorization, 'Bearer synthetic-test-token');
      assert.equal(options.redirect, 'error');
      const command = JSON.parse(options.body);
      assert.equal(command[0], 'EVAL');
      assert.equal(command[2], '2');
      assert.match(command[3], /^toned:stage:v1:client:[a-f0-9]{64}:\d+$/);
      assert.match(command[4], /^toned:stage:v1:global:\d+$/);
      assert.deepEqual(command.slice(5), ['60', '1000', '200', '72800']);
      assert.ok(!options.body.includes('203.0.113.42'));
      assert.ok(!options.body.includes('Sample source'));
      return { ok: true, json: async () => ({ result: [1, 0, 0] }) };
    },
  });
  assert.equal(allowed, true);
  assert.equal(calls, 1);
});

test('durable client and global limits return 429 and Retry-After', async () => {
  for (const [reason, code] of [[1, 'rate_limit_reached'], [2, 'daily_limit_reached']]) {
    const res = response();
    assert.equal(await guardApiRequest(request(), res, {
      billable: true, env: production,
      fetchImpl: async () => ({ ok: true, json: async () => ({ result: [0, 123, reason] }) }),
    }), false);
    assert.equal(res.statusCode, 429);
    assert.equal(res.headers['Retry-After'], '123');
    assert.equal(res.data.code, code);
  }
});

test('Redis outages and invalid responses fail closed without leaking upstream details', async () => {
  for (const fetchImpl of [
    async () => { throw new Error('secret-provider-response'); },
    async () => ({ ok: false, text: async () => 'secret-provider-response' }),
    async () => ({ ok: true, json: async () => ({ error: 'secret-provider-response' }) }),
    async () => ({ ok: true, json: async () => ({ result: [0, -1, 2] }) }),
    async () => ({ ok: true, json: async () => ({ result: 'OK' }) }),
  ]) {
    const res = response();
    assert.equal(await guardApiRequest(request(), res, { billable: true, env: production, fetchImpl }), false);
    assert.equal(res.statusCode, 503);
    assert.ok(!JSON.stringify(res.data).includes('secret-provider-response'));
  }
});

test('local limiter cannot be bypassed by spoofing forwarding headers and resets after its window', async () => {
  const env = { NODE_ENV: 'development', RATE_LIMIT_REQUESTS: '1', RATE_LIMIT_WINDOW_SECONDS: '60' };
  const now = 864000000;
  const first = response();
  assert.equal(await guardApiRequest(request(), first, { billable: true, env, now }), true);
  const blocked = response();
  assert.equal(await guardApiRequest(request({ headers: {
    host: 'toned.example', 'x-forwarded-for': '203.0.113.255',
  } }), blocked, { billable: true, env, now }), false);
  assert.equal(blocked.statusCode, 429);
  const nextWindow = response();
  assert.equal(await guardApiRequest(request(), nextWindow, { billable: true, env, now: now + 60000 }), true);
});

test('local global budget applies across client addresses', async () => {
  const env = { NODE_ENV: 'development', DAILY_STAGE_LIMIT: '1' };
  const now = 1728000000;
  assert.equal(await guardApiRequest(request(), response(), { billable: true, env, now }), true);
  const res = response();
  assert.equal(await guardApiRequest(request({ socket: { remoteAddress: '198.51.100.1' } }), res, {
    billable: true, env, now,
  }), false);
  assert.equal(res.statusCode, 429);
  assert.equal(res.data.code, 'daily_limit_reached');
});

test('limits accept bounded integers and reject invalid or unlimited overrides', () => {
  const config = getSecurityConfig({ RATE_LIMIT_REQUESTS: '-1', RATE_LIMIT_WINDOW_SECONDS: '1', DAILY_STAGE_LIMIT: '0' });
  assert.deepEqual(config, { production: false, store: 'memory', requiresDurable: false, durableConfigured: false, protectionIssue: null, rateLimit: 60, windowSeconds: 600, dailyLimit: 1000 });
  assert.equal(getSecurityConfig({ RATE_LIMIT_REQUESTS: '300' }).rateLimit, 300);
});
