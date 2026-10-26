export const STYLE_OPTIONS = [
  {
    value: 'professional_researcher',
    label: 'Professional Researcher',
    blurb: 'Measured, scholarly, hedged deliberately. No flourish.',
  },
  {
    value: 'casual_blogger',
    label: 'Casual Blogger',
    blurb: 'Warm and direct, short sentences mixed with long ones.',
  },
  {
    value: 'technical_writer',
    label: 'Technical Writer',
    blurb: 'Precise and task-focused. Terminology untouched.',
  },
];

export const CUSTOM_STYLE = { value: 'custom', label: 'Custom voice' };

export const LENGTH_OPTIONS = [
  { value: 'shorter', label: 'Shorter' },
  { value: 'same', label: 'Same length' },
  { value: 'longer', label: 'Longer' },
];

export const RETENTION_OPTIONS = [
  { value: 0, label: 'Do not save to history', note: 'Kept only while this page is open.' },
  { value: 7, label: 'Keep for 7 days', note: '' },
  { value: 30, label: 'Keep for 30 days', note: 'Default.' },
  { value: 90, label: 'Keep for 90 days', note: '' },
];

export const STATUS_META = {
  queued: { label: 'Queued', tone: 'muted' },
  running: { label: 'Running', tone: 'muted' },
  needs_review: { label: 'Needs review', tone: 'warning' },
  completed: { label: 'Completed', tone: 'success' },
  failed: { label: 'Failed', tone: 'destructive' },
  refused: { label: 'Refused', tone: 'destructive' },
};

export const STAGE_LABELS = {
  extract: 'Extracting claims, numbers, names and citations',
  diagnose: 'Diagnosing AI patterns and planning the rewrite',
  rewrite: 'Rewriting paragraph by paragraph',
  assemble: 'Joining rewritten sections in their original order',
  audit: 'Checking claims against the original',
  repair: 'Repairing flagged items',
  finalize: 'Writing the audit report',
};

export function styleLabel(value, customStyle) {
  if (value === 'custom') return customStyle ? `Custom: ${customStyle}` : 'Custom voice';
  const found = STYLE_OPTIONS.find((option) => option.value === value);
  return found ? found.label : 'Professional Researcher';
}

export function formatDate(value) {
  if (!value) return '';
  try {
    return new Date(value).toLocaleString(undefined, {
      dateStyle: 'medium',
      timeStyle: 'short',
    });
  } catch {
    return value;
  }
}