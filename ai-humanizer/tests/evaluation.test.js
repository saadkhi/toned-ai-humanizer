import assert from 'node:assert/strict';
import test from 'node:test';
import { AI_STYLE_SAMPLE } from '../evaluation/sample.js';
import { evaluateRewrite } from '../evaluation/evaluate.js';

const faithfulRewrite = `This fictional report is an editing sample, not a real study. Northbridge Lab began a pilot on 14 March 2026 with 42 participants. The team aims to use a clear review workflow. The pilot may reduce review time by approximately 12%, but the estimate remains preliminary and does not establish a proven benefit.

Dr. Amina Khan said, "The findings are preliminary." The team will study reviewers' comments before deciding whether the workflow is useful. A small pilot cannot establish how the workflow would perform elsewhere. Its supporting reference is [1], available at https://example.org/pilot.

The team plans to review the results in June 2026, examining the collected comments and the practical effort required. The report does not promise a time saving for every participant. The team will retain the same cautious interpretation when discussing the pilot.`;

test('the synthetic AI-style fixture contains the declared source constraints and deliberate stock phrases', () => {
  const sourceResult = evaluateRewrite(AI_STYLE_SAMPLE.source);
  assert.ok(sourceResult.wordCounts.before >= 170 && sourceResult.wordCounts.before <= 220);
  assert.equal(AI_STYLE_SAMPLE.source.split(/\n\n/).length, 3);
  assert.equal(sourceResult.factsPreserved, true);
  assert.equal(sourceResult.styleCounts.before, 11);
  assert.equal(sourceResult.styleCounts.after, 11);
  assert.equal(sourceResult.pass, false);
});

test('a faithful smoother fixture removes measured stock phrasing while preserving exact facts and uncertainty', () => {
  const result = evaluateRewrite(faithfulRewrite);
  assert.equal(result.pass, true);
  assert.equal(result.factsPreserved, true);
  assert.equal(result.styleCounts.after, 0);
  assert.equal(result.styleCounts.reduction, 11);
  assert.ok(result.checks.every((entry) => entry.preserved));
  assert.equal(result.uncertainty.find((entry) => entry.marker === 'preliminary').after, 2);
  assert.match(result.limitations, /do not identify authorship/);
});

test('changed quantities, dates, quotations, and reference URLs cannot pass the evaluation', () => {
  for (const [before, after, failedLabel] of [
    ['42 participants', '142 participants', 'participant count'],
    ['12%', '112%', 'estimated reduction'],
    ['14 March 2026', '15 March 2026', 'pilot start date'],
    ['June 2026', 'July 2026', 'planned review date'],
    ['The findings are preliminary.', 'The findings are conclusive.', 'verbatim quotation'],
    ['https://example.org/pilot', 'https://example.org/pilot/changed', 'reference URL'],
  ]) {
    const result = evaluateRewrite(faithfulRewrite.replace(before, after));
    assert.equal(result.pass, false);
    assert.equal(result.checks.find((entry) => entry.label === failedLabel).preserved, false);
  }
});

test('removed uncertainty occurrences and added numeric claims remain visible even when the style count improves', () => {
  for (const text of [
    faithfulRewrite.replace('may reduce', 'will reduce'),
    faithfulRewrite.replace('approximately ', ''),
    faithfulRewrite.replace('estimate remains preliminary', 'estimate is established'),
    faithfulRewrite + ' The pilot saved 100 hours.',
  ]) {
    const result = evaluateRewrite(text);
    assert.equal(result.styleImproved, true);
    assert.equal(result.factsPreserved, false);
    assert.equal(result.pass, false);
  }
  const added = evaluateRewrite(faithfulRewrite + ' The pilot saved 100 hours.');
  assert.deepEqual(added.numericValues.added, [{ value: '100', count: 1 }]);
});

test('increased stock phrases, inflected stock words, and empty output are not reported as clean success', () => {
  const repeated = evaluateRewrite(AI_STYLE_SAMPLE.source + ' Furthermore, this is robust.');
  assert.equal(repeated.styleImproved, false);
  assert.equal(repeated.pass, false);
  const inflected = evaluateRewrite(faithfulRewrite + ' The team is leveraging a workflow and delving into comments.');
  assert.equal(inflected.styleCounts.after, 2);
  assert.equal(inflected.styleCounts.byPhrase.find((entry) => entry.phrase === 'leverage').after, 1);
  assert.equal(evaluateRewrite('').pass, false);
  assert.equal(evaluateRewrite('').styleImproved, false);
  assert.equal(evaluateRewrite(' \n ').styleImproved, false);
  assert.equal(evaluateRewrite(undefined).pass, false);
});
