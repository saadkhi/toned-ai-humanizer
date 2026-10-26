import { STYLE_OPTIONS } from '@/lib/constants';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

const OPTIONS = [...STYLE_OPTIONS, { value: 'custom', label: 'Custom voice', blurb: 'You describe the register in a sentence or two.' }];

export default function StyleChooser({ style, customStyle, onStyle, onCustomStyle }) {
  return (
    <div className="space-y-3">
      <Label className="eyebrow">Voice</Label>
      <div className="space-y-2">
        {OPTIONS.map((option) => {
          const active = style === option.value;
          return (
            <button
              key={option.value}
              type="button"
              aria-pressed={active}
              onClick={() => onStyle(option.value)}
              className={`w-full rounded-xl border px-3 py-2 text-left transition-colors ${
                active ? 'border-primary/45 bg-secondary' : 'border-border/80 hover:border-primary/30'
              }`}
            >
              <span className="block text-sm font-medium">{option.label}</span>
              <span className="mt-0.5 block text-xs leading-relaxed text-muted-foreground">
                {option.blurb}
              </span>
            </button>
          );
        })}
      </div>
      {style === 'custom' ? (
        <Input
          value={customStyle}
          maxLength={1000}
          onChange={(event) => onCustomStyle(event.target.value)}
          placeholder="Plain and short. No throat-clearing."
          aria-label="Custom voice instruction"
        />
      ) : null}
    </div>
  );
}