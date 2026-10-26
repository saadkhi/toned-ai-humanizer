/**
 * Shared pipeline utilities for Vercel API routes.
 * Bounded provider calls, structured responses, and factual consistency checks.
 */

// ─── LLM Error ────────────────────────────────────────────────────────────────

export class LLMError extends Error {
  constructor(message, code, status) {
    super(message);
    this.name = 'LLMError';
    this.code = code || 'llm_error';
    this.status = status || 502;
  }
}

// ─── Key Pool ─────────────────────────────────────────────────────────────────
//
// Round-robins across a list of API keys for a single provider.
// On 429 or timeout the caller marks the key as failed; the pool then skips it
// (up to 3 consecutive failures) and hands out the next available key.
//
// Usage:
//   const pool = new KeyPool(['key1', 'key2', 'key3']);
//   const key  = pool.next();       // advances the cursor each call
//   pool.markFailed(key);           // deprioritises this key
//   pool.markSuccess(key);          // resets its failure counter
//
export class KeyPool {
  constructor(keys = []) {
    this._keys = [...new Set(keys.filter((key) => typeof key === 'string' && key.trim()).map((key) => key.trim()))];
    this._index = 0;
    this._failures = {};
  }

  get size() {
    return this._keys.length;
  }

  next() {
    if (!this._keys.length) return null;
    const total = this._keys.length;
    for (let i = 0; i < total; i++) {
      const key = this._keys[this._index % total];
      this._index = (this._index + 1) % total;
      if ((this._failures[key] || 0) < 3) return key;
    }
    // All keys have recent failures — reset counters and return first key anyway.
    this._failures = {};
    return this._keys[0];
  }

  markFailed(key) {
    this._failures[key] = (this._failures[key] || 0) + 1;
  }

  markSuccess(key) {
    this._failures[key] = 0;
  }
}

// Each model call has a bounded total budget, including response-body reads and retries.
// Two model calls can occur in a stage; the default keeps both below Vercel's 300s limit.
function boundedInt(value, fallback, min, max) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(min, Math.min(max, Math.floor(number))) : fallback;
}

export function requestLimits(env = process.env) {
  return {
    timeout: boundedInt(env.LLM_REQUEST_TIMEOUT_MS, 60000, 100, 60000),
    total: boundedInt(env.LLM_TOTAL_TIMEOUT_MS, 120000, 100, 120000),
    attempts: boundedInt(env.LLM_MAX_ATTEMPTS, 2, 1, 4),
  };
}

async function postJson(url, options, timeout) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    // A provider redirect must never forward custom credential headers elsewhere.
    const response = await fetch(url, { ...options, redirect: 'error', signal: controller.signal });
    if (!response.ok) {
      // Never forward upstream bodies: they may echo credentials, prompts, or source text.
      const retryable = response.status === 429 || response.status >= 500;
      throw new LLMError(
        retryable ? 'The AI provider is temporarily unavailable. Please retry.'
          : 'The AI provider rejected the request. Check the server credentials and model configuration.',
        retryable ? 'upstream_unavailable' : 'request_rejected',
        retryable ? 503 : 502,
      );
    }
    try {
      return await response.json();
    } catch (error) {
      if (controller.signal.aborted) throw error;
      throw new LLMError('The AI provider returned an invalid response.', 'invalid_response', 502);
    }
  } catch (error) {
    if (error instanceof LLMError) throw error;
    throw new LLMError(
      controller.signal.aborted ? 'The AI provider timed out. Please retry.' : 'Unable to reach the AI provider. Please retry.',
      controller.signal.aborted ? 'timeout' : 'network_error',
      controller.signal.aborted ? 504 : 503,
    );
  } finally {
    clearTimeout(timer);
  }
}

function verifyText(text, finishReason) {
  if (['MAX_TOKENS', 'length'].includes(finishReason)) {
    throw new LLMError('The AI response was cut off. Try a shorter document.', 'truncated_response', 502);
  }
  if (typeof text !== 'string' || !text.trim()) {
    throw new LLMError('The AI provider returned no usable text.', 'empty_response', 502);
  }
  return text.trim();
}

async function callGoogle({ key, model, system, user, maxTokens, json, timeout }) {
  const payload = await postJson(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: system }] },
        contents: [{ role: 'user', parts: [{ text: user }] }],
        generationConfig: {
          maxOutputTokens: maxTokens || 4000,
          temperature: json ? 0 : 0.2,
          ...(json ? { responseMimeType: 'application/json' } : {}),
        },
      }),
    },
    timeout,
  );
  const candidate = payload.candidates?.[0];
  const text = (candidate?.content?.parts || [])
    .filter((part) => !part.thought)
    .map((part) => typeof part.text === 'string' ? part.text : '').join('');
  return {
    text: verifyText(text, candidate?.finishReason),
    inputTokens: payload.usageMetadata?.promptTokenCount || 0,
    outputTokens: payload.usageMetadata?.candidatesTokenCount || 0,
  };
}

