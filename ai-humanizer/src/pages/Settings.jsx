import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { jobStore } from '@/lib/jobStore';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { RETENTION_OPTIONS } from '@/lib/constants';

export default function Settings() {
  const [retention, setRetention] = useState(30);
  const [savedRetention, setSavedRetention] = useState(30);
  const [settingId, setSettingId] = useState(null);
  const [summary, setSummary] = useState({ jobs: 0, words: 0 });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [wiping, setWiping] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const load = async () => {
    setLoading(true);
    const [settings, jobs] = await Promise.all([
      jobStore.UserSetting.list('-created_date', 1),
      jobStore.RewriteJob.list('-created_date', 200),
    ]);
    const setting = settings?.[0];
    if (setting) {
      setSettingId(setting.id);
      setRetention(setting.retention_days ?? 30);
      setSavedRetention(setting.retention_days ?? 30);
    }
    setSummary({
      jobs: jobs.length,
      words: jobs.reduce((t, j) => t + (j.source_words || 0) + (j.result_words || 0), 0),
    });
    setLoading(false);
  };

  useEffect(() => {
    load().catch((loadError) => { setError(loadError.message); setLoading(false); });
  }, []);

  const save = async () => {
    setSaving(true);
    setMessage('');
    setError('');
    try {
      if (settingId) {
        await jobStore.UserSetting.update(settingId, { retention_days: retention });
      } else {
        const created = await jobStore.UserSetting.create({ retention_days: retention });
        setSettingId(created.id);
      }
      setSavedRetention(retention);
      setMessage('Saved. New rewrites follow this window.');
    } catch (saveError) {
      setError(saveError.message || 'Settings could not be saved.');
    } finally {
      setSaving(false);
    }
  };

  const wipe = async () => {
    setWiping(true);
    setMessage('');
    setError('');
    try {
      await jobStore.RewriteJob.deleteMany({ created_by_id: 'local' });
      setMessage('Every rewrite, tracked change and audit report has been deleted.');
      await load();
    } catch (wipeError) {
      setError(wipeError.message || 'Your saved rewrites could not be deleted.');
    } finally {
      setWiping(false);
    }
  };

  return (
    <div className="space-y-8">
      <header className="max-w-3xl">
        <p className="eyebrow">Data &amp; settings</p>
        <h1 className="mt-3 text-3xl sm:text-4xl">Your text, your window.</h1>
        <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
          Choose how long this browser keeps your rewrites. Text sent for rewriting is processed by the configured AI provider under its own policies.
        </p>
      </header>

      {error ? <div role="alert" className="rounded-2xl border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive">{error}</div> : null}

      {message ? (
        <div className="rounded-2xl border border-success/35 bg-success/10 p-4 text-sm text-success">
          {message}
        </div>
      ) : null}

      <section className="grid gap-6 lg:grid-cols-2">
        <div className="rounded-2xl border border-border/80 bg-card p-6">
          <p className="eyebrow">Retention</p>
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
            Applies to new rewrites. Expired ones are deleted automatically when you use the app.
          </p>
          <RadioGroup
            value={String(retention)}
            onValueChange={(v) => setRetention(Number(v))}
            className="mt-5 space-y-3"
          >
            {RETENTION_OPTIONS.map((option) => (
              <div key={option.value} className="flex items-start gap-3">
                <RadioGroupItem value={String(option.value)} id={`retention-${option.value}`} className="mt-0.5" />
                <Label htmlFor={`retention-${option.value}`} className="font-normal leading-relaxed">
                  {option.label}
                  {option.note ? <span className="block text-xs text-muted-foreground">{option.note}</span> : null}
                </Label>
              </div>
            ))}
          </RadioGroup>
          <Button
            className="mt-6"
            onClick={save}
            disabled={saving || loading || retention === savedRetention}
          >
            {saving ? 'Saving…' : retention === savedRetention ? 'Saved' : 'Save retention window'}
          </Button>
        </div>

        <div className="space-y-6">
          <div className="rounded-2xl border border-border/80 bg-card p-6">
            <p className="eyebrow">What is stored</p>
            <dl className="mt-4 space-y-3 text-sm">
              <div className="flex items-baseline justify-between gap-4">
                <dt className="text-muted-foreground">Rewrites kept</dt>
                <dd className="font-mono">{summary.jobs}</dd>
              </div>
              <div className="flex items-baseline justify-between gap-4">
                <dt className="text-muted-foreground">Words stored</dt>
                <dd className="font-mono">{summary.words.toLocaleString()}</dd>
              </div>
              <div className="flex items-baseline justify-between gap-4">
                <dt className="text-muted-foreground">Voice samples</dt>
                <dd className="font-mono">none</dd>
              </div>
            </dl>
            <p className="mt-4 text-xs leading-relaxed text-muted-foreground">
              History is stored in this browser. File contents are read locally, then sent to an AI provider when you run a rewrite.
            </p>
          </div>

          <div className="rounded-2xl border border-destructive/35 bg-destructive/5 p-6">
            <p className="eyebrow text-destructive">Delete everything</p>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
              Removes every rewrite, tracked change and audit report from your browser immediately.
            </p>
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="destructive" className="mt-4" disabled={wiping}>
                  {wiping ? 'Deleting…' : 'Delete all my data'}
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Delete all your data?</AlertDialogTitle>
                  <AlertDialogDescription>
                    Every rewrite and audit report is removed immediately from your browser and cannot
                    be recovered.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Keep my data</AlertDialogCancel>
                  <AlertDialogAction onClick={wipe}>Delete everything</AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>

          <p className="text-xs text-muted-foreground">
            <Link to="/terms" className="underline underline-offset-4">Terms</Link>{' '}·{' '}
            <Link to="/privacy" className="underline underline-offset-4">Privacy</Link>
          </p>
        </div>
      </section>
    </div>
  );
}
