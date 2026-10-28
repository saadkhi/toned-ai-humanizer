const SEVERITY = {
  high: 'bg-destructive/12 text-destructive',
  medium: 'bg-warning/15 text-warning',
  low: 'bg-secondary text-secondary-foreground',
};

export default function NotesPanel({ job }) {
  const findings = job.diagnosis?.patterns ?? job.diagnosis?.findings ?? [];
  const notes = job.notes || '';
  const metadata = [
    ['Latest provider', job.provider],
    ['Latest quality model', job.model_quality],
    ['Latest fast model', job.model_fast],
    ['Prompt version', job.prompt_version],
  ].filter(([, value]) => value);

  return (
    <div className="space-y-6 [overflow-wrap:anywhere]">
      <div className="space-y-2">
        <p className="eyebrow">Editor&apos;s notes</p>
        {notes ? (
          <p className="whitespace-pre-wrap text-sm leading-relaxed text-muted-foreground">{notes}</p>
        ) : (
          <p className="text-sm text-muted-foreground">No additional editor notes were recorded.</p>
        )}
      </div>

      {findings.length ? (
        <div className="space-y-2">
          <p className="eyebrow">Patterns noted in the original</p>
          <ul className="divide-y divide-border/60 overflow-hidden rounded-xl border border-border/70">
            {findings.map((finding, index) => (
              <li key={index} className="flex flex-wrap items-start justify-between gap-3 bg-card px-3 py-2.5">
                <div className="min-w-0 max-w-full">
                  <p className="whitespace-pre-wrap text-sm">{finding.pattern}</p>
                  {finding.location ? <p className="mt-0.5 whitespace-pre-wrap font-mono text-[0.68rem] text-muted-foreground">
                    {finding.location}
                  </p> : null}
                </div>
                {finding.severity ? <span
                  className={`rounded-full px-2 py-0.5 text-[0.68rem] uppercase tracking-[0.12em] ${
                    SEVERITY[finding.severity] || SEVERITY.low
                  }`}
                >
                  {finding.severity}
                </span> : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {metadata.length ? <dl className="space-y-1 font-mono text-xs text-muted-foreground">
        {metadata.map(([label, value]) => <div key={label} className="flex flex-wrap gap-x-2">
          <dt>{label}:</dt><dd>{value}</dd>
        </div>)}
      </dl> : null}
    </div>
  );
}
