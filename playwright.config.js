// @ts-check
const { defineConfig, devices } = require('@playwright/test');
const C = require('./tests/support/constants');

module.exports = defineConfig({
  testDir: 'tests/e2e',
  // Alle Tests teilen sich eine Mock-API mit CSV-Daten, deshalb nacheinander
  workers: 1,
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  timeout: 30_000,
  expect: { timeout: 7_000 },
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }], ['github']] : [['list']],
  use: {
    baseURL: C.BASE_URL,
    ...devices['Pixel 7'],
    locale: 'de-DE',
    timezoneId: 'Europe/Berlin',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    launchOptions: process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {},
  },
  webServer: {
    command: 'npm run build:test && node tests/support/mock-api.js',
    url: C.API_URL + '?token=x',
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
    env: { TZ: 'Europe/Berlin' },
    stdout: 'pipe',
  },
});
