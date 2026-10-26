import { countWords } from '@/lib/diff';

export default function InputPane({ value, onChange, onFile, onError, maxChars }) {
  const characters = value.text.length;
  const over = characters > maxChars;

  const handleFile = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    try {
      const text = await onFile(file);
      onChange({ text, filename: file.name });
      onError('');
    } catch (error) {
      onError(error.message);
    }
  };

  return (
    <section className="rounded-2xl border border-border/80 bg-card p-5 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="eyebrow">Your document</p>
        <label className="cursor-pointer text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline">
          Open a .txt or .md file
          <input type="file" accept=".txt,.md,.markdown" className="hidden" onChange={handleFile} />
        </label>
      </div>
      <textarea
        value={value.text}
        onChange={(event) => onChange({ text: event.target.value, filename: '' })}
        placeholder="Paste the raw, rushed or AI-assisted draft here..."
        aria-label="Your document"
        className="mt-4 min-h-[22rem] w-full resize-y rounded-xl border border-border/70 bg-background/60 p-4 font-body text-[0.95rem] leading-relaxed outline-none transition-shadow placeholder:text-muted-foreground/70 focus:border-primary/40 focus:ring-2 focus:ring-ring/25"
      />
      <div className="mt-2 flex flex-wrap items-center justify-between gap-2 font-mono text-xs">
        <span className={over ? 'text-destructive' : 'text-muted-foreground'}>
          {characters.toLocaleString()} / {maxChars.toLocaleString()} characters · {countWords(value.text)} words
        </span>
        {value.filename ? <span className="text-muted-foreground">{value.filename}</span> : null}
      </div>
      {over ? (
        <p className="mt-2 text-xs text-destructive">
          Over the limit. Split the document into shorter sections before rewriting.
        </p>
      ) : null}
    </section>
  );
}