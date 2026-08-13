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
  /** One worker, deliberately. With 3+ spec files in parallel workers, closing
   *  several system-Chrome instances near-simultaneously reliably wedges a
   *  worker in its `browser` fixture teardown on this machine (Browser.close
   *  sent, process exit event never observed — upstream playwright#39753),
   *  force-killed only after 300s each. All tests pass either way; serial runs
   *  the whole suite in ~1.5min with a clean exit. */
  workers: 1,
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
