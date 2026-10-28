import { test, expect } from '@playwright/test';

async function ready(page) {
  await page.route('**/api/health', route => route.fulfill({ json: { configured: true, providers: ['google'] } }));
  await page.route('**/api/run-stage', route => route.fulfill({ status: 503, json: { error: 'File QA request captured.' } }));
}

test('Markdown import retains file text in the request, including Windows line endings', async ({ page }) => {
  await ready(page);
  await page.goto('/editor');
  const source = '# Heading\r\n\r\nThe trial may include 42 participants.\r\n';
  await page.locator('input[type=file]').setInputFiles({ name: 'sample.markdown', mimeType: 'text/markdown', buffer: Buffer.from(source) });
  await expect(page.getByRole('textbox', { name: 'Your document' })).toHaveValue(source.replace(/\r\n/g, '\n'));
  await expect(page.locator('main')).toContainText('sample.markdown');
  const request = page.waitForRequest('**/api/run-stage');
  await page.getByRole('button', { name: 'Rewrite this document' }).click();
  expect((await request).postDataJSON().job.source_text).toBe(source);
});

test('unsupported files, oversized files, and documents above the character limit are explained', async ({ page }) => {
  await ready(page);
  await page.goto('/editor');
  const input = page.locator('input[type=file]');
  await input.setInputFiles({ name: 'sample.pdf', mimeType: 'application/pdf', buffer: Buffer.from('Not a supported file') });
  await expect(page.locator('main')).toContainText('Only .txt and .md files can be read here.');
  await input.setInputFiles({ name: 'large.txt', mimeType: 'text/plain', buffer: Buffer.alloc(200001, 'a') });
  await expect(page.locator('main')).toContainText('That file is too large.');
  await input.setInputFiles({ name: 'long.txt', mimeType: 'text/plain', buffer: Buffer.alloc(20001, 'a') });
  await expect(page.locator('main')).toContainText('Over the limit.');
  await expect(page.getByRole('button', { name: 'Rewrite this document' })).toBeDisabled();
});

test('copy uses the reviewed text and a denied clipboard permission has visible feedback', async ({ page, context }) => {
  await ready(page);
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.goto('/editor');
  const source = 'Original paragraph.';
  await page.evaluate(({ source }) => localStorage.setItem('humanizer_jobs', JSON.stringify([{
    id: 'clipboard-job', source_text: source, final_text: 'Rewritten paragraph.',
    title: 'Clipboard review', status: 'completed', style: 'technical_writer',
    created_date: new Date().toISOString(), retention_days: 30,
  }])), { source });
  await page.goto('/editor?job=clipboard-job');
  await page.getByRole('button', { name: 'Reject all', exact: true }).click();
  await page.getByRole('button', { name: 'Copy', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Copied', exact: true })).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(source);
  await page.evaluate(() => { navigator.clipboard.writeText = async () => { throw new DOMException('Denied', 'NotAllowedError'); }; });
  await page.getByRole('button', { name: 'Copied', exact: true }).click();
  await expect(page.locator('main')).toContainText('Copy was unavailable.');
});
