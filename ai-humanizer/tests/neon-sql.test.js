import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { after, before, beforeEach, test } from 'node:test';
import { PGlite } from '@electric-sql/pglite';

const migration = await readFile(new URL('../db/neon-rate-limits.sql', import.meta.url), 'utf8');
const globalKey = 'toned:stage:v1:global:100';
const clientKey = (client = 'first', window = 10) => `toned:stage:v1:client:${createHash('sha256').update(client).digest('hex')}:${window}`;
let database;

before(async () => {
  database = new PGlite();
  await database.exec(migration);
});
after(async () => { await database?.close(); });
beforeEach(async () => { await database.exec('TRUNCATE public.toned_rate_limits'); });

async function consume({ client = clientKey(), global = globalKey, clientLimit = 60, globalLimit = 1000, clientTtl = 600, globalTtl = 86400 } = {}) {
  const response = await database.query(
    'SELECT public.toned_consume_capacity($1, $2, $3, $4, $5, $6) AS capacity',
    [client, global, clientLimit, globalLimit, clientTtl, globalTtl],
  );
  return response.rows[0].capacity;
}
async function count(key) {
  const response = await database.query('SELECT request_count FROM public.toned_rate_limits WHERE counter_key = $1', [key]);
  return response.rows.length ? Number(response.rows[0].request_count) : null;
}

test('Neon migration is repeatable and only persists private counter fields', async () => {
  await database.exec(migration);
  assert.deepEqual(await consume(), [1, 0, 0]);
  await database.exec(migration);
  assert.equal(await count(globalKey), 1);
  const { rows } = await database.query("SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'toned_rate_limits' ORDER BY ordinal_position");
  assert.deepEqual(rows.map((row) => row.column_name), ['counter_key', 'request_count', 'expires_at']);
  const metadata = await database.query("SELECT prosecdef, proconfig FROM pg_proc WHERE oid = 'public.toned_consume_capacity(text,text,integer,integer,integer,integer)'::regprocedure");
  assert.equal(metadata.rows[0].prosecdef, false);
  assert.ok(metadata.rows[0].proconfig.includes('search_path=pg_catalog'));
  const permissions = await database.query("SELECT count(*) AS grants FROM pg_proc CROSS JOIN LATERAL aclexplode(proacl) WHERE oid = 'public.toned_consume_capacity(text,text,integer,integer,integer,integer)'::regprocedure AND grantee = 0");
  assert.equal(Number(permissions.rows[0].grants), 0);
});

test('Neon client limits reject without consuming either counter and keep other clients available', async () => {
  assert.deepEqual(await consume({ clientLimit: 1 }), [1, 0, 0]);
  assert.deepEqual(await consume({ clientLimit: 1, clientTtl: 123 }), [0, 123, 1]);
  assert.equal(await count(clientKey()), 1);
  assert.equal(await count(globalKey), 1);
  assert.deepEqual(await consume({ client: clientKey('second'), clientLimit: 1 }), [1, 0, 0]);
  assert.equal(await count(globalKey), 2);
  const nextDay = 'toned:stage:v1:global:101';
  assert.deepEqual(await consume({ global: nextDay, clientLimit: 1 }), [0, 600, 1]);
  assert.equal(await count(nextDay), null);
});

test('Neon global limits span clients and client windows without charging rejected requests', async () => {
  assert.deepEqual(await consume({ globalLimit: 2 }), [1, 0, 0]);
  assert.deepEqual(await consume({ client: clientKey('second'), globalLimit: 2 }), [1, 0, 0]);
  assert.deepEqual(await consume({ client: clientKey('third'), globalLimit: 2, globalTtl: 456 }), [0, 456, 2]);
  assert.deepEqual(await consume({ client: clientKey('first', 11), globalLimit: 2, globalTtl: 456 }), [0, 456, 2]);
  assert.equal(await count(globalKey), 2);
  assert.equal(await count(clientKey('third')), null);
  assert.deepEqual(await consume({ clientLimit: 1, globalLimit: 2, clientTtl: 123 }), [0, 123, 1]);
});

