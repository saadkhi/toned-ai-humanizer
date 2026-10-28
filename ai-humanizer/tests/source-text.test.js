import test from 'node:test';
import assert from 'node:assert/strict';
import { sourceParagraphs } from '../shared/source-text.js';

test('paragraph spans support platform line endings and whitespace-only blank lines', () => {
  for (const separator of ['\n\n', '\r\n\r\n', '\n \n', '\r\n\t\r\n', '\r\r']) {
    const input = `First paragraph.${separator}    Second paragraph.`;
    const spans = sourceParagraphs(input);
    assert.equal(spans.length, 2);
    assert.equal(spans[1].text, '    Second paragraph.');
    assert.equal(spans[1].start, input.indexOf('    Second'));
    for (const span of spans) assert.equal(input.slice(span.start, span.end), span.text);
  }
});

test('single CRLF line endings remain within their paragraph', () => {
  const input = 'Line one.\r\n    Line two.\r\n';
  assert.equal(sourceParagraphs(input).length, 1);
  assert.equal(sourceParagraphs(input)[0].text, input);
});

test('leading blank lines do not create phantom extraction paragraph indices', () => {
  const input = '\r\n\r\n    First.\n \nSecond.\n\n';
  const spans = sourceParagraphs(input);
  assert.deepEqual(spans.map((span) => span.index), [0, 1]);
  assert.deepEqual(spans.map((span) => span.text), ['    First.', 'Second.']);
});
