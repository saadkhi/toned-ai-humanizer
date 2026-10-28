const monthKey = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
const amount = (value) => typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0;

/** Group by the viewer's local calendar consistently, including midnight boundaries. */
export function summarizeUsage(jobs, now = new Date()) {
  const list = jobs || [];
  const currentMonth = monthKey(now);
  const keyForJob = (job) => monthKey(new Date(job.created_date));
  const sum = (items, field) => items.reduce((total, item) => total + amount(item[field]), 0);
  const sourceWords = sum(list, 'source_words');
  const resultWords = sum(list, 'result_words');
  const cost = sum(list, 'cost_estimate');
  const thisMonth = list.filter((job) => keyForJob(job) === currentMonth);

  const months = [];
  for (let offset = 5; offset >= 0; offset -= 1) {
    const date = new Date(now.getFullYear(), now.getMonth() - offset, 1);
    const key = monthKey(date);
    months.push({
      label: date.toLocaleString(undefined, { month: 'short' }),
      words: sum(list.filter((job) => keyForJob(job) === key), 'source_words'),
    });
  }

  return {
    jobs: list.length,
    sourceWords,
    resultWords,
    cost,
    monthWords: sum(thisMonth, 'source_words'),
    monthJobs: thisMonth.length,
    perThousandWords: sourceWords ? (cost / sourceWords) * 1000 : 0,
    months,
  };
}
