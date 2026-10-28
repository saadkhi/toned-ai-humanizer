import test from 'node:test';
import assert from 'node:assert/strict';
import health from '../api/health.js';

function setup(t, values = {}) {
  const before = process.env;
  process.env = { NODE_ENV: 'test', AI_PROVIDER_MODE: 'configured', ...values };
  t.after(() => { process.env = before; });
}
function call(method = 'GET') {
  const res = { headers: {}, statusCode: 200, setHeader(name, value) { this.headers[name] = value; }, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
  health({ method }, res);
  return res;
}

test('health reports missing configuration as unavailable, not an upstream check', t => {
  setup(t);
  const res = call();
  assert.equal(res.statusCode, 503);
  assert.equal(res.body.configured, false);
  assert.deepEqual(res.body.providers, []);
  assert.equal(res.headers['Cache-Control'], 'no-store');
});
test('health exposes provider names but no credentials or models', t => {
  setup(t, { GOOGLE_API_KEY_1: 'synthetic-test-secret' });
  const res = call();
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.mode, 'configured');
  assert.deepEqual(res.body.providers, ['google']);
  assert.ok(!JSON.stringify(res.body).includes('synthetic-test-secret'));
});
test('production health is unavailable without durable spend protection', t => {
  setup(t, { GOOGLE_API_KEY_1: 'synthetic-test-secret', NODE_ENV: 'production' });
  const res = call();
  assert.equal(res.statusCode, 503);
  assert.equal(res.body.providerConfigured, true);
  assert.equal(res.body.protectionConfigured, false);
});
test('health is ready when production configuration is supplied without spending credits', t => {
  setup(t, { GOOGLE_API_KEY_1: 'synthetic-test-secret', NODE_ENV: 'production', UPSTASH_REDIS_REST_URL: 'https://test.upstash.io', UPSTASH_REDIS_REST_TOKEN: 'synthetic-redis-secret' });
  const res = call();
  assert.equal(res.statusCode, 200);
  assert.ok(!JSON.stringify(res.body).includes('synthetic-redis-secret'));
});
test('health only permits GET', t => {
  setup(t);
  const res = call('POST');
  assert.equal(res.statusCode, 405);
  assert.equal(res.headers.Allow, 'GET');
});
test('partial local Redis settings cannot report ready when stage guards will reject them', t => {
  setup(t, { GOOGLE_API_KEY_1: 'synthetic-test-secret', UPSTASH_REDIS_REST_URL: 'https://test.upstash.io' });
  const res = call();
  assert.equal(res.statusCode, 503);
  assert.equal(res.body.protectionConfigured, false);
});

test('health reports default free mode without selecting configured paid providers', t => {
  setup(t, { OPENROUTER_API_KEY: 'synthetic-free-health', GOOGLE_API_KEY: 'synthetic-paid-health' });
  delete process.env.AI_PROVIDER_MODE;
  const res = call();
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.mode, 'free');
  assert.deepEqual(res.body.providers, ['openrouter']);
  assert.doesNotMatch(JSON.stringify(res.body), /synthetic-|openrouter\/free/);
});

test('health is unavailable for a paid free-model override with no paid-provider fallback', t => {
  setup(t, { AI_PROVIDER_MODE: 'free', OPENROUTER_API_KEY: 'synthetic-invalid-free', GOOGLE_API_KEY: 'synthetic-paid-fallback', OPENROUTER_FREE_MODEL: 'google/gemini-2.5-pro' });
  const res = call();
  assert.equal(res.statusCode, 503);
  assert.equal(res.body.mode, 'free');
  assert.equal(res.body.providerConfigured, false);
  assert.deepEqual(res.body.providers, []);
});

test('Neon production readiness reports the store without contacting or exposing the database', t => {
  setup(t, {
    NODE_ENV: 'production', AI_PROVIDER_MODE: 'free', OPENROUTER_API_KEY: 'synthetic-health-model-key',
    RATE_LIMIT_STORE: 'neon', DATABASE_URL: 'postgresql://synthetic_user:synthetic_health_password@ep-health.us-east-2.aws.neon.tech/neondb?sslmode=require',
    UPSTASH_REDIS_REST_TOKEN: 'old-unused-binding',
  });
  const previousFetch = globalThis.fetch;
  globalThis.fetch = () => assert.fail('Health must not perform a database or provider request');
  t.after(() => { globalThis.fetch = previousFetch; });
  const res = call();
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.protectionConfigured, true);
  assert.equal(res.body.protectionStore, 'neon');
  assert.deepEqual(res.body.providers, ['openrouter']);
  assert.doesNotMatch(JSON.stringify(res.body), /synthetic_|postgresql:|neon\.tech|unused-binding/);
});

test('invalid Neon production bindings cannot report protection ready', t => {
  setup(t, {
    NODE_ENV: 'production', GOOGLE_API_KEY: 'synthetic-health-model-key', RATE_LIMIT_STORE: 'neon',
    DATABASE_URL: 'postgresql://synthetic_user:synthetic_password@evil.example/neondb?sslmode=require',
  });
  const res = call();
  assert.equal(res.statusCode, 503);
  assert.equal(res.body.providerConfigured, true);
  assert.equal(res.body.protectionConfigured, false);
  assert.equal(res.body.protectionStore, 'neon');
});

test('Neon configuration diagnostics distinguish a missing value from rejected values without contacting the database', t => {
  setup(t, {
    NODE_ENV: 'production', OPENROUTER_API_KEY: 'synthetic-model-key', RATE_LIMIT_STORE: 'neon',
    VERCEL_GIT_COMMIT_SHA: 'abcdef1234567890abcdef1234567890abcdef12',
  });
  const previousFetch = globalThis.fetch;
  globalThis.fetch = () => assert.fail('Configuration diagnostics must not contact upstream services');
  t.after(() => { globalThis.fetch = previousFetch; });
  const url = 'postgresql://synthetic_user:synthetic_password@ep-health.c-6.us-east-2.aws.neon.tech/neondb?sslmode=require';
  for (const [value, issue] of [
    [undefined, 'neon_url_missing'], ['invalid-private-configuration', 'neon_url_invalid'],
    [url.replace('require', 'disable'), 'neon_url_requires_tls'],
    [url + '&unsupported=private-value', 'neon_url_unsupported_parameters'],
  ]) {
    if (value === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = value;
    const res = call();
    assert.equal(res.statusCode, 503);
    assert.equal(res.body.protectionIssue, issue);
    assert.equal(res.body.deploymentRevision, 'abcdef123456');
    assert.doesNotMatch(JSON.stringify(res.body), /synthetic_|private-value|postgresql:|invalid-private/);
  }
  process.env.DATABASE_URL = url;
  assert.equal(call().body.protectionIssue, null);
  assert.equal(call().statusCode, 200);
});

test('health never echoes a non-SHA deployment revision', t => {
  setup(t, { VERCEL_GIT_COMMIT_SHA: 'private-invalid-revision-value' });
  const res = call();
  assert.equal(res.body.deploymentRevision, null);
  assert.doesNotMatch(JSON.stringify(res.body), /private-invalid/);
});
