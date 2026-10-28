import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { buildReview, composeReview, splitParagraphs } from '../src/lib/diff.js';
import { jobStore } from '../src/lib/jobStore.js';

const source = '\r\n\r\n    Original code line\r\n    second line\r\n \t\r\nOriginal second paragraph.\r\n\r\nLast source paragraph.\r\n';
const rewritten = '\r\n\r\n    Updated code line\r\n    second line\r\n \t\r\nChanged second paragraph.\r\n\r\nLast source paragraph.\r\n';

test('accept all exports the exact audited bytes and reject all restores the exact source', () => {
  const review = buildReview(source, rewritten);
  assert.equal(splitParagraphs(source).length, 3);
  assert.equal(review.paragraphs[0].before, '    Original code line\r\n    second line');
  assert.equal(composeReview(review, {}), rewritten);
  assert.equal(composeReview(review, Object.fromEntries(review.changes.map((paragraph) => [paragraph.id, false]))), source);
});

test('mixed review choices preserve untouched output separators, indentation and trailing newlines', () => {
  const review = buildReview(source, rewritten);
  assert.equal(composeReview(review, { p1: false }), rewritten.replace('Changed second paragraph.', 'Original second paragraph.'));
  assert.equal(composeReview(review, { p0: false }), rewritten.replace('    Updated code line', '    Original code line'));
});

test('tracked operations retain leading indentation and expose indentation-only changes', () => {
  const original = '    Keep this code indented.';
  const result = '\tKeep this code indented.';
  const review = buildReview(original, result);
  assert.equal(review.changes.length, 1);
  const operations = review.changes[0].ops;
  assert.equal(operations.filter((op) => op.type !== 'ins').map((op) => op.text).join(''), original);
  assert.equal(operations.filter((op) => op.type !== 'del').map((op) => op.text).join(''), result);
  assert.ok(operations.some((op) => op.type === 'del' && op.text === '    '));
  assert.ok(operations.some((op) => op.type === 'ins' && op.text === '\t'));
});

test('rejecting a deleted final paragraph restores its original blank-line separator', () => {
  const review = buildReview('First old.\n\t\nSecond old.\n\nThird old.', 'First changed.\n\t\nSecond changed.');
  assert.equal(composeReview(review, { p2: false }), 'First changed.\n\t\nSecond changed.\n\nThird old.');
});

test('a middle insertion does not shift the source paragraph restored by a later rejection', () => {
  const original = 'Introduction old.\r\n\r\nClosing old.\r\n';
  const result = 'Introduction revised.\r\n \t\r\nA newly inserted note.\r\n\r\nClosing revised.\r\n';
  const review = buildReview(original, result);
  const inserted = review.changes.find((paragraph) => !paragraph.beforeSpan);
  const closing = review.changes.find((paragraph) => paragraph.before === 'Closing old.\r\n');
  assert.ok(inserted);
  assert.ok(closing);
  assert.equal(closing.after, 'Closing revised.\r\n');
  assert.equal(composeReview(review, { [closing.id]: false }), result.replace('Closing revised.', 'Closing old.'));
  assert.equal(composeReview(review, { [inserted.id]: false }), 'Introduction revised.\r\n \t\r\nClosing revised.\r\n');
});

test('a middle deletion restores the actual deleted paragraph and its source separator', () => {
  const original = 'Introduction old.\r\n \r\nA temporary note to retain.\r\n\t\r\nClosing old.\r\n';
  const result = 'Introduction revised.\r\n \r\nClosing revised.\r\n';
  const review = buildReview(original, result);
  const deleted = review.changes.find((paragraph) => !paragraph.afterSpan);
  const closing = review.changes.find((paragraph) => paragraph.before === 'Closing old.\r\n');
  assert.ok(deleted);
  assert.equal(deleted.before, 'A temporary note to retain.');
  assert.ok(closing);
  assert.equal(composeReview(review, { [deleted.id]: false }), 'Introduction revised.\r\n \r\nA temporary note to retain.\r\n\t\r\nClosing revised.\r\n');
  assert.equal(composeReview(review, { [closing.id]: false }), result.replace('Closing revised.', 'Closing old.'));
});

