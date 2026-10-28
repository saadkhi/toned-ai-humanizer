import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';

const source = '    First original line\r\n    second line\r\n \t\r\nSecond original paragraph.\r\n';
const rewritten = '    First edited line\r\n    second line\r\n \t\r\nSecond edited paragraph.\r\n';
const fixture = {
  id: 'audit-fixture', title: 'Multiline rewrite', status: 'completed',
  source_text: source, final_text: rewritten, rewritten_text: rewritten,
  style: 'technical_writer', source_words: 10, result_words: 10,
  created_date: new Date().toISOString(), unresolved_flags: [],
  audit: { items: [], certainty: [], format_violations: [], summary: 'Synthetic audit fixture.' },
};
async function mockServices(page) {
  await page.route('https://**/*', route => route.abort());
  await page.route('**/api/health', route => route.fulfill({ json: { configured: false, providers: [] } }));
  await page.route('**/api/run-stage', route => route.fulfill({ status: 503, json: { error: 'No provider calls are allowed in this test.' } }));
}
async function seed(page, records) {
  await mockServices(page);
  await page.addInitScript((records) => { if (localStorage.getItem('humanizer_jobs') === null) localStorage.setItem('humanizer_jobs', JSON.stringify(records)); }, records);
}

test('saved output without a completed audit never displays a successful audit message', async ({ page }) => {
  await seed(page, [
    { ...fixture, id: 'missing-audit', audit: null },
    { ...fixture, id: 'interrupted-audit', status: 'failed' },
    { ...fixture, id: 'incomplete-audit', audit: {} },
    fixture,
  ]);
  for (const id of ['missing-audit', 'interrupted-audit', 'incomplete-audit']) {
    await page.goto(`/editor?job=${id}`);
    await expect(page.getByRole('status')).toContainText('no completed audit');
    await expect(page.locator('main')).not.toContainText('Automated checks found no unresolved issues');
  }
  await page.goto('/editor?job=audit-fixture');
  await expect(page.locator('main')).toContainText('Automated checks found no unresolved issues');
});

test('375px result tabs fit the viewport, multiline preview preserves whitespace, and exports match audited text', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await seed(page, [fixture]);
  await page.goto('/editor?job=audit-fixture');
  await expect(page.getByRole('tab', { name: "Editor's notes" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
  for (const tab of ['Tracked changes', 'Clean result', 'Claim audit', "Editor's notes"]) {
    const rect = await page.getByRole('tab', { name: tab, exact: true }).boundingBox();
    expect(rect.x + rect.width).toBeLessThanOrEqual(375);
  }
  await page.getByRole('tab', { name: 'Clean result' }).click();
  await expect(page.locator('[role=tabpanel] article')).toHaveCSS('white-space', 'pre-wrap');
  expect(await page.locator('[role=tabpanel] article').textContent()).toBe(rewritten);
  const downloadEvent = page.waitForEvent('download');
  await page.getByRole('button', { name: '.txt', exact: true }).click();
  const download = await downloadEvent;
  expect(await readFile(await download.path(), 'utf8')).toBe(rewritten);
});

test('long custom voices stay within mobile history layout and menu navigation works', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await seed(page, [{ ...fixture, style: 'custom', custom_style: 'a'.repeat(1000) }]);
  await page.goto('/history');
  await expect(page.locator('main')).toContainText('Multiline rewrite');
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
  await page.getByRole('button', { name: 'Toggle menu' }).click();
  await page.getByRole('link', { name: 'Data & settings', exact: true }).click();
  await expect(page).toHaveURL(/\/settings$/);
  await expect(page.getByRole('button', { name: 'Toggle menu' })).toHaveAttribute('aria-expanded', 'false');
});

test('history pages expose older records and settings/usage totals include all205 saved rewrites', async ({ page }) => {
  const records = Array.from({ length: 205 }, (_, index) => ({ ...fixture, id: String(index), title: `Saved fixture ${index}`, source_words: 1, result_words: 2, created_date: new Date(Date.now() - index * 1000).toISOString() }));
  await seed(page, records);
  await page.goto('/history');
  await expect(page.locator('main')).toContainText('of 205 rewrites');
  await expect(page.getByRole('button', { name: 'Previous page' })).toBeDisabled();
  await expect(page.locator('main li')).toHaveCount(20);
  for (let index = 0; index < 10; index++) await page.getByRole('button', { name: 'Next page' }).click();
  await expect(page.locator('main li')).toHaveCount(5);
  await expect(page.locator('main')).toContainText('Saved fixture 204');
  await expect(page.getByRole('button', { name: 'Next page' })).toBeDisabled();
  await page.goto('/settings');
  await expect(page.locator('dl')).toContainText('205');
  await expect(page.locator('dl')).toContainText('615');
  await page.goto('/usage');
  const words = page.locator('p', { hasText: /^Words all time$/ }).locator('..');
  await expect(words).toContainText('205');
});

test('failed single-history deletion surfaces feedback and does not emit an unhandled error', async ({ page }) => {
  await seed(page, [fixture]);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/history');
  await page.getByRole('button', { name: 'Delete rewrite' }).click();
  await page.evaluate(() => { Storage.prototype.setItem = () => { throw new DOMException('Storage unavailable', 'QuotaExceededError'); }; });
  await page.getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('could not update saved data');
  await expect(page.locator('main')).toContainText('Multiline rewrite');
  expect(errors).toEqual([]);
});

test('malformed history stays untouched and displays actionable errors in both history and usage', async ({ page }) => {
  await seed(page, [null]);
  await page.goto('/history');
  await expect(page.locator('main')).toContainText('Saved data is damaged');
  await expect(page.locator('main')).not.toContainText('No rewrites yet');
  expect(await page.evaluate(() => localStorage.getItem('humanizer_jobs'))).toBe('[null]');
  await page.goto('/usage');
  await expect(page.getByRole('alert')).toContainText('Saved data is damaged');
  expect(await page.evaluate(() => localStorage.getItem('humanizer_jobs'))).toBe('[null]');
});


test('usage chart and monthly total agree in Asia/Karachi at a UTC month boundary', async ({ browser, baseURL }) => {
  const context = await browser.newContext({ timezoneId: 'Asia/Karachi', baseURL });
  const page = await context.newPage();
  try {
    await page.clock.setFixedTime(new Date('2026-10-15T12:00:00Z'));
    await seed(page, [{ ...fixture, source_words: 123, created_date: '2026-09-30T20:30:00Z' }]);
    await page.goto('/usage');
    await expect(page.locator('p', { hasText: /^Words this month$/ }).locator('..')).toContainText('123');
    const bars = page.locator('.recharts-bar-rectangle path');
    await expect(bars).toHaveCount(1);
    await expect.poll(async () => Number(await bars.first().getAttribute('height'))).toBeGreaterThan(0);
    await expect(page.locator('.recharts-xAxis')).toContainText('Oct');
  } finally {
    await context.close();
  }
});

test('history deletion can be cancelled and settings wipe removes saved browser records', async ({ page }) => {
  await seed(page, [fixture]);
  await page.goto('/history');
  await page.getByRole('button', { name: 'Delete rewrite' }).click();
  await page.getByRole('button', { name: 'Keep it', exact: true }).click();
  await expect(page.locator('main')).toContainText('Multiline rewrite');
  await page.getByRole('link', { name: 'Data & settings', exact: true }).click();
  await page.getByRole('button', { name: 'Delete all my data' }).click();
  await page.getByRole('button', { name: 'Delete everything', exact: true }).click();
  await expect(page.locator('main')).toContainText('Every rewrite, tracked change and audit report has been deleted.');
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('humanizer_jobs')))).toEqual([]);
  await page.getByRole('link', { name: 'History', exact: true }).click();
  await expect(page.locator('main')).toContainText('No rewrites yet');
});


