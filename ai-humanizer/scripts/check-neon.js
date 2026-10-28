import { existsSync } from 'node:fs';
import { loadEnvFile } from 'node:process';
import { neon } from '@neondatabase/serverless';
import { neonDatabaseUrl } from '../api/_neon.js';
import { getSecurityConfig, guardApiRequest } from '../api/_security.js';
import health from '../api/health.js';

// Preserve injected environment values; local overrides take precedence over .env.
for (const file of ['.env.local', '.env']) if (existsSync(file)) loadEnvFile(file);

const emit = (stage, details = {}) => console.log(JSON.stringify({ stage, ...details }));
function response() {
  return {
    statusCode: 200, headers: {}, body: null,
    setHeader(name, value) { this.headers[name] = value; return this; },
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
}
let stage = 'configuration';
try {
  const connection = neonDatabaseUrl();
  const config = getSecurityConfig();
  if (!connection || config.store !== 'neon' || !config.durableConfigured) {
    emit(stage, { pass: false, neonUrlPresent: !!(process.env.NEON_DATABASE_URL || process.env.DATABASE_URL), selectedStore: config.store, neonUrlValid: !!connection });
    process.exitCode = 1;
  } else {
    emit(stage, { pass: true, store: config.store });
    // Use a fresh deadline for every read, allowing a suspended Free compute to wake.
    const query = async (statement, params = []) => neon(connection).query(statement, params, {
      fetchOptions: { signal: AbortSignal.timeout(15000), redirect: 'error' },
    });
    stage = 'postgres-connection';
    const connected = await query('SELECT current_database() IS NOT NULL AS connected, current_user IS NOT NULL AS role_ready');
    if (connected.length !== 1 || connected[0].connected !== true || connected[0].role_ready !== true) throw new Error('Unexpected database response');
    emit(stage, { pass: true });

    stage = 'schema';
    const [schema] = await query("SELECT to_regclass('public.toned_rate_limits') IS NOT NULL AS table_ready, to_regprocedure('public.toned_consume_capacity(text,text,integer,integer,integer,integer)') IS NOT NULL AS function_ready");
    if (!schema?.table_ready || !schema?.function_ready) {
      emit(stage, { pass: false, tableReady: !!schema?.table_ready, functionReady: !!schema?.function_ready });
      process.exitCode = 1;
    } else {
      emit(stage, { pass: true });
      stage = 'permissions';
      const [permissions] = await query("SELECT has_table_privilege(current_user, 'public.toned_rate_limits', 'SELECT') AS can_select, has_table_privilege(current_user, 'public.toned_rate_limits', 'INSERT') AS can_insert, has_table_privilege(current_user, 'public.toned_rate_limits', 'UPDATE') AS can_update, has_table_privilege(current_user, 'public.toned_rate_limits', 'DELETE') AS can_delete, has_function_privilege(current_user, 'public.toned_consume_capacity(text,text,integer,integer,integer,integer)', 'EXECUTE') AS can_execute");
      if (!permissions || !Object.values(permissions).every((value) => value === true)) throw new Error('Required SQL permissions are missing');
      emit(stage, { pass: true });

      stage = 'health-handler';
      const healthResponse = response();
      health({ method: 'GET' }, healthResponse);
      emit(stage, { pass: healthResponse.statusCode === 200 && healthResponse.body.protectionStore === 'neon', status: healthResponse.statusCode, mode: healthResponse.body.mode, configured: healthResponse.body.configured, providerConfigured: healthResponse.body.providerConfigured, protectionConfigured: healthResponse.body.protectionConfigured, protectionStore: healthResponse.body.protectionStore });
      if (healthResponse.statusCode !== 200) process.exitCode = 1;

      if (process.argv.includes('--exercise-guard')) {
        stage = 'real-neon-request-guard';
        // This explicit option consumes one real request-counter allowance.
        // No document or raw IP is sent to PostgreSQL by the application guard.
        const guardResponse = response();
        const allowed = await guardApiRequest({ method: 'POST', headers: { host: 'localhost:5182', origin: 'http://localhost:5182' }, socket: { remoteAddress: '192.0.2.199' }, body: { stage: 'extract', job: { source_text: 'Synthetic Neon verification document.' } } }, guardResponse, {
          billable: true,
          env: { ...process.env, NODE_ENV: 'production', RATE_LIMIT_STORE: 'neon', VERCEL: '0', VERCEL_ENV: '' },
        });
        emit(stage, { pass: allowed, status: guardResponse.statusCode, code: guardResponse.body?.code });
        if (!allowed) process.exitCode = 1;
      }
    }
  }
} catch (error) {
  // Errors can contain complete connection strings or upstream response bodies.
  // Only a PostgreSQL SQLSTATE is safe to include; never print error.message.
  emit(stage, { pass: false, sqlState: /^[0-9A-Z]{5}$/.test(error?.code || '') ? error.code : undefined, error: 'Verification failed; inspect credentials, networking, schema, and permissions securely.' });
  process.exitCode = 1;
}
