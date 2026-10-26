import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import StyleChooser from '@/components/editor/StyleChooser';
import { LENGTH_OPTIONS } from '@/lib/constants';
import { Loader2, Wand2 } from 'lucide-react';

function RetentionLine({ retentionDays }) {
  const copy =
    retentionDays === 0
      ? 'Not saved: this rewrite is kept only while this page is open.'
      : `Saved to your history for ${retentionDays} days. Expired rewrites are removed when you use the app.`;
  return <p className="text-xs leading-relaxed text-muted-foreground">{copy}</p>;
}

export default function ControlPane({ value, onChange, onRun, running, retentionDays, available = true }) {
  const canRun = available && !running && value.text.trim().length > 0 && value.text.length <= 20000;

  return (
    <section className="space-y-6 rounded-2xl border border-border/80 bg-card p-5 sm:p-6">
      <StyleChooser
        style={value.style}
        customStyle={value.customStyle}
        onStyle={(style) => onChange({ style })}
        onCustomStyle={(customStyle) => onChange({ customStyle })}
      />

      <div className="space-y-2">
        <Label htmlFor="purpose" className="eyebrow">
          Purpose (optional)
        </Label>
        <Input
          id="purpose"
          value={value.purpose}
          maxLength={1000}
          onChange={(event) => onChange({ purpose: event.target.value })}
          placeholder="A methods section for a journal"
        />
        <p className="text-xs leading-relaxed text-muted-foreground">
          Helps choose the right register. Sent to the AI provider with your document.
        </p>
      </div>

      <div className="space-y-3">
        <Label className="eyebrow">Keep</Label>
        <div className="space-y-2">
          <label className="flex items-center gap-2 text-sm">
            <Checkbox
              checked={value.prefs.preserve_headings}
              onCheckedChange={(checked) =>
                onChange({ prefs: { ...value.prefs, preserve_headings: checked === true } })
              }
            />
            Headings and their order
          </label>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox
              checked={value.prefs.preserve_lists}
              onCheckedChange={(checked) =>
                onChange({ prefs: { ...value.prefs, preserve_lists: checked === true } })
              }
            />
            Lists and their items
          </label>
        </div>
        <div className="flex flex-wrap gap-2 pt-1">
          {LENGTH_OPTIONS.map((option) => (
            <button
              key={option.value}
              type="button"
              aria-pressed={value.prefs.length_target === option.value}
              onClick={() => onChange({ prefs: { ...value.prefs, length_target: option.value } })}
              className={`rounded-full border px-3 py-1 text-xs transition-colors ${
                value.prefs.length_target === option.value
                  ? 'border-primary/45 bg-secondary'
                  : 'border-border/80 text-muted-foreground hover:text-foreground'
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-3">
        <Button className="w-full" size="lg" disabled={!canRun} onClick={onRun}>
          {running ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Rewriting
            </>
          ) : (
            <>
              <Wand2 className="mr-2 h-4 w-4" /> Rewrite this document
            </>
          )}
        </Button>
        <RetentionLine retentionDays={retentionDays} />
      </div>
    </section>
  );
}