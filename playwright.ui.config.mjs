import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/ui', timeout: 30_000, expect: { timeout: 5_000 }, workers: 1,
  retries: process.env.CI ? 1 : 0, reporter: 'list',
  use: { baseURL: 'http://127.0.0.1:5194', trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  projects: [
    { name: 'desktop', use: { viewport: { width: 1440, height: 900 } } },
    { name: 'mobile', use: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } },
    { name: 'webkit-desktop', testMatch: /(reaction-hover|bubble-webkit|interface-redesign|secondary-interface)\.spec\.mjs/, use: { browserName: 'webkit', viewport: { width: 1440, height: 900 } } },
    { name: 'webkit', testMatch: /(bubble-webkit|interface-redesign|secondary-interface)\.spec\.mjs/, use: { browserName: 'webkit', viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } }
  ],
  webServer: {
    command: 'npm run dev -- --mode ui-test --host 127.0.0.1 --port 5194 --strictPort',
    url: 'http://127.0.0.1:5194', reuseExistingServer: false, timeout: 60_000,
    // Deliberately synthetic public configuration; fixture providers never access an account.
    env: { VITE_MOCK: 'false', VITE_SUPABASE_URL: 'http://127.0.0.1:54321', VITE_SUPABASE_PUBLISHABLE_KEY: 'fixture-public-key' }
  }
});
