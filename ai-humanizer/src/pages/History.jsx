import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { jobStore } from '@/lib/jobStore';
import { Button } from '@/components/ui/button';
import HistoryRow from '@/components/history/HistoryRow';

export default function History() {
  const [jobs, setJobs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [page, setPage] = useState(0);
  const pageSize = 20;

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      // Retention sweep: remove expired jobs before rendering.
      try {
        await jobStore.RewriteJob.deleteMany({
          expires_at: { $lt: new Date().toISOString() },
        });
      } catch {
        // best-effort — a failed sweep must not hide saved rewrites
      }
      const rows = await jobStore.RewriteJob.list('-created_date', Infinity);
      setJobs(rows);
    } catch (loadError) {
      setError(loadError.message || 'Your history could not be loaded.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const pageCount = Math.ceil(jobs.length / pageSize);
  const currentPage = Math.min(page, Math.max(0, pageCount - 1));
  const visibleJobs = jobs.slice(currentPage * pageSize, (currentPage + 1) * pageSize);

  return (
    <div className="space-y-8">
      <header className="max-w-3xl">
        <p className="eyebrow">History</p>
        <h1 className="mt-3 text-3xl sm:text-4xl">Everything you have rewritten.</h1>
        <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
          Each entry keeps the original, the rewrite and the full audit report. Expired rewrites are
          deleted automatically when you use the app.
        </p>
      </header>

      {error ? (
        <div className="rounded-2xl border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive">
          {error}
        </div>
      ) : null}

      {loading ? (
        <div className="space-y-3">
          {[0, 1, 2].map((key) => (
            <div key={key} className="h-20 animate-pulse rounded-2xl border border-border/70 bg-muted/40" />
          ))}
        </div>
      ) : null}

      {!loading && !error && !jobs.length ? (
        <div className="rounded-2xl border border-dashed border-border bg-card p-10 text-center">
          <p className="font-heading text-xl">No rewrites yet</p>
          <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-muted-foreground">
            Paste a draft into the editor and the result, its tracked changes and its audit report will
            appear here.
          </p>
          <Button asChild className="mt-6">
            <Link to="/editor">Open the editor</Link>
          </Button>
        </div>
      ) : null}

      {!loading && !error && jobs.length ? (
        <ul className="space-y-3">
          {visibleJobs.map((job) => (
            <HistoryRow
              key={job.id}
              job={job}
              onDeleted={(id) => setJobs((current) => current.filter((item) => item.id !== id))}
            />
          ))}
        </ul>
      ) : null}

      {!loading && !error && jobs.length > 0 ? (
        <nav aria-label="History pages" className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-muted-foreground">Showing {currentPage * pageSize + 1}–{Math.min((currentPage + 1) * pageSize, jobs.length)} of {jobs.length} rewrites</p>
          {pageCount > 1 ? <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}>Previous page</Button>
            <span className="text-xs text-muted-foreground">{currentPage + 1} / {pageCount}</span>
            <Button variant="outline" size="sm" disabled={currentPage >= pageCount - 1} onClick={() => setPage(currentPage + 1)}>Next page</Button>
          </div> : null}
        </nav>
      ) : null}
    </div>
  );
}
