import { useEffect, useState } from 'react';
import { jobStore } from '@/lib/jobStore';
import { summarizeUsage } from '@/lib/usage';
import { Bar, BarChart, Cell, ResponsiveContainer, Tooltip, XAxis } from 'recharts';

function Stat({ label, value, note }) {
  return (
    <div className="rounded-2xl border border-border/80 bg-card p-5">
      <p className="font-mono text-2xl leading-none">{value}</p>
      <p className="mt-2 text-[0.7rem] uppercase tracking-[0.16em] text-muted-foreground">{label}</p>
      {note ? <p className="mt-1 text-xs text-muted-foreground">{note}</p> : null}
    </div>
  );
}

export default function Usage() {
  const [jobs, setJobs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    jobStore.RewriteJob.list('-created_date', Infinity)
      .then(setJobs)
      .catch((loadError) => setError(loadError.message || 'Your usage could not be loaded.'))
      .finally(() => setLoading(false));
  }, []);

  const usage = summarizeUsage(jobs);

  return (
    <div className="space-y-8">
      <header className="max-w-3xl">
        <p className="eyebrow">Usage</p>
        <h1 className="mt-3 text-3xl sm:text-4xl">What you have processed.</h1>
        <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
          Counts and estimated model costs from the rewrite history saved in this browser.
          Deleted, expired and unsaved rewrites are not included.
        </p>
      </header>

      {error ? <p role="alert" className="rounded-xl border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive">{error}</p> : null}

      {!error && loading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {[0, 1, 2, 3].map((key) => (
            <div key={key} className="h-24 animate-pulse rounded-2xl border border-border/70 bg-muted/40" />
          ))}
        </div>
      ) : !error ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Stat label="Words this month" value={usage.monthWords.toLocaleString()} />
          <Stat label="Rewrites this month" value={usage.monthJobs} />
          <Stat label="Words all time" value={usage.sourceWords.toLocaleString()} />
          <Stat
            label="Cost per 1,000 words"
            value={`$${(usage.perThousandWords || 0).toFixed(4)}`}
            note={`$${usage.cost.toFixed(4)} across ${usage.jobs} job(s)`}
          />
        </div>
      ) : null}

      {!error ? <section className="rounded-2xl border border-border/80 bg-card p-6">
        <p className="eyebrow">Words processed per month</p>
        <div className="mt-6 h-56 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={usage.months} margin={{ top: 4, right: 4, bottom: 0, left: 4 }}>
              <XAxis
                dataKey="label"
                axisLine={false}
                tickLine={false}
                tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 12 }}
              />
              <Tooltip
                cursor={{ fill: 'hsl(var(--muted))' }}
                contentStyle={{
                  background: 'hsl(var(--popover))',
                  border: '1px solid hsl(var(--border))',
                  borderRadius: 12,
                  fontSize: 12,
                }}
              />
              <Bar dataKey="words" radius={[6, 6, 0, 0]}>
                {usage.months.map((month) => (
                  <Cell key={month.label} fill="hsl(var(--chart-1))" />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </section> : null}

      <p className="text-xs leading-relaxed text-muted-foreground">
        Cost is an estimate based on reported token counts and configured pricing. Provider invoices may differ.
      </p>
    </div>
  );
}
