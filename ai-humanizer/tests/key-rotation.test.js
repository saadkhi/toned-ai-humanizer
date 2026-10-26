import test from 'node:test';
import assert from 'node:assert/strict';
import { getProviderConfig, loadProviderConfig } from '../api/_config.js';
import health from '../api/health.js';

test('successive runtime configurations rotate through primary, alias, second and third keys', () => {
  const env = {
    GOOGLE_API_KEY_1: 'synthetic-google-primary',
    GOOGLE_API_KEY: 'synthetic-google-alias',
    GOOGLE_API_KEY_2: 'synthetic-google-second',
    GOOGLE_API_KEY_3: 'synthetic-google-third',
  };
  assert.deepEqual(Array.from({ length: 5 }, () => getProviderConfig(env).pools.google.next()), [
    env.GOOGLE_API_KEY_1, env.GOOGLE_API_KEY, env.GOOGLE_API_KEY_2, env.GOOGLE_API_KEY_3, env.GOOGLE_API_KEY_1,
  ]);
});

test('normalized duplicate aliases preserve the existing runtime cursor', () => {
  const env = { GOOGLE_API_KEY_1: ' synthetic-dedup-first ', GOOGLE_API_KEY: 'synthetic-dedup-first', GOOGLE_API_KEY_2: 'synthetic-dedup-second' };
  const first = getProviderConfig(env);
  assert.equal(first.pools.google.size, 2);
  assert.equal(first.pools.google.next(), 'synthetic-dedup-first');
  const equivalent = getProviderConfig({ ...env, GOOGLE_API_KEY_1: 'synthetic-dedup-first', GOOGLE_API_KEY: undefined });
  assert.equal(equivalent.pools.google, first.pools.google);
  assert.equal(equivalent.pools.google.next(), 'synthetic-dedup-second');
});

test('fresh configuration loading stays isolated from runtime rotation', () => {
  const env = { GOOGLE_API_KEY_1: 'synthetic-isolated-first', GOOGLE_API_KEY_2: 'synthetic-isolated-second' };
  assert.equal(getProviderConfig(env).pools.google.next(), env.GOOGLE_API_KEY_1);
  const fresh = loadProviderConfig(env);
  assert.equal(fresh.pools.google.next(), env.GOOGLE_API_KEY_1);
  assert.equal(loadProviderConfig(env).pools.google.next(), env.GOOGLE_API_KEY_1);
  assert.equal(getProviderConfig(env).pools.google.next(), env.GOOGLE_API_KEY_2);
});

test('health checks never advance the runtime key cursor', t => {
  const originalEnv = process.env;
  process.env = { NODE_ENV: 'test', GOOGLE_API_KEY: 'synthetic-health-first', GOOGLE_API_KEY_2: 'synthetic-health-second' };
  t.after(() => { process.env = originalEnv; });
  assert.equal(getProviderConfig().pools.google.next(), 'synthetic-health-first');
  for (let index = 0; index < 3; index++) {
    const res = {
      setHeader() {},
      status(code) { this.statusCode = code; return this; },
      json(body) { this.body = body; return this; },
    };
    health({ method: 'GET' }, res);
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.body.providers, ['google']);
    assert.doesNotMatch(JSON.stringify(res.body), /synthetic-health/);
  }
  assert.equal(getProviderConfig().pools.google.next(), 'synthetic-health-second');
});

test('changed keys replace only their provider pool and discard removed credentials', () => {
  const env = {
    GOOGLE_API_KEY_1: 'synthetic-replaced-first', GOOGLE_API_KEY_2: 'synthetic-replaced-second',
    OPENROUTER_API_KEY_1: 'synthetic-router-first', OPENROUTER_API_KEY_2: 'synthetic-router-second',
  };
  const original = getProviderConfig(env);
  original.pools.google.next();
  original.pools.openrouter.next();
  const changed = getProviderConfig({ ...env, GOOGLE_API_KEY_1: 'synthetic-new-first', GOOGLE_API_KEY_2: undefined });
  assert.notEqual(changed.pools.google, original.pools.google);
  assert.equal(changed.pools.google.size, 1);
  assert.equal(changed.pools.google.next(), 'synthetic-new-first');
  assert.equal(changed.pools.openrouter, original.pools.openrouter);
  assert.equal(changed.pools.openrouter.next(), env.OPENROUTER_API_KEY_2);
  assert.equal(getProviderConfig({}).configured, false);
  const restored = getProviderConfig(env);
  assert.notEqual(restored.pools.google, original.pools.google);
  assert.equal(restored.pools.google.next(), env.GOOGLE_API_KEY_1);
});

test('changed model bindings reset failure state before reusing credentials', () => {
  const env = { GOOGLE_API_KEY_1: 'synthetic-model-first', GOOGLE_API_KEY_2: 'synthetic-model-second' };
  let previous = getProviderConfig(env).pools.google;
  for (const override of [{ GOOGLE_MODEL_FAST: 'synthetic-fast-model' }, { GOOGLE_MODEL_FAST: 'synthetic-fast-model', GOOGLE_MODEL_QUALITY: 'synthetic-quality-model' }]) {
    for (let index = 0; index < 3; index++) previous.markFailed(env.GOOGLE_API_KEY_1);
    const current = getProviderConfig({ ...env, ...override }).pools.google;
    assert.notEqual(current, previous);
    assert.equal(current.next(), env.GOOGLE_API_KEY_1);
    previous = current;
  }
});

test('Cloudflare account changes and incomplete bindings invalidate the previous pool', () => {
  const env = {
    CLOUDFLARE_ACCOUNT_ID: 'synthetic-account-one',
    CLOUDFLARE_API_KEY_1: 'synthetic-cloudflare-first', CLOUDFLARE_API_KEY_2: 'synthetic-cloudflare-second',
  };
  const first = getProviderConfig(env).pools.cloudflare;
  first.next();
  const changed = getProviderConfig({ ...env, CLOUDFLARE_ACCOUNT_ID: 'synthetic-account-two' }).pools.cloudflare;
  assert.notEqual(changed, first);
  assert.equal(changed.next(), env.CLOUDFLARE_API_KEY_1);
  assert.equal(getProviderConfig({ ...env, CLOUDFLARE_ACCOUNT_ID: ' ' }).pools.cloudflare.size, 0);
  const restored = getProviderConfig(env).pools.cloudflare;
  assert.notEqual(restored, first);
  assert.equal(restored.next(), env.CLOUDFLARE_API_KEY_1);
});

test('each provider retains only its current binding rather than accumulating old pools', () => {
  const firstEnv = { GOOGLE_API_KEY_1: 'synthetic-bounded-first', GOOGLE_API_KEY_2: 'synthetic-bounded-second' };
  const first = getProviderConfig(firstEnv).pools.google;
  first.next();
  for (let index = 0; index < 8; index++) {
    getProviderConfig({ GOOGLE_API_KEY_1: `synthetic-bounded-replacement-${index}` });
  }
  const restored = getProviderConfig(firstEnv).pools.google;
  assert.notEqual(restored, first);
  assert.equal(restored.next(), firstEnv.GOOGLE_API_KEY_1);
});
