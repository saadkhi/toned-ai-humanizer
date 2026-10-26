import { formatAuditFlag } from '@/lib/audit';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import DiffReview from '@/components/editor/DiffReview';
import AuditPanel from '@/components/editor/AuditPanel';
import NotesPanel from '@/components/editor/NotesPanel';
import { downloadText } from '@/lib/humanize';
import { styleLabel } from '@/lib/constants';
import { AlertTriangle, Check, Copy, Download, RotateCcw } from 'lucide-react';

export default function ResultPanel({ job, review, decisions, onToggle, onAll, text, onNew }) {
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState(false);
  const changedReview = Object.values(decisions).some((accepted) => accepted === false);
  const flags = job.unresolved_flags || [];

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setCopyError(false);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
      setCopyError(true);
    }
  };

  return (
    <section className="space-y-5">
      {flags.length ? (
        <div className="rounded-2xl border border-warning/45 bg-warning/10 p-4">
          <p className="flex items-center gap-2 text-sm font-medium text-warning">
            <AlertTriangle className="h-4 w-4" />
            {flags.length} item(s) need your judgement before you publish
          </p>
          <ul className="mt-2 space-y-1 text-xs leading-relaxed text-warning/95">
            {flags.slice(0, 5).map((flag, index) => (
              <li key={index}>{formatAuditFlag(flag)}</li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-muted-foreground">
            These items remain unresolved after automated checks. Compare them with your original in the Claim audit tab.
          </p>
        </div>
      ) : (
        <div className="flex items-center gap-2 rounded-2xl border border-success/35 bg-success/10 p-4 text-sm text-success">
          <Check className="h-4 w-4" />
          Automated checks found no unresolved issues. Please review the result for accuracy.
        </div>
      )}

      {changedReview ? <p role="status" className="rounded-xl border border-border p-3 text-sm text-muted-foreground">You have rejected changes. The audit describes the AI rewrite before your edits; review your final text again before sharing.</p> : null}
      {copyError ? <p role="status" className="text-sm text-destructive">Copy was unavailable. Select the clean result to copy it, or download a file.</p> : null}

      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 className="text-2xl">{job.title || 'Your rewrite'}</h2>
          <p className="mt-1 font-mono text-xs text-muted-foreground">
            {styleLabel(job.style, job.custom_style)} · {job.source_words || 0} words in ·{' '}
            {job.result_words || 0} out · ${Number(job.cost_estimate || 0).toFixed(4)} ·{' '}
            {job.repair_loops || 0} repair pass(es)
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" onClick={copy}>
            {copied ? <Check className="mr-1.5 h-3.5 w-3.5" /> : <Copy className="mr-1.5 h-3.5 w-3.5" />}
            {copied ? 'Copied' : 'Copy'}
          </Button>
          <Button size="sm" variant="outline" onClick={() => downloadText(text, `${job.title || 'rewrite'}.txt`)}>
            <Download className="mr-1.5 h-3.5 w-3.5" /> .txt
          </Button>
          <Button size="sm" variant="outline" onClick={() => downloadText(text, `${job.title || 'rewrite'}.md`)}>
            <Download className="mr-1.5 h-3.5 w-3.5" /> .md
          </Button>
          <Button size="sm" onClick={onNew}>
            <RotateCcw className="mr-1.5 h-3.5 w-3.5" /> New rewrite
          </Button>
        </div>
      </div>

      <Tabs defaultValue="changes">
        <TabsList>
          <TabsTrigger value="changes">Tracked changes</TabsTrigger>
          <TabsTrigger value="clean">Clean result</TabsTrigger>
          <TabsTrigger value="audit">Claim audit</TabsTrigger>
          <TabsTrigger value="notes">Editor&apos;s notes</TabsTrigger>
        </TabsList>
        <TabsContent value="changes" className="mt-5">
          <DiffReview review={review} decisions={decisions} onToggle={onToggle} onAll={onAll} />
        </TabsContent>
        <TabsContent value="clean" className="mt-5">
          <article className="prose-result rounded-2xl border border-border/80 bg-card p-6 leading-relaxed">
            {text.split(/\n{2,}/).map((paragraph, index) => (
              <p key={index}>{paragraph}</p>
            ))}
          </article>
        </TabsContent>
        <TabsContent value="audit" className="mt-5">
          <AuditPanel audit={job.audit} flags={flags} />
        </TabsContent>
        <TabsContent value="notes" className="mt-5">
          <NotesPanel job={job} />
        </TabsContent>
      </Tabs>
    </section>
  );
}