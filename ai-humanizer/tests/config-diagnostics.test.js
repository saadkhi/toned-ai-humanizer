import test from 'node:test';
import assert from 'node:assert/strict';
import { loadProviderConfig, getProviderConfig } from '../api/_config.js';

test('Cloudflare readiness requires its documented account ID format, not merely a nonempty value', () => {
  for (const accountId of [undefined, '', ' ', 'a-key-is-not-an-account', 'a'.repeat(31), 'a'.repeat(33), 'g'.repeat(32)]) {
    const config = loadProviderConfig({ AI_PROVIDER_MODE: 'configured', CLOUDFLARE_API_KEY: 'synthetic-test-key', CLOUDFLARE_ACCOUNT_ID: accountId });
    assert.equal(config.configured, false);
    assert.equal(config.pools.cloudflare.size, 0);
    assert.equal(config.accountIds.cloudflare, undefined);
    assert.deepEqual(config.providers, []);
  }
});

test('valid Cloudflare IDs permit configuration while other providers remain usable with an invalid ID', () => {
  const valid = loadProviderConfig({ AI_PROVIDER_MODE: 'configured', CLOUDFLARE_API_KEY: 'synthetic-test-key', CLOUDFLARE_ACCOUNT_ID: ' AABBCCDDEEFF00112233445566778899 ' });
  assert.equal(valid.configured, true);
  assert.equal(valid.accountIds.cloudflare, 'AABBCCDDEEFF00112233445566778899');
  assert.deepEqual(valid.providers, ['cloudflare']);
  const fallback = loadProviderConfig({ AI_PROVIDER_MODE: 'configured', GOOGLE_API_KEY: 'synthetic-google-key', CLOUDFLARE_API_KEY: 'synthetic-test-key', CLOUDFLARE_ACCOUNT_ID: 'not-an-account' });
  assert.equal(fallback.configured, true);
  assert.deepEqual(fallback.providers, ['google']);
});

test('changing a valid Cloudflare binding to an invalid ID disables its cached pool', () => {
  const env = { AI_PROVIDER_MODE: 'configured', CLOUDFLARE_API_KEY: 'synthetic-rotation-key', CLOUDFLARE_ACCOUNT_ID: '11111111111111111111111111111111' };
  assert.equal(getProviderConfig(env).pools.cloudflare.size, 1);
  assert.equal(getProviderConfig({ ...env, CLOUDFLARE_ACCOUNT_ID: 'unusable' }).pools.cloudflare.size, 0);
  const restored = getProviderConfig(env);
  assert.equal(restored.pools.cloudflare.size, 1);
  assert.deepEqual(restored.providers, ['cloudflare']);
});

const allProviderKeys = {
  GOOGLE_API_KEY: 'synthetic-free-google', OPENROUTER_API_KEY: 'synthetic-free-router',
  SAMBANOVA_API_KEY: 'synthetic-free-samba', CLOUDFLARE_API_KEY: 'synthetic-free-cloudflare',
  CLOUDFLARE_ACCOUNT_ID: '11111111111111111111111111111111',
};

test('default free mode selects only OpenRouter with free models for both tiers', () => {
  const config = loadProviderConfig(allProviderKeys);
  assert.equal(config.mode, 'free');
  assert.equal(config.configured, true);
  assert.deepEqual(config.providers, ['openrouter']);
  assert.deepEqual(config.models.openrouter, { fast: 'openrouter/free', quality: 'openrouter/free' });
  for (const provider of ['google', 'sambanova', 'cloudflare']) {
    assert.equal(config.pools[provider].size, 0);
    assert.equal(config.pools[provider].next(), null);
  }
});

test('free mode ignores paid tier overrides and accepts only free model selections', () => {
  const paidOverrides = {
    ...allProviderKeys, GOOGLE_MODEL_FAST: 'paid/google-model', GOOGLE_MODEL_QUALITY: 'paid/google-quality',
    OPENROUTER_MODEL_FAST: 'openrouter/auto', OPENROUTER_MODEL_QUALITY: 'google/gemini-2.5-pro',
  };
  assert.deepEqual(loadProviderConfig(paidOverrides).models.openrouter, { fast: 'openrouter/free', quality: 'openrouter/free' });
  const custom = loadProviderConfig({ ...paidOverrides, OPENROUTER_FREE_MODEL: ' vendor/synthetic-model:free ' });
  assert.equal(custom.configured, true);
  assert.deepEqual(custom.models.openrouter, { fast: 'vendor/synthetic-model:free', quality: 'vendor/synthetic-model:free' });
  for (const model of ['openrouter/auto', 'google/gemini-2.5-pro', 'vendor/model:free-extra', 'vendor/model:FREE', 'vendor/model :free']) {
    const invalid = loadProviderConfig({ ...paidOverrides, OPENROUTER_FREE_MODEL: model });
    assert.equal(invalid.mode, 'free');
    assert.equal(invalid.configured, false);
    assert.deepEqual(invalid.providers, []);
    assert.ok(Object.values(invalid.pools).every(pool => pool.size === 0));
  }
});

test('free mode is unavailable without an OpenRouter key even when other provider keys exist', () => {
  const config = loadProviderConfig({ ...allProviderKeys, OPENROUTER_API_KEY: undefined });
  assert.equal(config.mode, 'free');
  assert.equal(config.configured, false);
  assert.deepEqual(config.providers, []);
});

test('only explicit configured mode enables paid providers and tier overrides', () => {
  const config = loadProviderConfig({ ...allProviderKeys, AI_PROVIDER_MODE: 'configured', OPENROUTER_MODEL_FAST: 'synthetic-paid-fast', OPENROUTER_MODEL_QUALITY: 'synthetic-paid-quality' });
  assert.equal(config.mode, 'configured');
  assert.deepEqual(config.providers, ['google', 'openrouter', 'sambanova', 'cloudflare']);
  assert.deepEqual(config.models.openrouter, { fast: 'synthetic-paid-fast', quality: 'synthetic-paid-quality' });
  for (const value of [undefined, '', 'free', 'paid', 'CONFIGURED', 'typo']) {
    const safe = loadProviderConfig({ ...allProviderKeys, AI_PROVIDER_MODE: value });
    assert.equal(safe.mode, 'free');
    assert.deepEqual(safe.providers, ['openrouter']);
  }
});