test('rejecting a new first or last paragraph removes its adjacent separator', () => {
  const original = 'First old.\n\nLast old.';
  for (const [result, insertedText] of [
    ['A new opening.\n\nFirst changed.\n\nLast changed.', 'A new opening.'],
    ['First changed.\n\nLast changed.\n \nA new ending.', 'A new ending.'],
  ]) {
    const review = buildReview(original, result);
    const inserted = review.changes.find((paragraph) => paragraph.after === insertedText);
    assert.ok(inserted);
    assert.equal(composeReview(review, { [inserted.id]: false }), 'First changed.\n\nLast changed.');
  }
});

test('ambiguous replacement sections remain grouped rather than pairing unrelated paragraphs', () => {
  const original = 'Orchard apples ripen.\n\nMountain snow melts.';
  const result = 'Harbor boats departed.\r\n\r\nCity buses arrived.\r\n\r\nForest trails opened.';
  const review = buildReview(original, result);
  assert.equal(review.changes.length, 1);
  assert.equal(review.changes[0].beforeCount, 2);
  assert.equal(review.changes[0].afterCount, 3);
  assert.equal(composeReview(review, {}), result);
  assert.equal(composeReview(review, { [review.changes[0].id]: false }), original);
});

test('rejecting a deletion and a later rewrite together preserves their shared boundary', () => {
  const original = 'First old.\n\nRemove this paragraph.\n\nLast old.\n\nUnchanged ending.';
  const result = 'First changed.\n\nLast changed.\n\nUnchanged ending.';
  const review = buildReview(original, result);
  const decisions = Object.fromEntries(review.changes.filter((paragraph) => paragraph.before !== 'First old.').map((paragraph) => [paragraph.id, false]));
  assert.equal(composeReview(review, decisions), 'First changed.\n\nRemove this paragraph.\n\nLast old.\n\nUnchanged ending.');
});

test('usage uses local calendar months consistently on both sides of UTC midnight', () => {
  const script = `import { summarizeUsage } from './src/lib/usage.js';
    const summary = summarizeUsage([
      {created_date:'2026-09-30T20:30:00Z',source_words:123},
      {created_date:'2026-10-10T12:00:00Z',source_words:77}
    ], new Date('2026-10-15T12:00:00Z'));
    console.log(JSON.stringify(summary));`;
  const pakistan = JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e', script], { cwd: process.cwd(), env: { ...process.env, TZ: 'Asia/Karachi' }, encoding: 'utf8' }));
  assert.equal(pakistan.monthWords, 200);
  assert.equal(pakistan.months.at(-1).words, 200);
  const california = JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e', script], { cwd: process.cwd(), env: { ...process.env, TZ: 'America/Los_Angeles' }, encoding: 'utf8' }));
  assert.equal(california.monthWords, 77);
  assert.equal(california.months.at(-1).words, 77);
  assert.equal(california.months.at(-2).words, 123);
});

for (const malformed of [[null], [{ id: 'broken', title: { unsafe: 'React child' } }], [{ id: 'broken', expires_at: 'invalid date' }], [{ id: 'broken', diagnosis: { patterns: [{ pattern: { unsafe: 'React child' } }] } }], [{ id: 'broken', notes: { unsafe: 'React child' } }]]) {
  test(`malformed history ${JSON.stringify(malformed)} produces an actionable error and preserves bytes`, async (t) => {
    const previous = globalThis.localStorage;
    const raw = JSON.stringify(malformed);
    let saved = raw;
    globalThis.localStorage = { getItem: () => saved, setItem: (_key, value) => { saved = value; } };
    t.after(() => { globalThis.localStorage = previous; });
    await assert.rejects(jobStore.RewriteJob.list(), /damaged.*not been changed/);
    assert.equal(saved, raw);
  });
}

test('default history listing no longer silently truncates at100 records', async (t) => {
  const previous = globalThis.localStorage;
  const records = Array.from({ length: 205 }, (_, index) => ({ id: String(index), source_words: 1 }));
  globalThis.localStorage = { getItem: () => JSON.stringify(records), setItem() {} };
  t.after(() => { globalThis.localStorage = previous; });
  assert.equal((await jobStore.RewriteJob.list()).length, 205);
});
