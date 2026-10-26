/**
 * Pipeline orchestrator for the server-side rewrite stages.
 * The job object lives in localStorage (via jobStore) and is passed to the
 * serverless function on every call. The returned `patch` is merged back.
 */
import { jobStore } from './jobStore.js';
import { countWords } from './diff.js';
import { requestJson } from './request.js';

const MAX_REPAIR_LOOPS = 2;

export async function callStage(jobId, stage, extra = {}, options = {}) {
  // Always fetch the freshest copy so we send up-to-date state.
  const job = await jobStore.RewriteJob.get(jobId);

  const data = await requestJson('/api/run-stage', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ job, stage, ...extra }),
    signal: options.signal,
  });

  if (data.error) throw new Error(data.error);

  // Merge the patch back into localStorage so future calls see the latest state.
  if (data.patch && Object.keys(data.patch).length > 0) {
    await jobStore.RewriteJob.update(jobId, data.patch);
  }

  return data;
}

export function expiresAtFrom(retentionDays) {
  if (!retentionDays) return null;
  const date = new Date();
  date.setDate(date.getDate() + Number(retentionDays));
  return date.toISOString();
}

export function titleFrom(text, filename) {
  if (filename) return filename;
  const firstLine = String(text || '')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)[0];
  if (!firstLine) return 'Untitled rewrite';
  return firstLine.length > 72 ? `${firstLine.slice(0, 69)}...` : firstLine;
}

export async function createJob({ text, style, customStyle, purpose, prefs, retentionDays, filename }) {
  return jobStore.RewriteJob.create({
    title: titleFrom(text, filename),
    source_text: text,
    source_words: countWords(text),
    style,
    custom_style: style === 'custom' ? customStyle : '',
    purpose: purpose || '',
    preserve_headings: prefs.preserve_headings,
    preserve_lists: prefs.preserve_lists,
    length_target: prefs.length_target,
    retention_days: retentionDays,
    expires_at: expiresAtFrom(retentionDays),
    status: 'queued',
    progress: 0,
  });
}

/**
 * Drives the pipeline one stage at a time.
 * Each stage is idempotent — re-invoking a completed stage returns cached data.
 */
export async function runPipeline(jobId, onUpdate = () => {}, options = {}) {
  const extract = await callStage(jobId, 'extract', {}, options);
  if (extract.refused) return { refused: true, reason: extract.reason };
  onUpdate({ stage: 'extract', progress: extract.progress || 15 });

  await callStage(jobId, 'diagnose', {}, options);
  onUpdate({ stage: 'diagnose', progress: 25 });

  const chunkCount = extract.chunk_count || 1;
  for (let i = 0; i < chunkCount; i++) {
    const rewritten = await callStage(jobId, 'rewrite', { chunk_index: i }, options);
    onUpdate({ stage: 'rewrite', progress: rewritten.progress || 40 });
  }

  const assembled = await callStage(jobId, 'assemble', {}, options);
  onUpdate({ stage: 'assemble', progress: assembled.progress || 75 });

  let audit = await callStage(jobId, 'audit', {}, options);
  onUpdate({ stage: 'audit', progress: audit.progress || 85 });

  let loops = 0;
  while (audit.has_problems && loops < MAX_REPAIR_LOOPS) {
    await callStage(jobId, 'repair', {}, options);
    audit = await callStage(jobId, 'audit', {}, options);
    loops++;
    onUpdate({ stage: 'audit', progress: audit.progress || 85 });
  }

  const final = await callStage(jobId, 'finalize', {}, options);
  onUpdate({ stage: 'finalize', progress: 100 });

  // Return the fully-updated job from localStorage.
  const job = await jobStore.RewriteJob.get(jobId);
  return {
    refused: false,
    job,
    status: final.status,
    unresolved: final.unresolved_flags || [],
  };
}

const ACCEPTED_TYPES = ['.txt', '.md', '.markdown'];

export function readTextFile(file) {
  return new Promise((resolve, reject) => {
    const name = String(file?.name || '').toLowerCase();
    if (!ACCEPTED_TYPES.some((ext) => name.endsWith(ext))) {
      reject(new Error('Only .txt and .md files can be read here. Paste .docx content instead.'));
      return;
    }
    if (file.size > 200000) {
      reject(new Error('That file is too large. Open a smaller document or paste an excerpt.'));
      return;
    }
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('That file could not be read.'));
    reader.readAsText(file);
  });
}

export function downloadText(text, filename) {
  const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