test('Neon expiration reopens an expired window while preserving unexpired daily usage', async () => {
  assert.deepEqual(await consume({ clientLimit: 1 }), [1, 0, 0]);
  await database.query("UPDATE public.toned_rate_limits SET expires_at = clock_timestamp() - interval '1 second' WHERE counter_key = $1", [clientKey()]);
  assert.deepEqual(await consume({ clientLimit: 1 }), [1, 0, 0]);
  assert.equal(await count(clientKey()), 1);
  assert.equal(await count(globalKey), 2);
  await database.exec("UPDATE public.toned_rate_limits SET expires_at = clock_timestamp() - interval '1 second'");
  assert.deepEqual(await consume({ clientLimit: 1, globalLimit: 1 }), [1, 0, 0]);
  assert.equal(await count(globalKey), 1);
});

test('Neon cleanup is bounded and expired rows outside the batch still reset correctly', async () => {
  await database.exec("INSERT INTO public.toned_rate_limits (counter_key, request_count, expires_at) SELECT 'toned:stage:v1:global:' || n, 1, '2000-01-01'::timestamptz FROM generate_series(1000, 1299) n");
  assert.deepEqual(await consume({ clientLimit: 1 }), [1, 0, 0]);
  const first = await database.query('SELECT count(*) AS remaining FROM public.toned_rate_limits WHERE expires_at <= clock_timestamp()');
  assert.equal(Number(first.rows[0].remaining), 44);
  // Refill the cleanup backlog with older rows, so this expired client survives
  // the 256-row batch and must be treated as zero during the admission check.
  await database.exec("INSERT INTO public.toned_rate_limits (counter_key, request_count, expires_at) SELECT 'toned:stage:v1:global:' || n, 1, '2000-01-01'::timestamptz FROM generate_series(2000, 2299) n");
  await database.query("UPDATE public.toned_rate_limits SET expires_at = clock_timestamp() - interval '1 second' WHERE counter_key = $1", [clientKey()]);
  assert.deepEqual(await consume({ clientLimit: 1 }), [1, 0, 0]);
  assert.equal(await count(clientKey()), 1);
  assert.equal(await count(globalKey), 2);
});

test('Neon rejects raw identifiers, key collisions, and invalid budgets before storing anything', async () => {
  for (const options of [
    { client: '192.0.2.1' }, { client: 'Private document source.' },
    { client: globalKey }, { global: clientKey() },
    { client: clientKey() + "'; DROP TABLE public.toned_rate_limits; --" },
    { global: 'toned:stage:v1:global:-1' }, { global: null }, { client: null },
    { clientLimit: 0 }, { clientLimit: 301 }, { clientLimit: null },
    { globalLimit: 0 }, { globalLimit: 100001 }, { globalLimit: null },
    { clientTtl: 0 }, { clientTtl: 3601 }, { clientTtl: null },
    { globalTtl: 0 }, { globalTtl: 86401 }, { globalTtl: null },
  ]) await assert.rejects(consume(options), /Invalid rate-limit parameters/);
  const { rows } = await database.query('SELECT count(*) AS saved FROM public.toned_rate_limits');
  assert.equal(Number(rows[0].saved), 0);
  await assert.rejects(database.query("INSERT INTO public.toned_rate_limits (counter_key, expires_at) VALUES ('192.0.2.1', clock_timestamp())"), /toned_rate_limits_key_format/);
});

test('Neon rolls back global spending if the client update fails in the same transaction', async () => {
  assert.deepEqual(await consume(), [1, 0, 0]);
  await database.exec(`CREATE FUNCTION public.toned_test_reject_client_update() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      IF NEW.counter_key LIKE 'toned:stage:v1:client:%' THEN RAISE EXCEPTION 'Synthetic update failure'; END IF;
      RETURN NEW;
    END $$;
    CREATE TRIGGER toned_test_client_failure BEFORE UPDATE ON public.toned_rate_limits FOR EACH ROW EXECUTE FUNCTION public.toned_test_reject_client_update();`);
  try {
    await assert.rejects(consume({ client: clientKey('rollback') }), /Synthetic update failure/);
    assert.equal(await count(globalKey), 1);
    assert.equal(await count(clientKey('rollback')), null);
    assert.equal(await count(clientKey()), 1);
  } finally {
    await database.exec('DROP TRIGGER toned_test_client_failure ON public.toned_rate_limits; DROP FUNCTION public.toned_test_reject_client_update()');
  }
});

