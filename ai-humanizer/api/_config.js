import { createHash } from 'node:crypto';
import { KeyPool } from './_pipeline.js';

// One current pool per provider in this server process; credentials never form map keys.
const runtimePools = new Map();

function positiveInt(value, fallback, maximum) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? Math.min(number, maximum) : fallback;
}

function readProviderConfig(env, createPool) {
  const keys = (name) => [...new Set(
    [env[`${name}_API_KEY_1`], env[`${name}_API_KEY`], env[`${name}_API_KEY_2`], env[`${name}_API_KEY_3`]]
      .filter((key) => typeof key === 'string' && key.trim()).map((key) => key.trim()),
  )];
  const accountIds = { cloudflare: env.CLOUDFLARE_ACCOUNT_ID?.trim() };
  const model = (name, tier, fallback) => env[`${name}_MODEL_${tier}`]?.trim() || fallback;
  const models = {
    google: { fast: model('GOOGLE', 'FAST', 'gemini-2.5-flash'), quality: model('GOOGLE', 'QUALITY', 'gemini-2.5-pro') },
    openrouter: { fast: model('OPENROUTER', 'FAST', 'google/gemini-2.5-flash'), quality: model('OPENROUTER', 'QUALITY', 'google/gemini-2.5-pro') },
    sambanova: { fast: model('SAMBANOVA', 'FAST', 'Meta-Llama-3.3-70B-Instruct'), quality: model('SAMBANOVA', 'QUALITY', 'Meta-Llama-3.3-70B-Instruct') },
    cloudflare: { fast: model('CLOUDFLARE', 'FAST', '@cf/meta/llama-3.1-8b-instruct'), quality: model('CLOUDFLARE', 'QUALITY', '@cf/meta/llama-3.1-70b-instruct') },
  };
  const pools = Object.fromEntries(Object.keys(models).map((provider) => [
    provider,
    createPool(provider, provider === 'cloudflare' && !accountIds.cloudflare ? [] : keys(provider.toUpperCase()), models[provider], accountIds[provider]),
  ]));
  const providers = Object.keys(pools).filter((name) => pools[name].size > 0);
  return {
    pools, models, providers,
    configured: providers.length > 0,
    accountIds,
    maxInputChars: positiveInt(env.MAX_INPUT_CHARS, 20000, 120000),
    maxJobTokens: positiveInt(env.MAX_JOB_TOKENS, 400000, 1000000),
  };
}

/** Read only server environment variables. Each call has fresh, independent pools. */
export function loadProviderConfig(env = process.env) {
  return readProviderConfig(env, (_provider, keys) => new KeyPool(keys));
}

/** Reuse rotation and failure state while a provider's effective configuration is unchanged. */
export function getProviderConfig(env = process.env) {
  return readProviderConfig(env, (provider, keys, models, accountId) => {
    if (!keys.length) {
      runtimePools.delete(provider);
      return new KeyPool();
    }
    // A digest avoids retaining a second plaintext copy of credentials in cache metadata.
    const binding = createHash('sha256').update(JSON.stringify([keys, models, accountId ?? null])).digest('hex');
    let cached = runtimePools.get(provider);
    if (!cached || cached.binding !== binding) {
      cached = { binding, pool: new KeyPool(keys) };
      runtimePools.set(provider, cached);
    }
    return cached.pool;
  });
}
