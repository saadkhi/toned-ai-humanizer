import { neon } from '@neondatabase/serverless';

function unquote(value) {
  const quote = value[0];
  if (quote !== "'" && quote !== '"') return value;
  if (value.at(-1) !== quote) return null;
  const inner = value.slice(1, -1);
  return inner.includes(quote) ? null : inner;
}

/** Parse common clipboard formats as data, never as a shell command. */
function normalizeConnectionValue(value) {
  const trimmed = value.trim();
  if (/[\r\n]/.test(trimmed)) return null;
  let candidate = unquote(trimmed);
  if (candidate === null) return null;
  const assignment = /^(?:DATABASE_URL|NEON_DATABASE_URL)=/.exec(candidate);
  if (assignment) {
    candidate = unquote(candidate.slice(assignment[0].length).trim());
    if (candidate === null) return null;
  }
  if (/^psql(?:[\t ]|$)/.test(candidate)) {
    const argument = candidate.slice(4).trim();
    // Only one literal URI is supported. Flags, pipelines, substitutions and
    // command suffixes are invalid; ordinary URI query ampersands stay intact.
    if (/[;|`<>]/.test(argument) || /&&|\$\(|\$\{/.test(argument) || argument.endsWith('&')) return null;
    candidate = unquote(argument);
    if (candidate === null || /['"]/.test(candidate)) return null;
  }
  return !candidate || /\s/.test(candidate) ? null : candidate;
}

function inspectNeonConfiguration(env) {
  const value = [env.NEON_DATABASE_URL, env.DATABASE_URL]
    .find((entry) => entry != null && (typeof entry !== 'string' || entry.trim()));
  if (value === undefined) return { url: null, issue: 'neon_url_missing' };
  if (typeof value !== 'string') return { url: null, issue: 'neon_url_invalid' };
  const normalized = normalizeConnectionValue(value);
  if (!normalized) return { url: null, issue: 'neon_url_invalid' };
  try {
    const url = new URL(normalized);
    if (!['postgres:', 'postgresql:'].includes(url.protocol)
      || !/^[a-z\d-]+(?:\.[a-z\d-]+)*\.neon\.tech$/i.test(url.hostname)
      || !url.username || !url.password || !/^\/[^/]+$/.test(url.pathname)
      || (url.port && url.port !== '5432') || url.hash) return { url: null, issue: 'neon_url_invalid' };
    if (!['require', 'verify-full'].includes(url.searchParams.get('sslmode'))
      || url.searchParams.getAll('sslmode').length !== 1) return { url: null, issue: 'neon_url_requires_tls' };
    if ([...url.searchParams.keys()].some((key) => !['sslmode', 'channel_binding'].includes(key))
      || url.searchParams.getAll('channel_binding').length > 1
      || (url.searchParams.has('channel_binding')
        && !['require', 'prefer'].includes(url.searchParams.get('channel_binding')))) return { url: null, issue: 'neon_url_unsupported_parameters' };
    return { url: normalized, issue: null };
  } catch {
    return { url: null, issue: 'neon_url_invalid' };
  }
}

/** Validate the destination before sending a database connection credential. */
export function neonDatabaseUrl(env = process.env) {
  return inspectNeonConfiguration(env).url;
}

/** Safe setup diagnostics only: never return a URI, credential, or input fragment. */
export function neonConfigurationIssue(env = process.env) {
  return inspectNeonConfiguration(env).issue;
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