test('queued Neon capacity calls admit only the shared allowance in the PostgreSQL engine', async () => {
  // PGlite serializes these submissions through one embedded PostgreSQL engine.
  // This exercises the real SQL, but is not a multi-connection Neon load test.
  const capacities = await Promise.all(Array.from({ length: 80 }, (_, index) => consume({ client: clientKey(`batch-${index}`), globalLimit: 11 })));
  assert.equal(capacities.filter((result) => result[0] === 1).length, 11);
  assert.equal(capacities.filter((result) => result[0] === 0 && result[2] === 2).length, 69);
  assert.equal(await count(globalKey), 11);
  const saved = await database.query('SELECT count(*) AS records FROM public.toned_rate_limits');
  assert.equal(Number(saved.rows[0].records), 12);
  const { rows } = await database.query("SELECT sum(request_count) AS client_total FROM public.toned_rate_limits WHERE counter_key LIKE 'toned:stage:v1:client:%'");
  assert.equal(Number(rows[0].client_total), 11);
});

test('the real guard and Neon SDK enforce capacity using the migrated PostgreSQL function', async (t) => {
  const { guardApiRequest } = await import('../api/_security.js');
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  const privateSource = 'A private synthetic document.';
  const connectionString = 'postgresql://synthetic_owner:synthetic-pass@ep-integration.us-east-2.aws.neon.tech/neondb?sslmode=require';
  const submitted = [];
  globalThis.fetch = async (url, options) => {
    assert.equal(String(url), 'https://api.us-east-2.aws.neon.tech/sql');
    assert.equal(options.redirect, 'error');
    const body = JSON.parse(options.body);
    assert.ok(!options.body.includes(privateSource));
    assert.ok(!options.body.includes('192.0.2.'));
    assert.ok(!options.body.includes('synthetic-pass'));
    submitted.push(body);
    const result = await database.query(body.query, body.params);
    const capacity = result.rows[0].result;
    return Response.json({
      fields: [{ name: 'result', dataTypeID: 1007 }],
      rows: [[`{${capacity.join(',')}}`]], command: 'SELECT', rowCount: 1,
    });
  };
  const env = {
    NODE_ENV: 'production', VERCEL: '1', RATE_LIMIT_STORE: 'neon',
    DATABASE_URL: connectionString, RATE_LIMIT_REQUESTS: '1', DAILY_STAGE_LIMIT: '2',
  };
  const run = async (ip) => {
    const res = {
      statusCode: 200, headers: {},
      setHeader(name, value) { this.headers[name] = value; },
      status(code) { this.statusCode = code; return this; },
      json(data) { this.data = data; return this; },
    };
    const allowed = await guardApiRequest({
      method: 'POST', headers: { host: 'toned.example', origin: 'https://toned.example', 'x-forwarded-for': ip },
      body: { stage: 'extract', job: { source_text: privateSource } },
    }, res, { billable: true, env, now: 1760000000000 });
    assert.ok(!JSON.stringify(res).includes('synthetic-pass'));
    assert.ok(!JSON.stringify(res).includes(privateSource));
    return { allowed, res };
  };
  assert.equal((await run('192.0.2.100')).allowed, true);
  const clientBlocked = await run('192.0.2.100');
  assert.equal(clientBlocked.allowed, false);
  assert.equal(clientBlocked.res.statusCode, 429);
  assert.equal(clientBlocked.res.data.code, 'rate_limit_reached');
  assert.ok(Number(clientBlocked.res.headers['Retry-After']) > 0);
  assert.equal((await run('192.0.2.101')).allowed, true);
  const globalBlocked = await run('192.0.2.102');
  assert.equal(globalBlocked.allowed, false);
  assert.equal(globalBlocked.res.statusCode, 429);
  assert.equal(globalBlocked.res.data.code, 'daily_limit_reached');
  assert.equal(submitted.length, 4);
  assert.equal(await count(submitted[0].params[1]), 2);
  const totals = await database.query("SELECT sum(request_count) AS spent FROM public.toned_rate_limits WHERE counter_key LIKE 'toned:stage:v1:client:%'");
  assert.equal(Number(totals.rows[0].spent), 2);
});
