import test from 'node:test';
import assert from 'node:assert/strict';
import health from '../api/health.js';

function setup(t, values = {}) {
  const names = [...Object.keys(process.env).filter(name => /^(GOOGLE|OPENROUTER|SAMBANOVA|CLOUDFLARE)_API_KEY/.test(name)), 'GOOGLE_API_KEY_1', 'NODE_ENV', 'VERCEL', 'VERCEL_ENV', 'UPSTASH_REDIS_REST_URL', 'UPSTASH_REDIS_REST_TOKEN'];
  const before = Object.fromEntries(names.map(name => [name, process.env[name]]));
  for (const name of names) delete process.env[name];
  Object.assign(process.env, { NODE_ENV: 'test' }, values);
  t.after(() => {
    for (const [name, value] of Object.entries(before)) {
      if (value === undefined) delete process.env[name]; else process.env[name] = value;
    }
  });
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
