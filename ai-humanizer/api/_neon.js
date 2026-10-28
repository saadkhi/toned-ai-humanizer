import { neon } from '@neondatabase/serverless';

/** Validate the destination before sending a database connection credential. */
export function neonDatabaseUrl(env = process.env) {
  const value = env.NEON_DATABASE_URL?.trim() || env.DATABASE_URL?.trim();
  if (!value) return null;
  try {
    const url = new URL(value);
    if (!['postgres:', 'postgresql:'].includes(url.protocol)
      || !/^[a-z\d-]+(?:\.[a-z\d-]+)*\.neon\.tech$/i.test(url.hostname)
      || !url.username || !url.password || !/^\/[^/]+$/.test(url.pathname)
      || (url.port && url.port !== '5432') || url.hash
      || !['require', 'verify-full'].includes(url.searchParams.get('sslmode'))
      || url.searchParams.getAll('sslmode').length !== 1
      || [...url.searchParams.keys()].some((key) => !['sslmode', 'channel_binding'].includes(key))
      || url.searchParams.getAll('channel_binding').length > 1
      || (url.searchParams.has('channel_binding')
        && !['require', 'prefer'].includes(url.searchParams.get('channel_binding')))) return null;
    return value;
  } catch {
    return null;
  }
}

/** One server-side SQL function consumes both budgets in the same transaction. */
export async function neonLimit(config, env, keys, ttl) {
  const connectionString = neonDatabaseUrl(env);
  if (!connectionString) throw new Error('Neon limiter is not configured');
  const sql = neon(connectionString, {
    // Free computes may need to wake. Keep the entire response read bounded and
    // never forward the credential-bearing header to a redirect destination.
    fetchOptions: { signal: AbortSignal.timeout(15000), redirect: 'error' },
  });
  const rows = await sql`
    SELECT public.toned_consume_capacity(
      ${keys[0]}::text, ${keys[1]}::text,
      ${config.rateLimit}::integer, ${config.dailyLimit}::integer,
      ${ttl[0]}::integer, ${ttl[1]}::integer
    ) AS result
  `;
  if (!Array.isArray(rows) || rows.length !== 1) throw new Error('Invalid limiter response');
  return rows[0].result;
}
