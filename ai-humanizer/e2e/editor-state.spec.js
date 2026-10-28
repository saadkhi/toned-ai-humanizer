import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';

const source = 'Original first paragraph.\n\nOriginal second paragraph.';
const rewritten = 'Rewritten first paragraph.\n\nRewritten second paragraph.';
async function prepare(page) {
  await page.addInitScript(({ source, rewritten }) => {
    if (localStorage.getItem('editor-state-seeded')) return;
    localStorage.setItem('editor-state-seeded', 'yes');
    localStorage.setItem('humanizer_jobs', JSON.stringify([{
      id: 'saved-review', title: 'Saved review', source_text: source, final_text: rewritten,
      status: 'completed', style: 'technical_writer', retention_days: 30,
      created_date: new Date().toISOString(), unresolved_flags: [],
    }]));
  }, { source, rewritten });
  await page.route('**/api/health', route => route.fulfill({ json: { configured: true, providers: ['google'] } }));
  await page.route('**/api/run-stage', route => route.fulfill({ status: 503, json: { error: 'Mock service response.' } }));
}

test('paragraph review choices survive reload and match the downloaded result', async ({ page }) => {
  await prepare(page);
  await page.goto('/editor?job=saved-review');
  await page.getByRole('button', { name: 'Reject all', exact: true }).click();
  await page.getByRole('tab', { name: 'Clean result', exact: true }).click();
  await expect(page.getByRole('tabpanel')).toHaveText(source);
  await page.reload();
  await page.getByRole('tab', { name: 'Clean result', exact: true }).click();
  await expect(page.getByRole('tabpanel')).toHaveText(source);
  const downloaded = page.waitForEvent('download');
  await page.getByRole('button', { name: '.txt', exact: true }).click();
  expect(await readFile(await (await downloaded).path(), 'utf8')).toBe(source);
  await page.getByRole('tab', { name: 'Tracked changes', exact: true }).click();
  await page.getByRole('button', { name: 'Accept all', exact: true }).click();
  await page.reload();
  await page.getByRole('tab', { name: 'Clean result', exact: true }).click();
  await expect(page.getByRole('tabpanel')).toHaveText(rewritten);
});

test('the Rewrite navigation opens an unselected draft instead of leaving the previous result', async ({ page }) => {
  await prepare(page);
  await page.goto('/editor?job=saved-review');
  await expect(page.getByRole('tab', { name: 'Tracked changes', exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'Rewrite', exact: true }).click();
  await expect(page).toHaveURL(/\/editor$/);
  await expect(page.getByRole('textbox', { name: 'Your document' })).toHaveValue('');
  await expect(page.getByRole('tab', { name: 'Clean result', exact: true })).toHaveCount(0);
});

test('opening a new draft aborts the previous run without overwriting a later attempt', async ({ page }) => {
  await prepare(page);
  let count = 0;
  await page.route('**/api/run-stage', async route => {
    count++;
    if (count === 1) {
      await new Promise(resolve => setTimeout(resolve, 1500));
      await route.fulfill({ json: { stage: 'extract', chunk_count: 1, patch: {} } }).catch(() => {});
    } else {
      await route.fulfill({ status: 503, json: { error: 'Second draft service response.' } });
    }
  });
  await page.goto('/editor');
  await page.getByRole('textbox', { name: 'Your document' }).fill('The first draft.');
  const request = page.waitForRequest('**/api/run-stage');
  await page.getByRole('button', { name: 'Rewrite this document' }).click();
  await request;
  await page.getByRole('link', { name: 'Rewrite', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Your document' })).toHaveValue('');
  await page.getByRole('textbox', { name: 'Your document' }).fill('The second draft.');
  await page.getByRole('button', { name: 'Rewrite this document' }).click();
  await expect(page.locator('main')).toContainText('Second draft service response.');
  await expect(page.getByRole('textbox', { name: 'Your document' })).toHaveValue('The second draft.');
});
