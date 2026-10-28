import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import DiffParagraph from '@/components/editor/DiffParagraph';
import { reviewSummary } from '@/lib/diff';

const MODES = [
  { id: 'inline', label: 'Inline' },
  { id: 'split', label: 'Side by side' },
];

export default function DiffReview({ review, decisions, onToggle, onAll }) {
  const [mode, setMode] = useState('inline');
  const [changesOnly, setChangesOnly] = useState(false);

  const summary = reviewSummary(review);
  const accepted = (id) => decisions[id] !== false;
  const visible = changesOnly ? review.changes : review.paragraphs;

  return (
    <div className="space-y-4">
      <div className="space-y-3 rounded-xl border border-border/70 bg-muted/25 px-4 py-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="font-mono text-xs text-muted-foreground">
            {summary.changed} of {summary.total} passage(s) changed · {summary.inserted} words added ·{' '}
            {summary.deleted} removed
          </p>
          <div className="flex overflow-hidden rounded-full border border-border/80">
            {MODES.map((option) => (
              <button
                key={option.id}
                type="button"
                onClick={() => setMode(option.id)}
                aria-pressed={mode === option.id}
                className={`px-3 py-1 text-xs transition-colors ${
                  mode === option.id
                    ? 'bg-primary text-primary-foreground'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border/60 pt-3">
          <div className="flex items-center gap-2">
            <Switch id="changes-only" checked={changesOnly} onCheckedChange={setChangesOnly} />
            <Label htmlFor="changes-only" className="text-xs text-muted-foreground">
              Changed passages only
            </Label>
          </div>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={() => onAll(true)}>
              Accept all
            </Button>
            <Button size="sm" variant="outline" onClick={() => onAll(false)}>
              Reject all
            </Button>
          </div>
        </div>
      </div>

      {summary.changed === 0 ? (
        <p className="rounded-xl border border-border/60 bg-card px-4 py-3 text-sm text-muted-foreground">
          The rewrite came back word for word the same as your draft, so there is nothing to accept or
          reject.
        </p>
      ) : null}

      {summary.changed && mode === 'inline' ? (
        <p className="font-mono text-xs text-muted-foreground">
          Underlined green text was added, struck-through text was removed.
        </p>
      ) : null}

      {review.paragraphs.some((paragraph) => paragraph.beforeCount > 1 || paragraph.afterCount > 1) ? (
        <p className="text-xs leading-relaxed text-muted-foreground">
          Some passages contain several paragraphs. Review those paragraphs together when their structure has changed.
        </p>
      ) : null}

      <div className="space-y-3">
        {visible.map((paragraph) => (
          <DiffParagraph
            key={paragraph.id}
            paragraph={paragraph}
            accepted={accepted(paragraph.id)}
            mode={mode}
            onToggle={onToggle}
          />
        ))}
      </div>

      {changesOnly && summary.unchanged ? (
        <p className="font-mono text-xs text-muted-foreground">
          {summary.unchanged} unchanged passage(s) hidden.
        </p>
      ) : null}
    </div>
  );
}
