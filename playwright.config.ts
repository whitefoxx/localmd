import { defineConfig } from '@playwright/test'

/** The dev server the suite drives. `reuseExistingServer` means a checkout with
 *  a server already on this port is tested through THAT server — fine in one
 *  checkout, wrong in a second (a worktree would silently test the first one's
 *  code). Give the other checkout its own port: E2E_PORT=5199 npm run test:e2e */
const PORT = process.env.E2E_PORT ?? '5173'
const URL = `http://localhost:${PORT}`

export default defineConfig({
  testDir: 'tests-e2e',
  timeout: 30_000,
  use: {
    channel: 'chrome', // system Chrome — no browser download needed
    baseURL: URL,
  },
  webServer: {
    command: `npm run dev -- --port ${PORT} --strictPort`,
    url: URL,
    reuseExistingServer: true,
    timeout: 30_000,
  },
})
