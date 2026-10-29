/** Stateless rewrite stages. Provider credentials stay on the server. */
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { sourceParagraphs } from '../shared/source-text.js';
import { getProviderConfig } from './_config.js';
import { guardApiRequest } from './_security.js';
import {
  auditProblems, deterministicChecks, estimateCost, intentCheck, LLMError,
  pooledComplete, runJsonStagePooled, splitChunks, summarizeAudit, wordCount, withStructuredRetryHint, wrapUserText,
} from './_pipeline.js';
import { AI_PATTERN_CATALOG, PROMPTS, REWRITE_SYSTEM, STAGE_SCHEMAS, STYLE_MODULES } from './_prompts.js';

const VERSION = 'humanizer/4.0.0';
const CHUNK_WORDS = 800;
const STAGES = ['extract', 'diagnose', 'rewrite', 'assemble', 'audit', 'repair', 'finalize'];
const requestSchema = z.object({
  stage: z.enum(STAGES), chunk_index: z.number().int().nonnegative().default(0),
  job: z.object({
    source_text: z.string().min(1).max(120000).refine((text) => text.trim().length > 0),
    style: z.enum(['professional_researcher', 'casual_blogger', 'technical_writer', 'custom']).default('professional_researcher'),
    custom_style: z.string().max(2000).default(''), purpose: z.string().max(2000).default(''),
    length_target: z.enum(['shorter', 'same', 'longer']).default('same'),
    preserve_headings: z.boolean().default(true), preserve_lists: z.boolean().default(true),
    input_tokens: z.number().finite().nonnegative().default(0), output_tokens: z.number().finite().nonnegative().default(0),
    cost_estimate: z.number().finite().nonnegative().default(0), repair_loops: z.number().int().min(0).max(2).default(0),
    rewritten_text: z.string().max(120000).optional(), notes: z.string().max(200000).optional(),
    chunks: z.array(z.object({ index: z.number().int().nonnegative(), text: z.string().max(30000), source_words: z.number().int().nonnegative() })).max(200).optional(),
  }).passthrough(),
});

