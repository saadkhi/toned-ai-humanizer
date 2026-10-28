import { test, expect } from '@playwright/test';

const draft = 'The pilot may include 42 participants.';

for (const missing of ['providerConfigured', 'protectionConfigured']) {
  test(`missing ${missing} is site setup, and checking again can recover without losing the draft`, async ({ page }) => {
    let configured = false;
    const calls = [];
    await page.route('**/api/health', route => route.fulfill({
      status: configured ? 200 : 503,
      json: {
        configured, mode: 'free', providers: ['openrouter'],
        providerConfigured: true, protectionConfigured: true,
        ...(!configured ? { [missing]: false } : {}),
      },
    }));
    await page.route('**/api/run-stage', route => {
      calls.push(route.request().postDataJSON().stage);
      return route.fulfill({ status: 503, json: { error: 'No provider requests are allowed in this test.' } });
    });
    await page.goto('/editor');
    await page.getByRole('textbox', { name: 'Your document' }).fill(draft);
    await expect(page.getByRole('status')).toContainText('Rewriting is not enabled on this site yet');
    await expect(page.getByRole('status')).toContainText('Please contact the site owner');
    await expect(page.getByRole('status')).not.toContainText('Try again in a moment');
    await expect(page.getByRole('button', { name: 'Rewrite this document' })).toBeDisabled();
    expect(calls).toEqual([]);

    configured = true;
    await page.getByRole('button', { name: 'Check again', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Rewrite this document' })).toBeEnabled();
    await expect(page.getByRole('textbox', { name: 'Your document' })).toHaveValue(draft);
    await expect(page.getByRole('status')).toHaveCount(0);
    expect(calls).toEqual([]);
  });
}

test('a failed health request remains temporary rather than claiming incomplete site setup', async ({ page }) => {
  await page.route('**/api/health', route => route.abort('failed'));
  await page.route('**/api/run-stage', route => route.fulfill({ status: 503, json: { error: 'Unexpected test API call.' } }));
  await page.goto('/editor');
  await expect(page.getByRole('status')).toContainText('Rewriting is temporarily unavailable');
  await expect(page.getByRole('status')).toContainText('Try again in a moment');
  await expect(page.getByRole('status')).not.toContainText('Site setup is incomplete');
  await expect(page.getByRole('button', { name: 'Rewrite this document' })).toBeDisabled();
});