async function callChat({ provider, key, model, system, user, maxTokens, json, timeout }) {
  const endpoint = provider === 'openrouter'
    ? 'https://openrouter.ai/api/v1/chat/completions'
    : 'https://api.sambanova.ai/v1/chat/completions';
  const payload = await postJson(endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model,
      messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
      max_tokens: maxTokens || 4000,
      temperature: json ? 0 : 0.2,
      ...(json ? { response_format: { type: 'json_object' } } : {}),
    }),
  }, timeout);
  return {
    text: verifyText(payload.choices?.[0]?.message?.content, payload.choices?.[0]?.finish_reason),
    inputTokens: payload.usage?.prompt_tokens || 0,
    outputTokens: payload.usage?.completion_tokens || 0,
  };
}

async function callCloudflare({ key, model, system, user, maxTokens, accountId, json, timeout }) {
  if (!accountId) throw new LLMError('Cloudflare account configuration is missing.', 'no_account_id', 503);
  const payload = await postJson(
    `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(accountId)}/ai/run/${model}`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
      body: JSON.stringify({
        messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
        max_tokens: maxTokens || 4000,
        temperature: json ? 0 : 0.2,
        ...(json ? { response_format: { type: 'json_object' } } : {}),
      }),
    }, timeout,
  );
  if (payload.success === false) throw new LLMError('The AI provider returned an invalid response.', 'invalid_response', 502);
  return {
    text: verifyText(payload.result?.response),
    inputTokens: payload.result?.usage?.prompt_tokens || 0,
    outputTokens: payload.result?.usage?.completion_tokens || 0,
  };
}

export async function pooledComplete({
  pools, models, accountIds = {}, tier = 'fast', system, user, maxTokens, json = false,
}) {
  const order = tier === 'fast'
    ? ['sambanova', 'google', 'openrouter', 'cloudflare']
    : ['google', 'openrouter', 'sambanova', 'cloudflare'];
  const available = order.filter((provider) => pools[provider]?.size > 0);
  if (!available.length) throw new LLMError('AI rewriting is not configured on this server.', 'no_keys', 503);

  const limits = requestLimits();
  const deadline = Date.now() + limits.total;
  let lastError;
  for (let attempt = 0; attempt < limits.attempts; attempt++) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) break;
    const provider = available[attempt % available.length];
    const pool = pools[provider];
    const model = models[provider]?.[tier];
    if (!model) {
      lastError = new LLMError('The server has no model configured for this stage.', 'no_model', 503);
      continue;
    }
    const key = pool.next();
    const options = { key, model, system, user, maxTokens, json, timeout: Math.min(remaining, limits.timeout) };
    const started = Date.now();
    try {
      let result;
      if (provider === 'google') result = await callGoogle(options);
      else if (provider === 'cloudflare') result = await callCloudflare({ ...options, accountId: accountIds.cloudflare });
      else result = await callChat({ ...options, provider });
      pool.markSuccess(key);
      return { ...result, model: `${provider}/${model}`, latencyMs: Date.now() - started };
    } catch (error) {
      pool.markFailed(key);
      lastError = error instanceof LLMError ? error : new LLMError('The AI request failed.', 'provider_error', 502);
      if (attempt < limits.attempts - 1 && lastError.code !== 'request_rejected') {
        const delay = Math.min(250 * (attempt + 1), Math.max(0, deadline - Date.now()));
        if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }
  throw lastError || new LLMError('The AI request timed out.', 'timeout', 504);
}

function extractJson(text) {
  const fenced = text.match(/^\s*```(?:json)?\s*([\s\S]*?)```\s*$/);
  const data = JSON.parse(fenced ? fenced[1] : text.trim());
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Object required');
  return data;
}

export async function runJsonStagePooled({ validate, ...options }) {
  const result = await pooledComplete({ ...options, json: true });
  let data;
  try {
    data = extractJson(result.text);
  } catch {
    throw new LLMError('The AI provider returned invalid structured output. Please retry.', 'invalid_json', 502);
  }
  try {
    if (validate) {
      const validated = validate(data);
      if (validated === false) throw new Error('Invalid schema');
      if (validated && typeof validated === 'object') data = validated;
    }
  } catch (error) {
    if (error instanceof LLMError) throw error;
    throw new LLMError('The AI response did not meet the required format. Please retry.', 'invalid_schema', 502);
  }
  return {
    data,
    usage: { inputTokens: result.inputTokens, outputTokens: result.outputTokens },
    model: result.model,
  };
}

