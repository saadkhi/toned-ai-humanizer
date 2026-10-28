/** Raw paragraph spans shared by the API and review UI. Offsets are UTF-16 indices. */
export function sourceParagraphs(value) {
  const source = String(value ?? '');
  // A blank line may contain spaces or tabs and may use CRLF, LF, or CR.
  // Do not consume indentation belonging to the following nonblank line.
  const newline = '(?:\\r?\\n|\\r(?!\\n))';
  const separators = new RegExp(`${newline}[\\t ]*${newline}(?:[\\t ]*${newline})*`, 'g');
  const paragraphs = [];
  let start = 0;
  const add = (end) => {
    const text = source.slice(start, end);
    if (text.trim()) paragraphs.push({ index: paragraphs.length, text, start, end });
  };
  for (const separator of source.matchAll(separators)) {
    add(separator.index);
    start = separator.index + separator[0].length;
  }
  add(source.length);
  return paragraphs;
}
