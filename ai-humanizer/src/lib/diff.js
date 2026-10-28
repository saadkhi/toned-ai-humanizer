import { sourceParagraphs } from '../../shared/source-text.js';

/**
 * Paragraph-aligned tracked-change diff.
 *
 * Stable paragraph matches keep insertions and deletions from shifting later
 * review choices. Ambiguous sections stay together as a single change. Inside
 * each change a word-level LCS shows which words moved.
 */

const MAX_DP_CELLS = 120000;

export function splitParagraphs(text) {
  return sourceParagraphs(text).map((paragraph) => paragraph.text);
}

function tokenize(text) {
  // Include leading indentation as well as the whitespace after each word.
  // Tracked changes must not silently hide an indentation-only edit.
  return String(text || '').match(/\s+|\S+\s*/g) || [];
}

function wordOps(beforeTokens, afterTokens) {
  const n = beforeTokens.length;
  const m = afterTokens.length;
  if (!n) return afterTokens.map((text) => ({ type: 'ins', text }));
  if (!m) return beforeTokens.map((text) => ({ type: 'del', text }));
  if (n * m > MAX_DP_CELLS) {
    return [
      { type: 'del', text: beforeTokens.join('') },
      { type: 'ins', text: afterTokens.join('') },
    ];
  }

  const grid = new Array(n + 1);
  for (let i = 0; i <= n; i += 1) grid[i] = new Uint16Array(m + 1);
  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) {
      grid[i][j] =
        beforeTokens[i] === afterTokens[j]
          ? grid[i + 1][j + 1] + 1
          : Math.max(grid[i + 1][j], grid[i][j + 1]);
    }
  }

  const ops = [];
  const push = (type, text) => {
    const last = ops[ops.length - 1];
    if (last && last.type === type) last.text += text;
    else ops.push({ type, text });
  };

  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (beforeTokens[i] === afterTokens[j]) {
      push('equal', beforeTokens[i]);
      i += 1;
      j += 1;
    } else if (grid[i + 1][j] >= grid[i][j + 1]) {
      push('del', beforeTokens[i]);
      i += 1;
    } else {
      push('ins', afterTokens[j]);
      j += 1;
    }
  }
  while (i < n) {
    push('del', beforeTokens[i]);
    i += 1;
  }
  while (j < m) {
    push('ins', afterTokens[j]);
    j += 1;
  }
  return ops;
}

function paragraphMatches(before, after) {
  const matches = [];
  let first = 0;
  while (first < before.length && first < after.length && before[first].text === after[first].text) {
    matches.push([first, first]);
    first++;
  }
  let beforeEnd = before.length;
  let afterEnd = after.length;
  const suffix = [];
  while (beforeEnd > first && afterEnd > first && before[beforeEnd - 1].text === after[afterEnd - 1].text) {
    suffix.push([--beforeEnd, --afterEnd]);
  }

  // Bound comparisons for documents containing thousands of tiny paragraphs.
  // A large or ambiguous middle section is safer to review as a whole.
  if ((beforeEnd - first) * (afterEnd - first) <= MAX_DP_CELLS) {
    const words = (text) => new Set(text.toLowerCase().match(/[\p{L}\p{N}_]+/gu) || []);
    const beforeWords = before.slice(first, beforeEnd).map((paragraph) => words(paragraph.text));
    const afterWords = after.slice(first, afterEnd).map((paragraph) => words(paragraph.text));
    const rowBest = beforeWords.map(() => ({ score: -1, second: -1, index: -1 }));
    const columnBest = afterWords.map(() => ({ score: -1, second: -1, index: -1 }));
    const remember = (best, score, index) => {
      if (score > best.score) {
        best.second = best.score;
        best.score = score;
        best.index = index;
      } else if (score > best.second) best.second = score;
    };
    for (let i = 0; i < beforeWords.length; i++) {
      for (let j = 0; j < afterWords.length; j++) {
        let common = 0;
        for (const word of beforeWords[i]) if (afterWords[j].has(word)) common++;
        const score = before[first + i].text === after[first + j].text
          ? 2 : 2 * common / Math.max(1, beforeWords[i].size + afterWords[j].size);
        remember(rowBest[i], score, j);
        remember(columnBest[j], score, i);
      }
    }
    const middle = [];
    for (let i = 0; i < rowBest.length; i++) {
      const best = rowBest[i];
      const reverse = columnBest[best.index];
      // Require a clear, mutual match. Repeated or very similar paragraphs do
      // not justify assigning a source paragraph to the wrong rewritten one.
      if (best.score >= 0.4 && best.score - best.second >= 0.08 && reverse?.index === i && reverse.score - reverse.second >= 0.08) {
        middle.push([first + i, first + best.index]);
      }
    }
    // Reordered paragraphs are a grouped edit rather than conflicting controls.
    if (middle.every((pair, index) => index === 0 || pair[1] > middle[index - 1][1])) matches.push(...middle);
  }
  return [...matches, ...suffix.reverse()];
}

