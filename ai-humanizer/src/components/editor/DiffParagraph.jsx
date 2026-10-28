import { opStats } from '@/lib/diff';

function Ops({ ops }) {
  return ops.map((op, index) => {
    if (op.type === 'equal') return <span key={index}>{op.text}</span>;
    if (op.type === 'ins') {
      return (
        <ins key={index} className="bg-success/12 text-success decoration-success/50">
          {op.text}
        </ins>
      );
    }
    return (
      <del key={index} className="text-muted-foreground/70 line-through">
        {op.text}
      </del>
    );
  });
}

/**
 * One passage of the review. Unchanged passages get a single muted block;
 * changed ones get the tracked markup (or both versions side by side) plus the
 * accept/reject control.
 */
export default function DiffParagraph({ paragraph, accepted, mode, onToggle }) {
  if (!paragraph.changed) {
    return (
      <div className="rounded-xl border border-border/40 bg-muted/20 px-4 py-3 [overflow-wrap:anywhere]">
        <p className="font-mono text-[0.62rem] uppercase tracking-[0.18em] text-muted-foreground/80">
          Unchanged · passage {paragraph.index + 1}
        </p>
        <p className="mt-1.5 whitespace-pre-wrap text-sm leading-relaxed text-muted-foreground">{paragraph.after || paragraph.before}</p>
      </div>
    );
  }

  const stats = opStats(paragraph.ops);

  return (
    <article
      className={`rounded-xl border p-4 transition-colors [overflow-wrap:anywhere] ${
        accepted ? 'border-primary/25 bg-card' : 'border-border/70 bg-muted/35'
      }`}
    >
      <header className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-2">
        <span className="font-mono text-[0.68rem] uppercase tracking-[0.18em] text-muted-foreground">
          Passage {paragraph.index + 1}
        </span>
        {stats.inserted ? (
          <span className="rounded-full border border-success/35 bg-success/10 px-2 py-0.5 font-mono text-[0.62rem] text-success">
            +{stats.inserted} words
          </span>
        ) : null}
        {stats.deleted ? (
          <span className="rounded-full border border-border/70 bg-muted/50 px-2 py-0.5 font-mono text-[0.62rem] text-muted-foreground">
            −{stats.deleted} words
          </span>
        ) : null}
        <button
          type="button"
          onClick={() => onToggle(paragraph.id)}
          className={`ml-auto rounded-full border px-3 py-1 text-xs transition-colors ${
            accepted
              ? 'border-border/80 text-muted-foreground hover:text-foreground'
              : 'border-primary/40 bg-secondary text-foreground'
          }`}
        >
          {accepted ? 'Reject this change' : 'Accept this change'}
        </button>
      </header>

      {paragraph.beforeCount > 1 || paragraph.afterCount > 1 ? (
        <p className="mb-3 text-xs text-muted-foreground">
          {paragraph.beforeCount} original paragraph(s) · {paragraph.afterCount} rewritten paragraph(s)
        </p>
      ) : null}

      {mode === 'split' ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-lg border border-border/50 bg-muted/20 p-3">
            <p className="font-mono text-[0.62rem] uppercase tracking-[0.18em] text-muted-foreground">
              Your draft
            </p>
            <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed">{paragraph.before}</p>
          </div>
          <div className="rounded-lg border border-primary/25 bg-secondary/40 p-3">
            <p className="font-mono text-[0.62rem] uppercase tracking-[0.18em] text-muted-foreground">
              Humanized
            </p>
            <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed">{paragraph.after}</p>
          </div>
        </div>
      ) : (
        <p className="whitespace-pre-wrap leading-relaxed">
          <Ops ops={paragraph.ops} />
        </p>
      )}

      {!accepted ? (
        <p className="mt-3 border-t border-border/60 pt-3 text-xs text-muted-foreground">
          {!paragraph.beforeSpan
            ? 'This added passage is excluded from the result.'
            : !paragraph.afterSpan
              ? 'Your original passage is restored in the result.'
              : 'Your original passage is kept in the result.'}
        </p>
      ) : null}
    </article>
  );
}