test('long unbroken source values wrap within mobile tracked and side-by-side review', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await seed(page, [{ ...fixture, source_text: 'Identifier: ' + 'X'.repeat(500), final_text: 'Identifier: ' + 'Y'.repeat(500) }]);
  await page.goto('/editor?job=audit-fixture');
  await expect(page.getByRole('button', { name: 'Reject all', exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
  await page.getByRole('button', { name: 'Side by side', exact: true }).click();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
});


test('editor notes show current diagnosis patterns, preserve multiline text, and omit missing model metadata', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  const notes = 'First note.\n\n    An indented note.';
  const location = 'Long source identifier: ' + 'X'.repeat(500);
  await seed(page, [{ ...fixture, notes, diagnosis: { patterns: [{ pattern: 'Repeated sentence openings', location, severity: 'medium' }] } }]);
  await page.goto('/editor?job=audit-fixture');
  await page.getByRole('tab', { name: "Editor's notes" }).click();
  await expect(page.getByRole('tabpanel')).toContainText('Repeated sentence openings');
  await expect(page.getByRole('tabpanel')).toContainText(location);
  const notesParagraph = page.getByRole('tabpanel').locator('p').filter({ hasText: 'First note.' });
  expect(await notesParagraph.textContent()).toBe(notes);
  await expect(notesParagraph).toHaveCSS('white-space', 'pre-wrap');
  await expect(page.getByRole('tabpanel').locator('dl')).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
});

test('legacy findings remain readable and available model metadata is labelled without blank separators', async ({ page }) => {
  await seed(page, [{ ...fixture, diagnosis: { findings: [{ pattern: 'Legacy finding', location: 'Saved excerpt', severity: 'low' }] }, model_quality: 'provider/quality-model', prompt_version: 'test/2' }]);
  await page.goto('/editor?job=audit-fixture');
  await page.getByRole('tab', { name: "Editor's notes" }).click();
  await expect(page.getByRole('tabpanel')).toContainText('Legacy finding');
  const metadata = page.getByRole('tabpanel').locator('dl');
  await expect(metadata).toContainText('Latest quality model:');
  await expect(metadata).toContainText('provider/quality-model');
  await expect(metadata).toContainText('Prompt version:');
  await expect(metadata).not.toContainText('Latest fast model:');
  await expect(metadata).not.toContainText('Latest provider:');
});
