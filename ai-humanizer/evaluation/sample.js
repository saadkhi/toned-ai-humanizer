import { readFileSync } from 'node:fs';

/** Synthetic machine-written sample. These are test facts, not research results. */
export const AI_STYLE_SAMPLE = {
  id: 'fictional-pilot-v1',
  description: 'A fictional pilot report containing deliberate stock phrasing and exact source constraints.',
  source: readFileSync(new URL('./ai-style-sample.txt', import.meta.url), 'utf8').trimEnd(),
  requiredSpans: [
    { label: 'participant count', value: '42', numeric: true },
    { label: 'estimated reduction', value: '12%', numeric: true },
    { label: 'pilot start date', value: '14 March 2026' },
    { label: 'planned review date', value: 'June 2026' },
    { label: 'organisation', value: 'Northbridge Lab' },
    { label: 'named speaker', value: 'Dr. Amina Khan' },
    { label: 'verbatim quotation', value: 'The findings are preliminary.', kind: 'quotation' },
    { label: 'citation marker', value: '[1]' },
    { label: 'reference URL', value: 'https://example.org/pilot', kind: 'url' },
  ],
  uncertaintyMarkers: ['may', 'approximately', 'preliminary'],
  stockPhrases: [
    'it is important to note', "in today's rapidly evolving landscape", 'leverage',
    'robust', 'seamless', 'furthermore', 'delve', 'moreover', 'pivotal',
    'in conclusion', 'it is worth noting',
  ],
};