// ─── Text utilities ───────────────────────────────────────────────────────────

export function wordCount(text) {
  return String(text || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;
}

export function wrapUserText(text) {
  // Source content cannot close its own data boundary or introduce another tag.
  const escaped = String(text ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return `<text>\n${escaped}\n</text>`;
}

export function splitChunks(text, chunkWords = 800) {
  if (!Number.isSafeInteger(chunkWords) || chunkWords < 1) throw new RangeError('chunkWords must be a positive integer');
  const source = String(text || '');
  const words = [...source.matchAll(/\S+/g)];
  if (!words.length) return [];

  // Treat entire fenced blocks as indivisible source spans. Splitting a fence would
  // turn its later lines into prose and can change the program being documented.
  const fences = [];
  const opening = /^ {0,3}(`{3,}|~{3,})[^\n]*(?:\n|$)/gm;
  let match;
  while ((match = opening.exec(source))) {
    const marker = match[1];
    const closing = new RegExp(`^ {0,3}${marker[0]}{${marker.length},}[\\t ]*(?:\\r?\\n|$)`, 'gm');
    closing.lastIndex = opening.lastIndex;
    const close = closing.exec(source);
    const end = close ? closing.lastIndex : source.length;
    const content = source.slice(match.index, end);
    if (wordCount(content) > chunkWords) {
      throw new LLMError('A fenced code block is too large to rewrite safely. Shorten the code block or process it separately.', 'code_block_too_large', 413);
    }
    fences.push({ start: match.index, end });
    opening.lastIndex = end;
  }

  const chunks = [];
  let cursor = 0;
  let wordIndex = 0;
  while (cursor < source.length) {
    while (wordIndex < words.length && words[wordIndex].index < cursor) wordIndex++;
    const nextIndex = wordIndex + chunkWords;
    let end = nextIndex < words.length ? words[nextIndex].index : source.length;
    if (end < source.length) {
      // Prefer an existing paragraph or line boundary, then a sentence boundary.
      // Slice the original text rather than rebuilding words: keep every space,
      // line break, heading, list marker, and code character in the source span.
      const minimum = words[Math.min(words.length - 1, wordIndex + Math.floor(chunkWords / 2))].index;
      const paragraph = source.lastIndexOf('\n\n', end - 1);
      const line = source.lastIndexOf('\n', end - 1);
      if (paragraph >= minimum) end = paragraph + 2;
      else if (line >= minimum) end = line + 1;
      else {
        for (let index = nextIndex - 1; index >= wordIndex + Math.floor(chunkWords / 2); index--) {
          if (/[.!?]["'’”)]?$/.test(words[index][0])) {
            end = words[index + 1]?.index ?? source.length;
            break;
          }
        }
      }
      const containing = fences.find((fence) => fence.start < end && fence.end > end);
      if (containing) {
        // If the code starts this chunk it fits by the check above; otherwise
        // leave the complete code block for the following chunk.
        end = containing.start > cursor ? containing.start : containing.end;
      }
    }
    if (end <= cursor) throw new LLMError('This document cannot be divided safely.', 'invalid_chunk_boundary', 422);
    const chunk = source.slice(cursor, end);
    chunks.push({ index: chunks.length, text: chunk, words: wordCount(chunk), start: cursor, end });
    cursor = end;
  }
  return chunks;
}

// ─── Cost estimation ──────────────────────────────────────────────────────────

const PRICING = {
  fast: { input: 1, output: 5 },    // per 1M tokens, USD
  quality: { input: 2, output: 10 },
};

export function estimateCost(usage, tier) {
  const p = PRICING[tier] || PRICING.fast;
  const inputCost = ((usage?.inputTokens || 0) / 1_000_000) * p.input;
  const outputCost = ((usage?.outputTokens || 0) / 1_000_000) * p.output;
  return Math.round((inputCost + outputCost) * 1e6) / 1e6;
}

// ─── Intent / safety check ────────────────────────────────────────────────────

const BLOCKED_PATTERNS = [
  /\bacademic\s*(fraud|dishonesty|cheat)\b/i,
  /\bbypass\s*(ai|plagiarism)\s*(detector|check)\b/i,
  /\bcheat\s*(on\s*(my\s*)?)?(assignment|essay|exam|test|homework)\b/i,
  /\bsubmit\s*(as\s*(my\s*)?own|without\s*attribution)\b/i,
  /\bdeceive\s*(my\s*)?(professor|teacher|instructor|grader)\b/i,
];

export function intentCheck(purpose, customStyle) {
  const combined = `${purpose || ''} ${customStyle || ''}`.toLowerCase();
  for (const pattern of BLOCKED_PATTERNS) {
    if (pattern.test(combined)) {
      return {
        blocked: true,
        reason:
          'This request appears to involve academic dishonesty or deliberate deception. Humanizer cannot assist with that.',
      };
    }
  }
  return { blocked: false };
}

// ─── Audit helpers ────────────────────────────────────────────────────────────

export function auditProblems(audit) {
  if (!audit) return [];
  const flags = [];
  for (const item of audit.items || []) {
    if (['altered', 'missing', 'added'].includes(item.status)) {
      flags.push({ kind: item.kind, value: item.value, status: item.status, note: item.note });
    }
  }
  for (const item of audit.deterministic?.failed || []) {
    if (!flags.some((flag) => flag.kind === item.kind && flag.value === item.value)) {
      flags.push({ ...item, status: item.status || 'missing' });
    }
  }
  for (const item of audit.certainty || []) {
    if (item.status !== 'none') {
      flags.push({ kind: 'certainty', value: item.marker, status: item.status, note: item.note });
    }
  }
  for (const item of audit.format_violations || []) {
    flags.push({ kind: 'format', value: item.rule, status: 'violated', note: item.note });
  }
  return flags;
}

export function summarizeAudit(audit) {
  if (!audit) return {};
  const items = audit.items || [];
  return {
    preserved: items.filter((i) => i.status === 'preserved').length,
    altered: items.filter((i) => i.status === 'altered').length,
    missing: items.filter((i) => i.status === 'missing').length,
    added: items.filter((i) => i.status === 'added').length,
    format_violations: (audit.format_violations || []).length,
    certainty_shifts: (audit.certainty || []).filter((i) => i.status !== 'none').length,
  };
}

// ─── Deterministic checks ─────────────────────────────────────────────────────

function normalizeLiteral(value) {
  return String(value ?? '').normalize('NFKC').replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/\s+/g, ' ').trim();
}

function escapePattern(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function containsLiteral(text, value, caseSensitive = false) {
  const pattern = escapePattern(value);
  // Boundaries avoid falsely preserving e.g. "12" when the rewrite says "120".
  const numeric = /^[-+]?\d/.test(value);
  const before = numeric ? '[\\p{L}\\p{N}.,+\\-]' : '[\\p{L}\\p{N}]';
  const after = numeric ? '[\\p{L}\\p{N}%]|[.,]\\d' : '[\\p{L}\\p{N}]';
  return new RegExp(`(?<!${before})${pattern}(?!${after})`, caseSensitive ? 'u' : 'iu').test(text);
}

export function deterministicChecks(extraction, rewritten, source) {
  const passed = [];
  const failed = [];
  const text = normalizeLiteral(rewritten);
  if (!extraction || !text) return { passed, failed };
  const check = (kind, value, caseSensitive = false) => {
    const literal = normalizeLiteral(value);
    if (!literal) return;
    const found = containsLiteral(text, literal, caseSensitive);
    (found ? passed : failed).push({
      kind, value: literal,
      ...(!found ? { status: 'missing', note: 'The complete original value was not found in the rewrite. Review it against the source.' } : {}),
    });
  };
  for (const number of extraction.numbers || []) check('number', number.value);
  for (const quote of extraction.quotations || []) check('quotation', quote.text, true);
  for (const entity of extraction.named_entities || []) check('entity', entity.name);
  for (const citation of extraction.citations || []) check('citation', citation.text);

  if (source) {
    const original = normalizeLiteral(source);
    // Independently inspect numeric tokens rather than trusting the model's extraction.
    const numbers = (value) => [...value.matchAll(/(?<![\p{L}\p{N}])[-+]?\d+(?:[.,]\d+)*(?:%|\b)/gu)].map((match) => match[0]);
    for (const value of new Set(numbers(original))) {
      if (!containsLiteral(text, value) && !failed.some((item) => item.kind === 'number' && item.value === value)) {
        failed.push({ kind: 'number', value, status: 'missing', note: 'A number in the original is absent from the rewrite.' });
      }
    }
    for (const value of new Set(numbers(text))) {
      if (!containsLiteral(original, value)) {
        failed.push({ kind: 'number', value, status: 'added', note: 'A number in the rewrite does not appear in the original.' });
      }
    }
  }
  return { passed, failed };
}
