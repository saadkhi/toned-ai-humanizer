import { createHash } from 'node:crypto';
import { isIP } from 'node:net';
import { neonConfigurationIssue, neonDatabaseUrl, neonLimit } from './_neon.js';

const MAX_BODY_BYTES = 1024 * 1024;
const localCounters = new Map();

function boundedInteger(value, fallback, minimum, maximum) {
  const number = Number(value);
  return Number.isInteger(number) && number >= minimum && number <= maximum ? number : fallback;
}

function redisUrl(value) {
  if (!value) return null;
  try {
    const url = new URL(value);
    // This integration sends a secret in an Authorization header. Only send it
    // to an HTTPS Upstash REST endpoint, never to an arbitrary configured URL.
    if (url.protocol !== 'https:' || !url.hostname.endsWith('.upstash.io') ||
        url.username || url.password || url.port || url.search || url.hash || url.pathname !== '/') return null;
    return url.origin;
  } catch {
    return null;
  }
}

export function getSecurityConfig(env = process.env) {
  const production = env.NODE_ENV === 'production' || env.VERCEL === '1' ||
    env.VERCEL_ENV === 'production' || env.VERCEL_ENV === 'preview';
  const requestedStore = env.RATE_LIMIT_STORE?.trim() || 'auto';
  const hasRedis = Boolean(env.UPSTASH_REDIS_REST_URL || env.UPSTASH_REDIS_REST_TOKEN);
  const hasNeon = Boolean(env.NEON_DATABASE_URL || env.DATABASE_URL);
  // Existing partial Redis settings still fail closed in auto mode. Choosing
  // Neon explicitly permits a deliberate migration without touching old keys.
  const store = requestedStore === 'auto'
    ? hasRedis ? 'upstash' : hasNeon ? 'neon' : 'memory'
    : ['upstash', 'neon'].includes(requestedStore) ? requestedStore : null;
  const durableConfigured = store === 'upstash'
    ? Boolean(redisUrl(env.UPSTASH_REDIS_REST_URL?.trim()) && env.UPSTASH_REDIS_REST_TOKEN?.trim())
    : store === 'neon' && Boolean(neonDatabaseUrl(env));
  const requiresDurable = production || requestedStore !== 'auto' || hasRedis || hasNeon;
  const protectionIssue = !requiresDurable || durableConfigured ? null
    : store === 'neon' ? neonConfigurationIssue(env)
      : store === 'upstash' ? 'upstash_not_configured'
        : store === null ? 'rate_limit_store_invalid' : 'rate_limit_store_missing';
  return {
    production,
    store,
    requiresDurable,
    durableConfigured,
    protectionIssue,
    rateLimit: boundedInteger(env.RATE_LIMIT_REQUESTS, 60, 1, 300),
    windowSeconds: boundedInteger(env.RATE_LIMIT_WINDOW_SECONDS, 600, 60, 3600),
    dailyLimit: boundedInteger(env.DAILY_STAGE_LIMIT, 1000, 1, 100000),
  };
}

function reply(res, status, code, error, retryAfter) {
  if (retryAfter) res.setHeader?.('Retry-After', String(retryAfter));
  res.status(status).json({ error, code });
  return false;
}

function header(req, name) {
  const value = req.headers?.[name];
  return typeof value === 'string' ? value : '';
}

function sameOrigin(req) {
  if (header(req, 'sec-fetch-site') === 'cross-site') return false;
  const origin = header(req, 'origin');
  if (!origin) return true; // Non-browser clients have no Origin; rate limits still apply.
  try {
    const url = new URL(origin);
    return ['http:', 'https:'].includes(url.protocol) && url.origin === origin &&
      url.host.toLowerCase() === header(req, 'host').toLowerCase();
  } catch {
    return false;
  }
}

function clientIdentity(req, env) {
  // Never trust caller-supplied forwarding headers on a self-hosted server.
  // Vercel normalizes X-Forwarded-For at its edge. Taking the rightmost address
  // also avoids trusting an attacker-controlled prefix in an appended chain.
  let address = env.VERCEL === '1'
    ? header(req, 'x-forwarded-for').split(',').at(-1)?.trim()
    : req.socket?.remoteAddress;
  if (!isIP(address || '')) address = 'unknown';
  if (address.startsWith('::ffff:') && isIP(address.slice(7)) === 4) address = address.slice(7);
  return createHash('sha256').update(address).digest('hex');
}

// Check and increment both budgets atomically. Rejected requests do not consume
// the global budget, and every accepted request counts, including model errors.
const LIMIT_SCRIPT = `
local client = tonumber(redis.call('GET', KEYS[1]) or '0')
local global = tonumber(redis.call('GET', KEYS[2]) or '0')
if client >= tonumber(ARGV[1]) then return {0, tonumber(ARGV[3]), 1} end
if global >= tonumber(ARGV[2]) then return {0, tonumber(ARGV[4]), 2} end
if redis.call('INCR', KEYS[1]) == 1 then redis.call('EXPIRE', KEYS[1], ARGV[3]) end
if redis.call('INCR', KEYS[2]) == 1 then redis.call('EXPIRE', KEYS[2], ARGV[4]) end
return {1, 0, 0}
`;

