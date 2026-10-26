const STAGES = [
  {
    name: 'Extract',
    body: 'The first pass identifies claims, numbers, names, citations and quotations to guide the rewrite and later checks.',
  },
  {
    name: 'Diagnose',
    body: 'A second pass reads the prose for machine habits — uniform sentence length, stock transitions, triads, empty intensifiers — and sets a rewrite plan.',
  },
  {
    name: 'Rewrite',
    body: 'The rewrite works paragraph by paragraph in your chosen voice. The paragraph is the unit of change, not the sentence.',
  },
  {
    name: 'Audit',
    body: 'Code checks exact values and quotations. A separate model pass compares the result with your original to look for factual changes.',
  },
  {
    name: 'Repair',
    body: 'Flagged changes are sent for repair, then checked again. Unresolved issues are shown for your review; no automated audit guarantees accuracy.',
  },
];

export default function StageList() {
  return (
    <section id="how" className="mx-auto w-full max-w-6xl px-4 py-14 sm:px-6">
      <p className="eyebrow">How it works</p>
      <h2 className="mt-4 max-w-2xl text-3xl sm:text-4xl">
        A careful rewrite, followed by a separate review.
      </h2>
      <ol className="mt-10 space-y-0">
        {STAGES.map((stage, index) => (
          <li
            key={stage.name}
            className="grid gap-3 border-t border-border/70 py-6 sm:grid-cols-[4rem_10rem_1fr] sm:items-baseline sm:gap-6"
          >
            <span className="font-mono text-sm text-accent">{String(index + 1).padStart(2, '0')}</span>
            <span className="font-heading text-lg">{stage.name}</span>
            <span className="leading-relaxed text-muted-foreground">{stage.body}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}