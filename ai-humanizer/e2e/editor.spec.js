import { test, expect } from '@playwright/test';

const original = 'The trial may include 42 participants.';
const rewritten = 'The study may enroll 42 participants.';
const audit = { items: [{ source_id: 'numbers:0', kind: 'number', value: '42', status: 'preserved', note: '' }], certainty: [], format_violations: [], summary: 'The checked number was preserved.' };
async function ready(page, configured = true) {
  await page.route('**/api/health', route => route.fulfill({ status: configured ? 200 : 503, json: { configured, providers: configured ? ['google'] : [] } }));
  // No test can spend provider credits even if credentials exist in the runner.
  await page.route('**/api/run-stage', route => route.fulfill({ status: 503, json: { error: 'Unexpected test API call' } }));
}
async function mockPipeline(page, flags = []) {
  const stages = [];
  await page.route('**/api/run-stage', async route => {
    const { stage } = route.request().postDataJSON();
    stages.push(stage);
    const result = { stage, patch: {}, progress: 30 };
    if (stage === 'extract') Object.assign(result, { chunk_count: 1 });
    if (stage === 'audit') Object.assign(result, { has_problems: flags.length > 0, patch: { audit, unresolved_flags: flags } });
    if (stage === 'finalize') Object.assign(result, { status: flags.length ? 'needs_review' : 'completed', patch: { final_text: rewritten, rewritten_text: rewritten, result_words: 7, audit, unresolved_flags: flags, repair_loops: flags.length ? 2 : 0, status: flags.length ? 'needs_review' : 'completed' } });
    await route.fulfill({ json: result });
  });
  return stages;
}

test('missing configuration is explained and never sends a rewrite request', async ({ page }) => {
  await ready(page, false);
  await page.goto('/editor');
  await page.getByRole('textbox', { name: 'Your document' }).fill(original);
  await expect(page.getByRole('button', { name: 'Rewrite this document' })).toBeDisabled();
  await expect(page.getByRole('button', { name: /check again|retry/i })).toBeVisible();
  await expect(page.locator('body')).toContainText(/unavailable|not configured/i);
});

test('rewrite can be reviewed, exported, and revisited in local history', async ({ page }) => {
  await ready(page);
  const stages = await mockPipeline(page);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/editor');
  await page.getByRole('textbox', { name: 'Your document' }).fill(original);
  await page.getByRole('button', { name: 'Rewrite this document' }).click();
  await expect(page.getByRole('tab', { name: 'Claim audit' })).toBeVisible();
  expect(stages).toEqual(['extract', 'diagnose', 'rewrite', 'assemble', 'audit', 'finalize']);
  await page.getByRole('tab', { name: 'Clean result' }).click();
  await expect(page.getByRole('tabpanel')).toContainText(rewritten);
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: '.txt', exact: true }).click();
  expect((await download).suggestedFilename()).toMatch(/\.txt$/);
  await page.goto('/history');
  await expect(page.locator('main')).toContainText(original);
  await page.reload();
  await expect(page.locator('main')).toContainText(original);
  expect(errors).toEqual([]);
});

test('unresolved object flags render safely after both repair attempts', async ({ page }) => {
  await ready(page);
  const stages = await mockPipeline(page, [{ kind: 'claim', value: 'An invented finding', status: 'added', note: 'Not supported by the source.' }]);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/editor');
  await page.getByRole('textbox', { name: 'Your document' }).fill(original);
  await page.getByRole('button', { name: 'Rewrite this document' }).click();
  await expect(page.getByRole('tab', { name: 'Claim audit' })).toBeVisible();
  await expect(page.locator('body')).toContainText('An invented finding');
  expect(stages.filter(stage => stage === 'repair')).toHaveLength(2);
  await page.getByRole('tab', { name: 'Claim audit' }).click();
  await expect(page.getByRole('tabpanel')).toContainText('Not supported by the source.');
  expect(errors).toEqual([]);
});

test('provider errors retain the original document and allow retry', async ({ page }) => {
  await ready(page);
  await page.route('**/api/run-stage', route => route.fulfill({ status: 429, json: { error: 'Too many rewrite requests. Please wait before trying again.' } }));
  await page.goto('/editor');
  await page.getByRole('textbox', { name: 'Your document' }).fill(original);
  await page.getByRole('button', { name: 'Rewrite this document' }).click();
  await expect(page.locator('body')).toContainText('Too many rewrite requests.');
  await expect(page.getByRole('textbox', { name: 'Your document' })).toHaveValue(original);
  await expect(page.getByRole('button', { name: 'Rewrite this document' })).toBeEnabled();
});

test('legacy login URL redirects to the working editor', async ({ page }) => {
  await ready(page);
  await page.goto('/login');
  await expect(page).toHaveURL(/\/editor/);
  await expect(page.getByRole('textbox', { name: 'Your document' })).toBeVisible();
});

test('no-history mode keeps the completed result visible without saving document text', async ({ page }) => {
  await ready(page);
  await mockPipeline(page);
  await page.goto('/settings');
  await page.getByRole('radio', { name: /Do not save to history/ }).click();
  await page.getByRole('button', { name: 'Save retention window' }).click();
  await expect(page.locator('body')).toContainText('Saved. New rewrites follow this window.');
  await page.goto('/editor');
  await expect(page.locator('body')).toContainText('Not saved:');
  await page.getByRole('textbox', { name: 'Your document' }).fill(original);
  await page.getByRole('button', { name: 'Rewrite this document' }).click();
  await expect(page.getByRole('tab', { name: 'Clean result' })).toBeVisible();
  await page.getByRole('tab', { name: 'Clean result' }).click();
  await expect(page.getByRole('tabpanel')).toContainText(rewritten);
  expect(await page.evaluate(() => localStorage.getItem('humanizer_jobs'))).toBeNull();
  await page.goto('/history');
  await expect(page.locator('main')).not.toContainText(original);
});

test('stopping a rewrite restores the document form without advancing the pipeline', async ({ page }) => {
  await ready(page);
  const stages = [];
  await page.route('**/api/run-stage', async route => {
    stages.push(route.request().postDataJSON().stage);
    // Deliberately leave this request pending; the user cancels the browser wait.
    await new Promise(resolve => setTimeout(resolve, 1500));
    await route.fulfill({ json: { stage: 'extract', chunk_count: 1, patch: {} } }).catch(() => {});
  });
  await page.goto('/editor');
  await page.getByRole('textbox', { name: 'Your document' }).fill(original);
  await page.getByRole('button', { name: 'Rewrite this document' }).click();
  await page.getByRole('button', { name: 'Stop rewrite' }).click();
  await expect(page.getByRole('textbox', { name: 'Your document' })).toHaveValue(original);
  expect(stages).toEqual(['extract']);
});