async function durableLimit(config, env, keys, ttl, fetchImpl) {
  const response = await fetchImpl(redisUrl(env.UPSTASH_REDIS_REST_URL.trim()), {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.UPSTASH_REDIS_REST_TOKEN.trim()}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(['EVAL', LIMIT_SCRIPT, '2', ...keys,
      String(config.rateLimit), String(config.dailyLimit), ...ttl.map(String)]),
    signal: AbortSignal.timeout(5000),
    redirect: 'error',
  });
  if (!response.ok) throw new Error('Limiter unavailable');
  const data = await response.json();
  if (data.error) throw new Error('Invalid limiter response');
  return data.result;
}

function validLimitResult(result) {
  return Array.isArray(result) && result.length === 3 && result.every(Number.isInteger)
    && (result[0] === 1 ? result[1] === 0 && result[2] === 0
      : result[0] === 0 && result[1] > 0 && result[1] <= 86400 && [1, 2].includes(result[2]));
}

function localLimit(config, keys, ttl, now) {
  for (const [key, counter] of localCounters) {
    if (counter.expires <= now) localCounters.delete(key);
  }
  const counts = keys.map(key => localCounters.get(key)?.count || 0);
  if (counts[0] >= config.rateLimit) return [0, ttl[0], 1];
  if (counts[1] >= config.dailyLimit) return [0, ttl[1], 2];
  if (localCounters.size > 10000) throw new Error('Local limiter capacity reached');
  keys.forEach((key, index) => localCounters.set(key, {
    count: counts[index] + 1,
    expires: now + ttl[index] * 1000,
  }));
  return [1, 0, 0];
}

/**
 * Return true to continue or false after sending a safe JSON error response.
 * Call once per API stage, after input validation and before any provider call.
 * Production never falls back to process-local counters: serverless workers
 * require a shared Upstash or Neon store to enforce per-client and daily budgets.
 */
export async function guardApiRequest(req, res, {
  billable = false,
  env = process.env,
  now = Date.now(),
  fetchImpl = globalThis.fetch,
} = {}) {
  res.setHeader?.('Cache-Control', 'no-store');
  res.setHeader?.('X-Content-Type-Options', 'nosniff');
  if (req.method === 'POST' && !sameOrigin(req)) {
    return reply(res, 403, 'origin_not_allowed', 'This request is not allowed from another website.');
  }

  try {
    const length = header(req, 'content-length');
    if (length && (!/^\d+$/.test(length) || Number(length) > MAX_BODY_BYTES)) {
      return reply(res, 413, 'request_too_large', 'This request is too large. Try a shorter document.');
    }
    const body = typeof req.body === 'string' ? req.body : JSON.stringify(req.body ?? null);
    if (Buffer.byteLength(body) > MAX_BODY_BYTES) {
      return reply(res, 413, 'request_too_large', 'This request is too large. Try a shorter document.');
    }
  } catch {
    return reply(res, 400, 'invalid_request', 'The request body could not be read.');
  }

  if (!billable) return true;
  const config = getSecurityConfig(env);
  if (config.requiresDurable && !config.durableConfigured) {
    return reply(res, 503, 'rate_limit_unavailable', 'Rewriting is temporarily unavailable. Please try again later.');
  }

  const seconds = Math.floor(now / 1000);
  const keys = [
    `toned:stage:v1:client:${clientIdentity(req, env)}:${Math.floor(seconds / config.windowSeconds)}`,
    `toned:stage:v1:global:${Math.floor(seconds / 86400)}`,
  ];
  const ttl = [config.windowSeconds - seconds % config.windowSeconds, 86400 - seconds % 86400];
  try {
    const result = config.store === 'neon'
      ? await neonLimit(config, env, keys, ttl)
      : config.durableConfigured
        ? await durableLimit(config, env, keys, ttl, fetchImpl)
        : localLimit(config, keys, ttl, now);
    if (!validLimitResult(result)) throw new Error('Invalid limiter response');
    if (!result[0]) {
      return reply(res, 429, result[2] === 2 ? 'daily_limit_reached' : 'rate_limit_reached',
        result[2] === 2
          ? 'Today’s rewrite capacity has been reached. Please try again tomorrow.'
          : 'Too many rewrite requests. Please wait before trying again.', result[1]);
    }
    return true;
  } catch (error) {
    // Whitelist SQLSTATE classifications, never upstream messages, connection
    // strings, database names, or credentials. This helps site setup without
    // exposing the database response or falling back to weaker limits.
    if (config.store === 'neon') {
      if (['42P01', '42883'].includes(error?.code)) {
        return reply(res, 503, 'rate_limit_schema_missing', 'The site’s database setup is incomplete. Please contact the site owner.');
      }
      if (error?.code === '28P01') {
        return reply(res, 503, 'rate_limit_database_auth_failed', 'The site’s database credentials need updating. Please contact the site owner.');
      }
      if (error?.code === '42501') {
        return reply(res, 503, 'rate_limit_database_permission_denied', 'The site’s database permissions need updating. Please contact the site owner.');
      }
    }
    return reply(res, 503, 'rate_limit_unavailable', 'Rewriting is temporarily unavailable. Please try again later.');
  }
}