const hash = (value) => createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex');
const jobFingerprint = (job) => hash([VERSION, job.source_text, job.style, job.custom_style, job.purpose, job.length_target, job.preserve_headings, job.preserve_lists]);
const appendNote = (old, line) => [old, line].filter(Boolean).join('\n');
const constraints = (job) => `Preserve headings: ${job.preserve_headings}; preserve lists: ${job.preserve_lists}; length target: ${job.length_target}. Facts and meaning always take priority over length and style.`;
function requireState(condition, message) {
  if (!condition) throw new LLMError(message, 'invalid_stage_state', 409);
}
function parseStage(stage, data) {
  const parsed = STAGE_SCHEMAS[stage].safeParse(data);
  if (!parsed.success) {
    const issues = parsed.error.issues.slice(0, 4).map((issue) => ({
      path: issue.path,
      expected: issue.code === 'invalid_type' ? issue.expected === 'int' ? 'integer' : issue.expected : issue.code === 'invalid_value' ? 'enum'
        : ['too_small', 'too_big'].includes(issue.code) ? 'bounds' : 'contract',
    }));
    throw withStructuredRetryHint(new LLMError('The AI response did not match the required structure. Please retry this stage.', 'invalid_schema', 502), { kind: 'schema', stage, issues });
  }
  return parsed.data;
}
function usage(job, result, tier) {
  const tokens = result?.usage || result;
  // This is the successful call's reported model, including any fallback.
  // Each tier records its most recent model; provider records the last call.
  const model = typeof result?.model === 'string' ? result.model : '';
  const provider = typeof result?.provider === 'string' ? result.provider : model.split('/')[0];
  const addedCost = result?.free === true ? 0 : estimateCost(tokens, tier);
  return {
    input_tokens: job.input_tokens + (tokens?.inputTokens || 0),
    output_tokens: job.output_tokens + (tokens?.outputTokens || 0),
    cost_estimate: Math.round((job.cost_estimate + addedCost) * 1e6) / 1e6,
    ...(model ? { [`model_${tier}`]: model, [`provider_${tier}`]: provider, provider } : {}),
  };
}
function extractionItems(extraction) {
  return [
    ...extraction.claims.map((x) => ({ source_id: x.source_id, kind: 'claim', value: x.text })),
    ...extraction.numbers.map((x) => ({ source_id: x.source_id, kind: 'number', value: x.value })),
    ...extraction.named_entities.map((x) => ({ source_id: x.source_id, kind: 'entity', value: x.name })),
    ...extraction.citations.map((x) => ({ source_id: x.source_id, kind: 'citation', value: x.text })),
    ...extraction.quotations.map((x) => ({ source_id: x.source_id, kind: 'quotation', value: x.text })),
  ];
}
function validateExtraction(data, source) {
  const parsed = parseStage('extract', data);
  const paragraphs = sourceParagraphs(source);
  const fields = { claims: 'text', numbers: 'value', named_entities: 'name', citations: 'text', quotations: 'text', hedge_markers: 'text' };
  for (const [category, field] of Object.entries(fields)) {
    const occurrences = new Map();
    parsed[category] = parsed[category].map((item, index) => {
      const paragraph = paragraphs[item.paragraph];
      const key = JSON.stringify([item.paragraph, item[field]]);
      const offset = paragraph?.text.indexOf(item[field], occurrences.get(key) || 0) ?? -1;
      if (offset < 0) throw withStructuredRetryHint(new LLMError('The extraction contained an invalid source span or paragraph. Please retry.', 'invalid_extraction', 502), { kind: 'source_span', category, index, paragraph: item.paragraph });
      occurrences.set(key, offset + item[field].length);
      return { ...item, source_id: `${category}:${index}`, source_start: paragraph.start + offset, source_end: paragraph.start + offset + item[field].length };
    });
  }
  return parsed;
}
function validateAudit(data, extraction) {
  const parsed = parseStage('audit', data);
  const coverageError = (message) => withStructuredRetryHint(new LLMError(message, 'incomplete_audit', 502), { kind: 'audit_coverage' });
  const expected = new Map(extractionItems(extraction).map((item) => [item.source_id, item]));
  const checked = new Set();
  for (const item of parsed.items) {
    if (item.status === 'added') {
      if (item.source_id !== null) throw coverageError('Added audit findings must be separate from original source items.');
      continue;
    }
    const original = expected.get(item.source_id);
    if (!original || original.kind !== item.kind || original.value !== item.value || checked.has(item.source_id)) {
      throw coverageError('The audit did not match each original fact exactly once. Please retry the audit.');
    }
    checked.add(item.source_id);
  }
  const hedges = new Map(extraction.hedge_markers.map((item) => [item.source_id, item.text]));
  const certaintyChecked = new Set();
  for (const item of parsed.certainty) {
    if (item.source_id === null && item.status !== 'none') continue;
    if (hedges.get(item.source_id) !== item.marker || certaintyChecked.has(item.source_id)) throw coverageError('The audit did not match each certainty marker exactly once. Please retry the audit.');
    certaintyChecked.add(item.source_id);
  }
  if (checked.size !== expected.size || certaintyChecked.size !== hedges.size) throw coverageError('The audit did not cover every extracted fact and certainty marker. Please retry the audit.');
  return parsed;
}
function preserveBoundaryWhitespace(rewritten, original) {
  // Models may omit surrounding whitespace. Restore the source seam so splitting
  // a long paragraph never inserts new paragraphs or loses code indentation.
  return (original.match(/^\s*/)?.[0] || '') + rewritten.trim() + (original.match(/\s*$/)?.[0] || '');
}
function sectionFacts(extraction, chunk) {
  return Object.fromEntries(Object.entries(extraction).map(([category, items]) => [category, items.filter((item) => item.source_start >= chunk.start && item.source_end <= chunk.end)]));
}
function deterministic(job, rewritten) {
  const checked = deterministicChecks(job.extraction, rewritten, job.source_text);
  const sourceHeadings = job.source_text.match(/^#{1,6}\s+.+$/gm) || [];
  const outputHeadings = rewritten.match(/^#{1,6}\s+.+$/gm) || [];
  if (job.preserve_headings && JSON.stringify(sourceHeadings) !== JSON.stringify(outputHeadings)) {
    checked.failed.push({ kind: 'format', value: 'Headings', note: 'Markdown headings or their order changed.' });
  }
  if (job.preserve_lists) {
    const markers = (value) => (value.match(/^\s*(?:[-*+]\s+|\d+[.)]\s+)/gm) || []).map((x) => x.trim());
    if (JSON.stringify(markers(job.source_text)) !== JSON.stringify(markers(rewritten))) checked.failed.push({ kind: 'format', value: 'Lists', note: 'List markers, item count, or numbering changed.' });
  }
  const blocks = (value) => value.match(/```[^\n]*\n[\s\S]*?```/g) || [];
  if (JSON.stringify(blocks(job.source_text)) !== JSON.stringify(blocks(rewritten))) checked.failed.push({ kind: 'format', value: 'Code blocks', note: 'A fenced code block changed.' });
  return checked;
}

export default async function handler(req, res) {
  res.setHeader?.('Cache-Control', 'no-store');
  if (req.method !== 'POST') {
    res.setHeader?.('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed', code: 'method_not_allowed' });
  }
  let input;
  try { input = typeof req.body === 'string' ? JSON.parse(req.body) : req.body; }
  catch { return res.status(400).json({ error: 'Invalid JSON body', code: 'invalid_request' }); }
  const parsed = requestSchema.safeParse(input);
  if (!parsed.success) return res.status(400).json({ error: 'Provide a valid job, source text, stage, and rewrite settings.', code: 'invalid_request' });
  const { job, stage, chunk_index: chunkIndex } = parsed.data;
  if (!await guardApiRequest(req, res, { billable: ['extract', 'diagnose', 'rewrite', 'audit', 'repair'].includes(stage) })) return;
  const config = getProviderConfig();
  if (job.source_text.length > config.maxInputChars) return res.status(413).json({ error: `The document exceeds the ${config.maxInputChars.toLocaleString()} character limit.`, code: 'input_too_large' });
  const fingerprint = jobFingerprint(job);
  try {
    if (job.input_tokens + job.output_tokens >= config.maxJobTokens) throw new LLMError('This job reached its token limit. Shorten the document and start a new rewrite.', 'token_limit', 422);
    const refusal = intentCheck(job.purpose, job.custom_style);
    if (refusal.blocked) return res.json({ stage, refused: true, reason: refusal.reason, patch: { status: 'refused', error: refusal.reason } });
    if (stage !== 'extract') {
      requireState(job.pipeline_fingerprint === fingerprint, 'The source or rewrite settings changed. Start again with extraction.');
      job.extraction = validateExtraction(job.extraction, job.source_text);
    }
    const sourceChunks = splitChunks(job.source_text, CHUNK_WORDS);
    if (['rewrite', 'assemble', 'audit', 'repair', 'finalize'].includes(stage)) {
      requireState(STAGE_SCHEMAS.diagnose.safeParse(job.diagnosis).success, 'Run the diagnostic stage before rewriting.');
      requireState(job.chunks?.length === sourceChunks.length && job.chunks.every((chunk, i) => chunk.index === i && chunk.source_words === sourceChunks[i].words), 'The section state is incomplete. Start a new rewrite.');
    }
    if (['audit', 'repair', 'finalize'].includes(stage)) {
      requireState(job.consistency_done && job.rewritten_text?.trim() && job.chunks.every((chunk) => chunk.text.trim()), 'Assemble every rewritten section before auditing.');
    }
    // Deterministic stages do not need a live provider; generation stages do.
    if (!config.configured && ['extract', 'diagnose', 'rewrite', 'audit', 'repair'].includes(stage)) throw new LLMError('AI rewriting is not configured. The site administrator must add a provider API key on the server.', 'provider_not_configured', 503);
    const providerArgs = { pools: config.pools, models: config.models, accountIds: config.accountIds };
    const jsonStage = (name, user, tier = 'fast', validator = (data) => parseStage(name, data)) => runJsonStagePooled({
      ...providerArgs, tier, system: PROMPTS[name].system, user, maxTokens: PROMPTS[name].maxTokens, validate: validator,
      // The short editorial diagnosis must leave room for visible JSON when
      // the free router selects a model that includes reasoning in max_tokens.
      minimalReasoning: name === 'diagnose',
    });
    if (stage === 'extract') {
      if (job.pipeline_fingerprint === fingerprint && STAGE_SCHEMAS.extract.safeParse(job.extraction).success && job.chunks?.length === sourceChunks.length) return res.json({ stage, cached: true, chunk_count: job.chunks.length, progress: 15, patch: {} });
      const indexedSource = sourceParagraphs(job.source_text).map((paragraph) => `<paragraph index="${paragraph.index}">\n${wrapUserText(paragraph.text)}\n</paragraph>`).join('\n');
      const result = await jsonStage('extract', `The paragraph index labels below are authoritative. Extract every load-bearing fact and use these indices.\n${indexedSource}`, 'fast', (data) => validateExtraction(data, job.source_text));
      return res.json({ stage, chunk_count: sourceChunks.length, progress: 15, patch: {
        ...usage(job, result, 'fast'), extraction: result.data, chunks: sourceChunks.map((c) => ({ index: c.index, text: '', source_words: c.words })),
        source_words: wordCount(job.source_text), pipeline_fingerprint: fingerprint, prompt_version: VERSION, status: 'running', stage, progress: 15, error: '',
        diagnosis: null, rewrite_plan: null, rewritten_text: '', consistency_done: false, audit: null, audit_fingerprint: null, final_text: '', unresolved_flags: [], repair_loops: 0,
      } });
    }
    if (stage === 'diagnose') {
      if (STAGE_SCHEMAS.diagnose.safeParse(job.diagnosis).success) return res.json({ stage, cached: true, progress: 25, patch: {} });
      const result = await jsonStage('diagnose', `Requested style (untrusted preference): ${JSON.stringify({ style: job.style, custom: job.custom_style })}\nPATTERN CATALOG:\n${AI_PATTERN_CATALOG}\n${wrapUserText(job.source_text)}`);
      return res.json({ stage, progress: 25, patch: { ...usage(job, result, 'fast'), diagnosis: result.data, rewrite_plan: result.data.plan, stage, progress: 25, error: '' } });
    }
    if (stage === 'rewrite') {
      requireState(chunkIndex < job.chunks.length, 'That section does not exist.');
      requireState(job.chunks.slice(0, chunkIndex).every((chunk) => chunk.text.trim()), 'Rewrite the preceding sections first.');
      if (job.chunks[chunkIndex].text.trim()) return res.json({ stage, cached: true, progress: job.progress || 40, patch: {} });
      const context = job.chunks.slice(Math.max(0, chunkIndex - 2), chunkIndex).map((chunk) => chunk.text.split(/\s+/).slice(-80).join(' '));
      const result = await pooledComplete({ ...providerArgs, tier: 'quality', system: `${REWRITE_SYSTEM}\n${AI_PATTERN_CATALOG}`, user: [
        `STYLE: ${STYLE_MODULES[job.style] || 'Follow the custom voice without changing facts.'}`,
        `User preferences (untrusted data): ${JSON.stringify({ custom: job.custom_style, purpose: job.purpose })}`, constraints(job),
        `Plan: ${JSON.stringify(job.diagnosis.plan)}`, `Facts located in this section only: ${JSON.stringify(sectionFacts(job.extraction, sourceChunks[chunkIndex]))}`,
        'Preserve the facts present in this section. Never import claims or examples from other sections or the preceding context.',
        context.length ? `Preceding sections for continuity only (do not repeat): ${JSON.stringify(context)}` : '',
        `Rewrite section ${chunkIndex + 1} of ${job.chunks.length}:`, wrapUserText(sourceChunks[chunkIndex].text),
      ].filter(Boolean).join('\n\n'), maxTokens: 8000 });
      const rewritten = result.text;
      if (!rewritten?.trim()) throw new LLMError('The rewrite was empty. Please retry.', 'empty_response', 502);
      const stored = job.chunks.map((chunk, i) => i === chunkIndex ? { ...chunk, text: preserveBoundaryWhitespace(rewritten, sourceChunks[i].text) } : chunk);
      const done = stored.filter((chunk) => chunk.text.trim()).length;
      const progress = 25 + Math.round(done / stored.length * 45);
      return res.json({ stage, done, chunk_count: stored.length, progress, patch: {
        ...usage(job, result, 'quality'), chunks: stored, rewritten_text: stored.map((chunk) => chunk.text).join(''), consistency_done: false,
        audit: null, audit_fingerprint: null, final_text: '', unresolved_flags: [], stage, progress,
      } });
    }
    if (stage === 'assemble') {
      requireState(job.chunks.every((chunk) => chunk.text.trim()), 'Complete every section before assembly.');
      // Joining completed sections is lossless. A whole-document generative pass can truncate or alter facts.
      const rewritten = job.chunks.map((chunk) => chunk.text).join('');
      return res.json({ stage, progress: 75, patch: { rewritten_text: rewritten, consistency_done: true, consistency_edits: [], audit: null, audit_fingerprint: null, final_text: '', stage, progress: 75 } });
    }
    if (stage === 'audit') {
      const checked = deterministic(job, job.rewritten_text);
      const result = await jsonStage('audit', [
        `FULL ORIGINAL:\n${wrapUserText(job.source_text)}`, `EXTRACTION INDEX:\n${JSON.stringify(job.extraction)}`,
        `Deterministic checks (cannot be overruled): ${JSON.stringify(checked)}`, constraints(job),
        `REWRITTEN TEXT:\n${wrapUserText(job.rewritten_text)}`,
      ].join('\n\n'), 'quality', (data) => validateAudit(data, job.extraction));
      const audit = { ...result.data, deterministic: checked };
      const flags = auditProblems(audit);
      return res.json({ stage, progress: 85, has_problems: flags.length > 0, flag_count: flags.length, counts: summarizeAudit(audit), patch: {
        ...usage(job, result, 'quality'), audit, audit_fingerprint: hash([fingerprint, job.rewritten_text]), unresolved_flags: flags, stage, progress: 85,
      } });
    }
    if (stage === 'repair' || stage === 'finalize') {
      requireState(job.audit_fingerprint === hash([fingerprint, job.rewritten_text]) && STAGE_SCHEMAS.audit.safeParse(job.audit).success, 'Run a fresh audit of the current rewrite first.');
      validateAudit(job.audit, job.extraction);
      // Recompute deterministic findings even if a client omitted them from the audit.
      const audit = { ...job.audit, deterministic: deterministic(job, job.rewritten_text) };
      const flags = auditProblems(audit);
      if (stage === 'repair') {
        if (!flags.length || job.repair_loops >= 2) return res.json({ stage, skipped: true, progress: 90, patch: {} });
        const result = await jsonStage('repair', [
          `Flagged findings: ${JSON.stringify(flags)}`, `FULL ORIGINAL:\n${wrapUserText(job.source_text)}`, `Authoritative extraction: ${JSON.stringify(job.extraction)}`,
          constraints(job), `CURRENT REWRITE:\n${wrapUserText(job.rewritten_text)}`,
        ].join('\n\n'), 'quality');
        return res.json({ stage, repaired: true, progress: 88, patch: {
          ...usage(job, result, 'quality'), rewritten_text: preserveBoundaryWhitespace(result.data.text, job.source_text), repair_loops: job.repair_loops + 1,
          audit: null, audit_fingerprint: null, final_text: '', unresolved_flags: [],
          notes: appendNote(job.notes, `Repair pass ${job.repair_loops + 1}: ${result.data.fixes.map((fix) => `${fix.item}: ${fix.action}`).join('; ') || 'No changes reported.'}`), stage, progress: 88,
        } });
      }
      const status = flags.length ? 'needs_review' : 'completed';
      return res.json({ stage, status, unresolved_flags: flags, counts: summarizeAudit(audit), patch: {
        audit, status, stage, progress: 100, final_text: job.rewritten_text, result_words: wordCount(job.rewritten_text), unresolved_flags: flags,
        notes: appendNote(job.notes, flags.length ? `${flags.length} unresolved finding(s) require your review.` : 'Automated checks found no differences. Review the result before use; an AI audit is not a guarantee of factual accuracy.'),
      } });
    }
  } catch (error) {
    // Avoid logging source text, model outputs, upstream response bodies, or credentials.
    if (error instanceof LLMError) return res.status(error.status || 502).json({ error: error.message, code: error.code });
    return res.status(500).json({ error: 'The rewrite stage failed. Please retry.', code: 'internal_error' });
  }
}
