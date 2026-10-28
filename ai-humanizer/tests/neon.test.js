import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { neonDatabaseUrl, neonConfigurationIssue } from '../api/_neon.js';
import { getSecurityConfig, guardApiRequest } from '../api/_security.js';

const databaseUrl = 'postgresql://synthetic_user:synthetic_password@ep-example.us-east-2.aws.neon.tech/neondb?sslmode=require';
const production = { NODE_ENV: 'production', VERCEL: '1', RATE_LIMIT_STORE: 'neon', DATABASE_URL: databaseUrl };
function request() {
  return {
    method: 'POST', headers: { host: 'toned.example', origin: 'https://toned.example', 'x-forwarded-for': '203.0.113.42' },
    socket: { remoteAddress: '192.0.2.1' }, body: { stage: 'extract', job: { source_text: 'Private test document.' } },
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
function mockFetch(t, impl) {
  const previous = globalThis.fetch;
  globalThis.fetch = impl;
  t.after(() => { globalThis.fetch = previous; });
}
const pgResult = (result) => Response.json({
  fields: [{ name: 'result', dataTypeID: 1007 }],
  rows: [[result]], rowCount: 1, command: 'SELECT',
});

test('Neon URL aliases require a credentialed Neon PostgreSQL TLS connection', () => {
  assert.equal(neonDatabaseUrl({ DATABASE_URL: ` ${databaseUrl} ` }), databaseUrl);
  assert.equal(neonDatabaseUrl({ NEON_DATABASE_URL: databaseUrl.replace('postgresql:', 'postgres:') }), databaseUrl.replace('postgresql:', 'postgres:'));
  assert.equal(neonDatabaseUrl({ NEON_DATABASE_URL: databaseUrl.replace('require', 'verify-full'), DATABASE_URL: 'invalid-alias' }), databaseUrl.replace('require', 'verify-full'));
  for (const binding of ['require', 'prefer']) assert.equal(neonDatabaseUrl({ DATABASE_URL: `${databaseUrl}&channel_binding=${binding}` }), `${databaseUrl}&channel_binding=${binding}`);
  assert.equal(neonDatabaseUrl({ NEON_DATABASE_URL: 'invalid-primary', DATABASE_URL: databaseUrl }), null);
  for (const value of [
    '', 'not-a-url', databaseUrl.replace('postgresql:', 'https:'),
    databaseUrl.replace('ep-example.us-east-2.aws.neon.tech', 'evil.example'),
    databaseUrl.replace('.neon.tech', '.neon.tech.evil.example'),
    databaseUrl.replace(':synthetic_password', ''), databaseUrl.replace('synthetic_user:', ':'),
    databaseUrl.replace('/neondb?', '/?'), databaseUrl.replace('/neondb?', '/db/other?'),
    databaseUrl.replace('?sslmode=require', ''), databaseUrl.replace('sslmode=require', 'sslmode=disable'),
    databaseUrl + '&sslmode=disable', databaseUrl + '#private',
    databaseUrl.replace('.tech/', '.tech:8443/'),
    databaseUrl + '&host=evil.example', databaseUrl + '&password=synthetic_override',
    databaseUrl + '&database=other', databaseUrl + '&connectionString=synthetic_override',
    databaseUrl + '&channel_binding=disable', databaseUrl + '&channel_binding=require&channel_binding=prefer',
  ]) assert.equal(neonDatabaseUrl({ DATABASE_URL: value }), null);
});

test('Neon clipboard formats normalize to one validated URI without losing query parameters', () => {
  const uri = `${databaseUrl}&channel_binding=require`;
  for (const value of [
    uri, ` ${uri} `, `\n${uri}\r\n`, `'${uri}'`, `"${uri}"`,
    `DATABASE_URL=${uri}`, `DATABASE_URL='${uri}'`, `NEON_DATABASE_URL="${uri}"`,
    `psql ${uri}`, `psql '${uri}'`, `psql "${uri}"`,
    `DATABASE_URL="psql '${uri}'"`,
  ]) {
    assert.equal(neonDatabaseUrl({ DATABASE_URL: value }), uri);
    assert.equal(neonConfigurationIssue({ DATABASE_URL: value }), null);
  }
});

test('Neon normalization rejects shell arguments, extra commands, and multiline input', () => {
  for (const value of [
    `psql '${databaseUrl}' --command='SELECT 1'`,
    `psql --dbname '${databaseUrl}'`, `psql '${databaseUrl}' && echo private`,
    `psql '${databaseUrl}';echo-private`, `psql ${databaseUrl};echo-private`,
    `psql '${databaseUrl}' | cat`, `psql '${databaseUrl}' > private.txt`,
    `psql ${databaseUrl}&`, `psql $(echo '${databaseUrl}')`,
    `psql \`${databaseUrl}\``, `psql '${databaseUrl}'\necho private`,
    `DATABASE_URL='${databaseUrl}'\nOTHER=private`,
    `"${databaseUrl}'`, `'${databaseUrl}"`, `OTHER=${databaseUrl}`,
    `export DATABASE_URL=${databaseUrl}`,
  ]) {
    assert.equal(neonDatabaseUrl({ DATABASE_URL: value }), null);
    assert.equal(neonConfigurationIssue({ DATABASE_URL: value }), 'neon_url_invalid');
  }
});

test('Neon setup issues identify format and TLS failures without returning credentials', () => {
  const cases = [
    [{}, 'neon_url_missing'], [{ DATABASE_URL: ' ' }, 'neon_url_missing'],
    [{ DATABASE_URL: 42 }, 'neon_url_invalid'],
    [{ DATABASE_URL: `psql '${databaseUrl.replace('.neon.tech', '.evil.example')}'` }, 'neon_url_invalid'],
    [{ DATABASE_URL: `'${databaseUrl.replace('sslmode=require', 'sslmode=disable')}'` }, 'neon_url_requires_tls'],
    [{ DATABASE_URL: `DATABASE_URL="${databaseUrl.replace('?sslmode=require', '')}"` }, 'neon_url_requires_tls'],
    [{ DATABASE_URL: `psql '${databaseUrl}&sslmode=disable'` }, 'neon_url_requires_tls'],
    [{ DATABASE_URL: `psql '${databaseUrl}&application_name=private'` }, 'neon_url_unsupported_parameters'],
    [{ DATABASE_URL: `psql '${databaseUrl}&channel_binding=disable'` }, 'neon_url_unsupported_parameters'],
    [{ DATABASE_URL: databaseUrl, NEON_DATABASE_URL: 'private-invalid-primary' }, 'neon_url_invalid'],
  ];
  for (const [env, expected] of cases) {
    const issue = neonConfigurationIssue(env);
    assert.equal(issue, expected);
    assert.equal(neonDatabaseUrl(env), null);
    assert.ok(!issue.includes('synthetic_password'));
    assert.ok(!issue.includes('private'));
    assert.ok(!issue.includes('postgresql'));
  }
});

test('Neon selection is explicit or automatic without bypassing partial Redis bindings', () => {
  for (const env of [{ DATABASE_URL: databaseUrl }, { NEON_DATABASE_URL: databaseUrl }, { RATE_LIMIT_STORE: 'neon', DATABASE_URL: databaseUrl, UPSTASH_REDIS_REST_TOKEN: 'old-unused-test-binding' }]) {
    const config = getSecurityConfig(env);
    assert.equal(config.store, 'neon');
    assert.equal(config.requiresDurable, true);
    assert.equal(config.durableConfigured, true);
    assert.ok(!JSON.stringify(config).includes('synthetic_password'));
  }
  const partialRedis = getSecurityConfig({ DATABASE_URL: databaseUrl, UPSTASH_REDIS_REST_TOKEN: 'partial-test-binding' });
  assert.equal(partialRedis.store, 'upstash');
  assert.equal(partialRedis.durableConfigured, false);
  assert.equal(getSecurityConfig({ RATE_LIMIT_STORE: 'upstash', DATABASE_URL: databaseUrl }).durableConfigured, false);
  const invalid = getSecurityConfig({ RATE_LIMIT_STORE: 'memory', DATABASE_URL: databaseUrl });
  assert.equal(invalid.store, null);
  assert.equal(invalid.requiresDurable, true);
  assert.equal(invalid.durableConfigured, false);
});

test('invalid Neon settings fail closed before sending credentials, including development', async (t) => {
  mockFetch(t, () => assert.fail('An invalid Neon binding must not contact any provider'));
  for (const env of [
    { NODE_ENV: 'production', RATE_LIMIT_STORE: 'neon' },
    { RATE_LIMIT_STORE: 'neon' }, { DATABASE_URL: 'invalid-synthetic-url' },
    { RATE_LIMIT_STORE: 'typo', DATABASE_URL: databaseUrl },
    { DATABASE_URL: databaseUrl.replace('.neon.tech', '.evil.example') },
    { DATABASE_URL: databaseUrl, UPSTASH_REDIS_REST_TOKEN: 'partial-test-binding' },
  ]) {
    const res = response();
    assert.equal(await guardApiRequest(request(), res, { billable: true, env, fetchImpl: () => assert.fail('Must not fall back to Redis') }), false);
    assert.equal(res.statusCode, 503);
    assert.equal(res.data.code, 'rate_limit_unavailable');
  }
});

test('the actual Neon SDK parameterizes one atomic counter call without text, raw IPs, or redirects', async (t) => {
  let calls = 0;
  mockFetch(t, async (url, options) => {
    calls++;
    assert.equal(String(url), 'https://api.us-east-2.aws.neon.tech/sql');
    assert.equal(options.method, 'POST');
    assert.equal(options.redirect, 'error');
    assert.ok(options.signal instanceof AbortSignal);
    const connection = new URL(options.headers['Neon-Connection-String']);
    assert.equal(connection.hostname, 'ep-example.us-east-2.aws.neon.tech');
    assert.equal(connection.password, 'synthetic_password');
    const { query, params } = JSON.parse(options.body);
    assert.match(query, /SELECT public\.toned_consume_capacity\(/);
    for (let index = 1; index <= 6; index++) assert.ok(query.includes(`$${index}`));
    assert.deepEqual(params, [
      `toned:stage:v1:client:${createHash('sha256').update('203.0.113.42').digest('hex')}:166`,
      'toned:stage:v1:global:1', '60', '1000', '200', '72800',
    ]);
    assert.ok(!options.body.includes('Private test document'));
    assert.ok(!options.body.includes('203.0.113.42'));
    assert.ok(!options.body.includes('synthetic_password'));
    return pgResult('{1,0,0}');
  });
  const res = response();
  assert.equal(await guardApiRequest(request(), res, { billable: true, env: production, now: 100000000, fetchImpl: () => assert.fail('Must not contact Redis') }), true);
  assert.equal(calls, 1);
});

test('the actual Neon SDK receives the validated URI from a copied psql connection command', async (t) => {
  let calls = 0;
  const uri = `${databaseUrl.replace('ep-example.us-east-2', 'ep-example-pooler.c-6.us-east-2')}&channel_binding=require`;
  mockFetch(t, async (url, options) => {
    calls++;
    assert.equal(String(url), 'https://api.c-6.us-east-2.aws.neon.tech/sql');
    assert.equal(options.redirect, 'error');
    const connection = new URL(options.headers['Neon-Connection-String']);
    assert.equal(connection.hostname, 'ep-example-pooler.c-6.us-east-2.aws.neon.tech');
    assert.equal(connection.password, 'synthetic_password');
    assert.equal(connection.searchParams.get('sslmode'), 'require');
    assert.equal(connection.searchParams.get('channel_binding'), 'require');
    assert.ok(!options.headers['Neon-Connection-String'].startsWith('psql'));
    return pgResult('{1,0,0}');
  });
  const res = response();
  assert.equal(await guardApiRequest(request(), res, {
    billable: true, env: { ...production, DATABASE_URL: `psql '${uri}'` },
  }), true);
  assert.equal(calls, 1);
});

for (const [reason, code] of [[1, 'rate_limit_reached'], [2, 'daily_limit_reached']]) {
  test(`Neon ${code} preserves Retry-After without falling back to another store`, async (t) => {
    mockFetch(t, async () => pgResult(`{0,123,${reason}}`));
    const res = response();
    assert.equal(await guardApiRequest(request(), res, { billable: true, env: production, fetchImpl: () => assert.fail('Must not contact Redis') }), false);
    assert.equal(res.statusCode, 429);
    assert.equal(res.data.code, code);
    assert.equal(res.headers['Retry-After'], '123');
  });
}

test('Neon transport, missing-schema, and malformed results fail closed without leaking database details', async (t) => {
  const previous = globalThis.fetch;
  t.after(() => { globalThis.fetch = previous; });
  const privateMessage = 'synthetic_password private-db-error';
  for (const impl of [
    async () => { throw new Error(privateMessage); },
    async () => new Response(privateMessage, { status: 500 }),
    async () => Response.json({ message: privateMessage, code: '08006' }, { status: 400 }),
    async () => new Response('unreadable-json'),
    async () => Response.json({ fields: [{ name: 'result', dataTypeID: 1007 }], rows: [] }),
    async () => pgResult('{0,-1,2}'), async () => pgResult('{0,86401,2}'),
    async () => pgResult('{0,10,3}'), async () => pgResult('{1,10,0}'),
    async () => pgResult('{1,0,1}'), async () => pgResult('{2,0,0}'),
    async () => pgResult('{1,0}'), async () => pgResult(null),
  ]) {
    let calls = 0;
    globalThis.fetch = async (...args) => { calls++; return impl(...args); };
    const res = response();
    assert.equal(await guardApiRequest(request(), res, { billable: true, env: { ...production, UPSTASH_REDIS_REST_URL: 'https://unused.upstash.io', UPSTASH_REDIS_REST_TOKEN: 'unused-test-binding' }, fetchImpl: () => assert.fail('Must not fall back to Redis') }), false);
    assert.equal(res.statusCode, 503);
    assert.equal(res.data.code, 'rate_limit_unavailable');
    assert.ok(!JSON.stringify(res.data).includes('synthetic_password'));
    assert.ok(!JSON.stringify(res.data).includes('private-db-error'));
    assert.equal(calls, 1);
  }
});

test('Neon setup errors have safe actionable codes without returning SQL details or credentials', async (t) => {
  const previous = globalThis.fetch;
  t.after(() => { globalThis.fetch = previous; });
  for (const [sqlState, code] of [
    ['42883', 'rate_limit_schema_missing'], ['42P01', 'rate_limit_schema_missing'],
    ['28P01', 'rate_limit_database_auth_failed'], ['42501', 'rate_limit_database_permission_denied'],
  ]) {
    globalThis.fetch = async () => Response.json({ message: 'private-db-details synthetic_password', code: sqlState }, { status: 400 });
    const res = response();
    assert.equal(await guardApiRequest(request(), res, { billable: true, env: production, fetchImpl: () => assert.fail('Neon errors must not fall back to Redis') }), false);
    assert.equal(res.statusCode, 503);
    assert.equal(res.data.code, code);
    assert.match(res.data.error, /site owner/);
    assert.doesNotMatch(JSON.stringify(res.data), /private-db-details|synthetic_password|postgresql:/);
  }
});
