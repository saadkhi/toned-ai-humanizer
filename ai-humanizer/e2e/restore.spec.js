import { test, expect } from '@playwright/test';

for (const status of ['failed', 'running']) {
  test(`reopening a ${status} rewrite restores its source and options before retry`, async ({ page }) => {
    const source = 'The saved draft may describe 42 participants.';
    await page.addInitScript(({ status, source }) => {
      localStorage.setItem('humanizer_jobs', JSON.stringify([{
        id: 'interrupted-job', status, source_text: source,
        style: 'custom', custom_style: 'Direct and precise', purpose: 'Editing my research draft',
        preserve_headings: false, preserve_lists: true, length_target: 'shorter',
        retention_days: 30, created_date: new Date().toISOString(),
        error: status === 'failed' ? 'An earlier provider call failed.' : '',
      }]));
    }, { status, source });
    await page.route('**/api/health', route => route.fulfill({ json: { configured: true, providers: ['google'] } }));
    let retried;
    await page.route('**/api/run-stage', route => {
      retried = route.request().postDataJSON();
      return route.fulfill({ status: 503, json: { error: 'Provider test response.' } });
    });
    await page.goto('/editor?job=interrupted-job');
    await expect(page.getByRole('textbox', { name: 'Your document' })).toHaveValue(source);
    await expect(page.getByRole('textbox', { name: 'Custom voice instruction' })).toHaveValue('Direct and precise');
    await expect(page.getByRole('textbox', { name: 'Purpose (optional)' })).toHaveValue('Editing my research draft');
    await expect(page.getByRole('checkbox', { name: 'Headings and their order' })).not.toBeChecked();
    await expect(page.getByRole('checkbox', { name: 'Lists and their items' })).toBeChecked();
    await expect(page.getByRole('button', { name: 'Shorter', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await page.getByRole('button', { name: 'Rewrite this document' }).click();
    await expect(page.locator('body')).toContainText('Provider test response.');
    expect(retried.stage).toBe('extract');
    expect(retried.job).toMatchObject({ source_text: source, style: 'custom', custom_style: 'Direct and precise', purpose: 'Editing my research draft', preserve_headings: false, preserve_lists: true, length_target: 'shorter' });
    await expect(page.getByRole('textbox', { name: 'Your document' })).toHaveValue(source);
  });
}
