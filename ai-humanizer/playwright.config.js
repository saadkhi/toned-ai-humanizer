import { defineConfig } from '@playwright/test';
import { existsSync } from 'node:fs';

const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || (existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined);
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  timeout: 60000,
  expect: { timeout: 15000 },
  retries: process.env.CI ? 1 : 0,
  reporter: 'list',
  use: {
    baseURL: 'http://127.0.0.1:5174',
    headless: true,
    launchOptions: { executablePath },
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'npm run dev -- --port 5174',
    url: 'http://127.0.0.1:5174',
    reuseExistingServer: false,
    env: { NODE_ENV: 'development' },
  },
});
