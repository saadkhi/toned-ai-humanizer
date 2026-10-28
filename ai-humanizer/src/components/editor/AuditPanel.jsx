import { formatAuditFlag } from '@/lib/audit';
const STATUS_STYLES = {
  preserved: 'bg-success/12 text-success',
  altered: 'bg-destructive/12 text-destructive',
  missing: 'bg-destructive/12 text-destructive',
  added: 'bg-warning/15 text-warning',
};

function Stat({ label, value, tone }) {
  return (
    <div className="rounded-xl border border-border/70 bg-card px-3 py-2">
      <p className="font-mono text-lg leading-none">{value}</p>
      <p className={`mt-1 text-[0.68rem] uppercase tracking-[0.14em] ${tone || 'text-muted-foreground'}`}>
        {label}
      </p>
    </div>
  );
}

export default function AuditPanel({ audit, flags }) {
  if (!audit) {
    return <p className="text-sm text-muted-foreground">The audit has not run yet.</p>;
  }

  const items = audit.items || [];
  const counts = items.reduce(
    (accumulator, item) => {
      accumulator[item.status] = (accumulator[item.status] || 0) + 1;
      return accumulator;
    },
    { preserved: 0, altered: 0, missing: 0, added: 0 },
  );
  const shifts = (audit.certainty || []).filter((entry) => entry.status && entry.status !== 'none');

  return (
    <div className="space-y-6 [overflow-wrap:anywhere]">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Preserved" value={counts.preserved || 0} tone="text-success" />
        <Stat label="Altered" value={counts.altered || 0} tone={counts.altered ? 'text-destructive' : undefined} />
        <Stat label="Missing" value={counts.missing || 0} tone={counts.missing ? 'text-destructive' : undefined} />
        <Stat label="Added" value={counts.added || 0} tone={counts.added ? 'text-warning' : undefined} />
      </div>

      <p className="text-sm leading-relaxed text-muted-foreground">{audit.summary}</p>
      <p className="text-xs leading-relaxed text-muted-foreground">This automated comparison checks consistency with your original. It does not verify the underlying facts or approve the text for publication.</p>

      {flags?.length ? (
        <div className="rounded-xl border border-warning/40 bg-warning/10 p-4">
          <p className="text-sm font-medium text-warning">Unresolved after repair</p>
          <ul className="mt-2 space-y-1 text-xs text-warning/95">
            {flags.slice(0, 12).map((flag, index) => (
              <li key={index}>{formatAuditFlag(flag)}</li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="space-y-2">
        <p className="eyebrow">Items checked</p>
        <ul className="divide-y divide-border/60 overflow-hidden rounded-xl border border-border/70">
          {items.map((item, index) => (
            <li key={index} className="flex flex-wrap items-start justify-between gap-2 bg-card px-3 py-2.5">
              <div className="min-w-0">
                <p className="text-sm">{item.value}</p>
                <p className="mt-0.5 font-mono text-[0.68rem] uppercase tracking-[0.12em] text-muted-foreground">
                  {item.kind}
                  {item.note ? ` · ${item.note}` : ''}
                </p>
              </div>
              <span
                className={`rounded-full px-2 py-0.5 text-[0.68rem] uppercase tracking-[0.12em] ${
                  STATUS_STYLES[item.status] || 'bg-secondary text-secondary-foreground'
                }`}
              >
                {item.status}
              </span>
            </li>
          ))}
        </ul>
      </div>

      {shifts.length ? (
        <div className="space-y-2">
          <p className="eyebrow">Certainty shifts</p>
          <ul className="space-y-1.5">
            {shifts.map((shift, index) => (
              <li key={index} className="text-sm text-muted-foreground">
                <span className="font-mono text-xs text-destructive">{shift.status}</span>{' '}
                &ldquo;{shift.marker}&rdquo;{shift.note ? ` — ${shift.note}` : ''}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {(audit.format_violations || []).length ? (
        <div className="space-y-2">
          <p className="eyebrow">Formatting</p>
          <ul className="space-y-1.5">
            {audit.format_violations.map((violation, index) => (
              <li key={index} className="text-sm text-muted-foreground">
                {violation.rule}
                {violation.note ? ` — ${violation.note}` : ''}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
