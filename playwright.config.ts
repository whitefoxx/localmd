import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: 'tests-e2e',
  timeout: 30_000,
  use: {
    channel: 'chrome', // system Chrome — no browser download needed
    baseURL: 'http://localhost:5173',
  },
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:5173',
    reuseExistingServer: true,
    timeout: 30_000,
  },
})
