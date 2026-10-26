import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { jobStore } from '@/lib/jobStore';
import { createJob, readTextFile, runPipeline } from '@/lib/humanize';
import { buildReview, composeReview } from '@/lib/diff';
import InputPane from '@/components/editor/InputPane';
import ControlPane from '@/components/editor/ControlPane';
import StageProgress from '@/components/editor/StageProgress';
import ResultPanel from '@/components/editor/ResultPanel';
import { AlertTriangle, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { requestJson } from '@/lib/request';

const MAX_CHARS = 20000;
const EMPTY_FORM = {
  text: '',
  filename: '',
  style: 'professional_researcher',
  customStyle: '',
  purpose: '',
  prefs: { preserve_headings: true, preserve_lists: true, length_target: 'same' },
};

export default function Editor() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [form, setForm] = useState(EMPTY_FORM);
  const [retention, setRetention] = useState(30);
  const [job, setJob] = useState(null);
  const [loading, setLoading] = useState(false);
  const [running, setRunning] = useState(false);
  const [stage, setStage] = useState('');
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState('');
  const [refusal, setRefusal] = useState('');
  const [decisions, setDecisions] = useState({});

  const activeRun = useRef(null);
  const temporaryJobId = useRef(null);
  const healthRequest = useRef(null);
  const [service, setService] = useState('checking');
  const jobId = searchParams.get('job');

  const checkService = useCallback(async () => {
    healthRequest.current?.abort();
    const controller = new AbortController();
    healthRequest.current = controller;
    setService('checking');
    try {
      const health = await requestJson('/api/health', {
        timeoutMs: 10000, signal: controller.signal, allowUnavailable: true,
      });
      if (!controller.signal.aborted) setService(health.configured === true ? 'ready' : 'unavailable');
    } catch {
      if (!controller.signal.aborted) setService('unavailable');
    }
  }, []);

  useEffect(() => {
    checkService();
    return () => {
      healthRequest.current?.abort();
      activeRun.current?.abort();
      if (temporaryJobId.current) jobStore.RewriteJob.delete(temporaryJobId.current).catch(() => {});
    };
  }, [checkService]);

  // Load saved retention preference
  useEffect(() => {
    jobStore.UserSetting.list('-created_date', 1)
      .then((rows) => {
        const stored = rows?.[0]?.retention_days;
        if (stored !== undefined && stored !== null) setRetention(stored);
      })
      .catch(() => {});
  }, []);

  // Load a job from localStorage when ?job= param is present
  useEffect(() => {
    if (!jobId) return undefined;
    let active = true;
    setLoading(true);
    jobStore.RewriteJob.get(jobId)
      .then((record) => {
        if (active) {
          setJob(record);
          setDecisions({});
          // Reopening an interrupted job should recover its input, not an empty draft.
          // During a current run the form already contains the user's latest choices.
          if (!record.final_text && !activeRun.current) {
            setForm({
              ...EMPTY_FORM,
              text: record.source_text || '',
              style: record.style || EMPTY_FORM.style,
              customStyle: record.custom_style || '',
              purpose: record.purpose || '',
              prefs: {
                preserve_headings: record.preserve_headings !== false,
                preserve_lists: record.preserve_lists !== false,
                length_target: record.length_target || 'same',
              },
            });
          }
        }
      })
      .catch(() => {
        if (active) setError('That rewrite could not be found.');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => { active = false; };
  }, [jobId]);

  const review = useMemo(
    () => (job?.final_text ? buildReview(job.source_text || '', job.final_text) : null),
    [job],
  );
  const text = useMemo(
    () => (review ? composeReview(review, decisions) : job?.final_text || ''),
    [review, decisions, job],
  );

  const update = (patch) => setForm((c) => ({ ...c, ...patch }));

  const handleRun = async () => {
    if (activeRun.current || service !== 'ready') return;
    setError('');
    setRefusal('');
    setDecisions({});
    if (!form.text.trim()) {
      setError('Paste or open a document first.');
      return;
    }
    if (form.text.length > MAX_CHARS) {
      setError(
        `That document is ${form.text.length.toLocaleString()} characters; the limit is ${MAX_CHARS.toLocaleString()}.`,
      );
      return;
    }

    const controller = new AbortController();
    activeRun.current = controller;
    setRunning(true);
    setStage('extract');
    setProgress(0);
    let created = null;
    try {
      created = await createJob({
        text: form.text,
        style: form.style,
        customStyle: form.customStyle,
        purpose: form.purpose,
        prefs: form.prefs,
        retentionDays: retention,
        filename: form.filename,
      });
      if (retention === 0) temporaryJobId.current = created.id;
      setJob(created);
      setSearchParams({ job: created.id }, { replace: true });

      const result = await runPipeline(created.id, ({ stage: s, progress: p }) => {
        setStage(s);
        setProgress(p);
      }, { signal: controller.signal });

      if (result.refused) {
        setRefusal(result.reason);
        setJob(await jobStore.RewriteJob.get(created.id));
        return;
      }

      if (retention === 0) {
        const finished = result.job;
        await jobStore.RewriteJob.delete(created.id);
        temporaryJobId.current = null;
        setSearchParams({}, { replace: true });
        setJob({ ...finished, id: created.id, retention_days: 0 });
      } else {
        setJob(result.job || (await jobStore.RewriteJob.get(created.id)));
      }
    } catch (runError) {
      const message = runError.message || 'The rewrite failed.';
      setError(message);
      if (created) {
        try {
          await jobStore.RewriteJob.update(created.id, { status: 'failed', error: message });
          setJob(await jobStore.RewriteJob.get(created.id));
        } catch {
          setJob(null);
        }
      }
    } finally {
      activeRun.current = null;
      setRunning(false);
    }
  };

  const handleNew = () => {
    if (temporaryJobId.current) {
      jobStore.RewriteJob.delete(temporaryJobId.current).catch(() => {});
      temporaryJobId.current = null;
    }
    setForm(EMPTY_FORM);
    setJob(null);
    setDecisions({});
    setError('');
    setRefusal('');
    setStage('');
    setProgress(0);
    setSearchParams({}, { replace: true });
  };

  const showResult = !running && !!job?.final_text;
  const jobFailure = job?.status === 'failed' || job?.status === 'refused' ? job?.error : '';

  return (
    <div className="space-y-8">
      <header className="max-w-3xl">
        <p className="eyebrow">Rewrite</p>
        <h1 className="mt-3 text-3xl sm:text-4xl">Voice and rigor, paragraph by paragraph.</h1>
        <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
          Humanizer edits how a document reads. Facts, numbers, names, citations and how certain each
          claim is are checked against your original after rewriting. Review the audit before using the result.
        </p>
      </header>

      {refusal ? (
        <div className="rounded-2xl border border-warning/45 bg-warning/10 p-4 text-sm">
          <p className="flex items-center gap-2 font-medium text-warning">
            <AlertTriangle className="h-4 w-4" /> This request was declined
          </p>
          <p className="mt-2 leading-relaxed text-foreground/90">{refusal}</p>

        </div>
      ) : null}

      {!running && !showResult && service !== 'ready' ? (
        <div role="status" className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-border/80 bg-card p-4 text-sm">
          <div>
            <p className="flex items-center gap-2 font-medium">
              {service === 'checking' ? <Loader2 className="h-4 w-4 animate-spin" /> : <AlertTriangle className="h-4 w-4 text-warning" />}
              {service === 'checking' ? 'Checking rewriting availability…' : 'Rewriting is temporarily unavailable'}
            </p>
            {service !== 'checking' ? <p className="mt-1 text-muted-foreground">You can prepare your draft and browse saved rewrites. Try again in a moment.</p> : null}
          </div>
          <Button variant="outline" size="sm" onClick={checkService} disabled={service === 'checking'}>Check again</Button>
        </div>
      ) : null}

      {error || jobFailure ? (
        <div className="rounded-2xl border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive">
          {error || jobFailure}
        </div>
      ) : null}

      {loading ? <p className="text-sm text-muted-foreground">Loading that rewrite…</p> : null}
      {running ? (
        <div className="space-y-4" aria-live="polite">
          <StageProgress stage={stage} progress={progress} />
          <Button variant="outline" size="sm" onClick={() => activeRun.current?.abort()}>Stop rewrite</Button>
        </div>
      ) : null}

      {showResult ? (
        <ResultPanel
          job={job}
          review={review}
          decisions={decisions}
          onToggle={(id) =>
            setDecisions((c) => ({ ...c, [id]: c[id] === false ? true : false }))
          }
          onAll={(accept) =>
            setDecisions(
              accept ? {} : Object.fromEntries(review.changes.map((ch) => [ch.id, false])),
            )
          }
          text={text}
          onNew={handleNew}
        />
      ) : null}

      {!running && !showResult && !loading ? (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
          <InputPane
            value={form}
            onChange={update}
            onFile={readTextFile}
            onError={setError}
            maxChars={MAX_CHARS}
          />
          <ControlPane
            value={form}
            onChange={update}
            onRun={handleRun}
            running={running}
            retentionDays={retention}
            available={service === 'ready'}
          />
        </div>
      ) : null}
    </div>
  );
}
