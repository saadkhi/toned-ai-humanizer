import { AI_STYLE_SAMPLE } from './sample.js';

const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const wordCount = (value) => value.trim() ? value.trim().split(/\s+/).length : 0;
const bounded = (pattern) => `(?<![\\p{L}\\p{N}_])(?:${pattern})(?![\\p{L}\\p{N}_])`;
const literalPattern = (value) => escapeRegex(value).replace(/ /g, '\\s+');
const wordMatches = (text, pattern) => [...text.matchAll(new RegExp(bounded(pattern), 'giu'))];

function phraseCount(text, phrase) {
  const variants = {
    leverage: 'leverag(?:e(?:s|d)?|ing)',
    delve: 'delv(?:e(?:s|d)?|ing)',
    robust: 'robust(?:ly|ness)?',
    seamless: 'seamless(?:ly)?',
  };
  const normalized = text.replace(/[‘’]/g, "'");
  return wordMatches(normalized, variants[phrase] || literalPattern(phrase)).length;
}

function exactSpanPresent(text, span) {
  if (span.kind === 'quotation') {
    const quotations = [...text.matchAll(/"([^"\r\n]+)"|“([^”\r\n]+)”/gu)];
    return quotations.some((match) => (match[1] ?? match[2]) === span.value);
  }
  if (span.kind === 'url') {
    const urls = [...text.matchAll(/https?:\/\/[^\s<>"')\]]+/gu)]
      .map((match) => match[0].replace(/[.,;:!?]+$/g, ''));
    return urls.includes(span.value);
  }
  return new RegExp(bounded(escapeRegex(span.value)), 'u').test(text);
}

function numberTokens(text) {
  return [...text.matchAll(/(?<![\p{L}\p{N}_])[-+]?\d+(?:[.,]\d+)*%?(?![\p{L}\p{N}_])/gu)]
    .map((match) => match[0]);
}

function occurrences(values) {
  const counts = new Map();
  for (const value of values) counts.set(value, (counts.get(value) || 0) + 1);
  return counts;
}

function numericComparison(beforeText, afterText) {
  const before = numberTokens(beforeText);
  const after = numberTokens(afterText);
  const beforeCounts = occurrences(before);
  const afterCounts = occurrences(after);
  const added = [];
  const missing = [];
  for (const value of new Set([...before, ...after])) {
    const difference = (afterCounts.get(value) || 0) - (beforeCounts.get(value) || 0);
    if (difference > 0) added.push({ value, count: difference });
    if (difference < 0) missing.push({ value, count: -difference });
  }
  return { before, after, added, missing, preserved: !added.length && !missing.length };
}

/**
 * Conservative surface checks for a known synthetic fixture. This is not an
 * authorship classifier, an AI-detector score, or a semantic accuracy benchmark.
 */
export function evaluateRewrite(rewritten, sample = AI_STYLE_SAMPLE) {
  const text = typeof rewritten === 'string' ? rewritten : '';
  const hasText = text.trim().length > 0;
  const byPhrase = sample.stockPhrases.map((phrase) => ({
    phrase, before: phraseCount(sample.source, phrase), after: phraseCount(text, phrase),
  }));
  const beforeCount = byPhrase.reduce((total, entry) => total + entry.before, 0);
  const afterCount = byPhrase.reduce((total, entry) => total + entry.after, 0);
  const checks = sample.requiredSpans.map((span) => ({
    label: span.label, value: span.value, preserved: exactSpanPresent(text, span),
  }));
  const uncertainty = sample.uncertaintyMarkers.map((marker) => {
    const pattern = literalPattern(marker);
    const before = wordMatches(sample.source, pattern).length;
    const after = wordMatches(text, pattern).length;
    return { marker, before, after, preserved: after >= before };
  });
  const numericValues = numericComparison(sample.source, text);
  const styleImproved = hasText && afterCount < beforeCount;
  const factsPreserved = checks.every((entry) => entry.preserved)
    && uncertainty.every((entry) => entry.preserved) && numericValues.preserved;
  return {
    sampleId: sample.id,
    pass: hasText && styleImproved && factsPreserved,
    hasText,
    styleImproved,
    factsPreserved,
    styleCounts: { before: beforeCount, after: afterCount, reduction: beforeCount - afterCount, byPhrase },
    checks,
    uncertainty,
    numericValues,
    wordCounts: { before: wordCount(sample.source), after: wordCount(text) },
    limitations: 'Dictionary and exact-span checks do not identify authorship, measure AI-detector performance, or prove semantic equivalence. Use the full audit and human review.',
  };
}