export function buildReview(source, rewritten) {
  source = String(source ?? '');
  rewritten = String(rewritten ?? '');
  const beforeSpans = sourceParagraphs(source);
  const afterSpans = sourceParagraphs(rewritten);
  const paragraphs = [];
  const changes = [];
  const span = (spans, first, end) => first < end ? { ...spans[first], end: spans[end - 1].end } : undefined;
  const add = (beforeFirst, beforeEnd, afterFirst, afterEnd) => {
    if (beforeFirst === beforeEnd && afterFirst === afterEnd) return;
    const beforeSpan = span(beforeSpans, beforeFirst, beforeEnd);
    const afterSpan = span(afterSpans, afterFirst, afterEnd);
    const original = beforeSpan ? source.slice(beforeSpan.start, beforeSpan.end) : '';
    const result = afterSpan ? rewritten.slice(afterSpan.start, afterSpan.end) : '';
    const changed = original !== result;
    const index = paragraphs.length;
    const entry = {
      id: `p${index}`,
      index,
      before: original,
      after: result,
      changed,
      beforeSpan,
      afterSpan,
      beforeCount: beforeEnd - beforeFirst,
      afterCount: afterEnd - afterFirst,
      ops: changed ? wordOps(tokenize(original), tokenize(result)) : [],
    };
    paragraphs.push(entry);
    if (changed) changes.push(entry);
  };
  let beforeFirst = 0;
  let afterFirst = 0;
  for (const [beforeIndex, afterIndex] of paragraphMatches(beforeSpans, afterSpans)) {
    add(beforeFirst, beforeIndex, afterFirst, afterIndex);
    add(beforeIndex, beforeIndex + 1, afterIndex, afterIndex + 1);
    beforeFirst = beforeIndex + 1;
    afterFirst = afterIndex + 1;
  }
  add(beforeFirst, beforeSpans.length, afterFirst, afterSpans.length);

  return { paragraphs, changes, source, rewritten };
}

/** decisions: { [paragraphId]: boolean } - absent means accepted. */
export function composeReview(review, decisions) {
  const rejected = review.changes.filter((paragraph) => decisions[paragraph.id] === false);
  // Avoid rebuilding accepted output: it must match the text that was audited,
  // including CRLF, indentation, leading/trailing whitespace and blank-line gaps.
  if (!rejected.length) return review.rewritten;
  if (rejected.length === review.changes.length) return review.source;

  const edits = rejected.map((paragraph) => {
    const previous = review.paragraphs.slice(0, paragraph.index).reverse().find((entry) => entry.afterSpan);
    const next = review.paragraphs.slice(paragraph.index + 1).find((entry) => entry.afterSpan);
    if (paragraph.afterSpan) {
      if (paragraph.beforeSpan) return { start: paragraph.afterSpan.start, end: paragraph.afterSpan.end, text: paragraph.before };
      // Reject an insertion together with one separator, avoiding an empty
      // paragraph where the inserted content used to be.
      return {
        start: !next && previous ? previous.afterSpan.end : paragraph.afterSpan.start,
        end: next ? next.afterSpan.start : paragraph.afterSpan.end,
        text: '',
      };
    }
    if (next) {
      const separator = review.source.slice(paragraph.beforeSpan.end, next.beforeSpan.start);
      return { start: next.afterSpan.start, end: next.afterSpan.start, text: paragraph.before + separator };
    }
    const separator = review.source.slice(previous?.beforeSpan.end ?? 0, paragraph.beforeSpan.start);
    const position = previous?.afterSpan.end ?? 0;
    return { start: position, end: position, text: separator + paragraph.before };
  }).sort((a, b) => a.start - b.start || a.end - b.end);
  let result = '';
  let cursor = 0;
  for (const edit of edits) {
    result += review.rewritten.slice(cursor, edit.start) + edit.text;
    cursor = edit.end;
  }
  return result + review.rewritten.slice(cursor);
}

export function countWords(text) {
  return String(text || '').trim().split(/\s+/).filter(Boolean).length;
}

/** How many words a paragraph's rewrite added and removed. */
export function opStats(ops) {
  return (ops || []).reduce(
    (stats, op) => {
      const words = countWords(op.text);
      if (op.type === 'ins') stats.inserted += words;
      else if (op.type === 'del') stats.deleted += words;
      return stats;
    },
    { inserted: 0, deleted: 0 },
  );
}

/** Document-level view of the rewrite, for the tracked-changes header. */
export function reviewSummary(review) {
  const paragraphs = review?.paragraphs || [];
  const changes = review?.changes || [];
  const words = changes.reduce(
    (totals, paragraph) => {
      const stats = opStats(paragraph.ops);
      totals.inserted += stats.inserted;
      totals.deleted += stats.deleted;
      return totals;
    },
    { inserted: 0, deleted: 0 },
  );

  return {
    total: paragraphs.length,
    changed: changes.length,
    unchanged: paragraphs.length - changes.length,
    inserted: words.inserted,
    deleted: words.deleted,
  };
}
