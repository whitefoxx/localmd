// Shoots the hero screenshot the landing page puts on stage, in both themes,
// against the demo knowledge base on a running dev server.
//
//   npm run dev            # in another shell
//   npm run shoot:landing
//
// The images are written straight into src/assets, because they are part of
// the page rather than launch collateral — the landing imports them and Vite
// hashes them into the build. This script lives here, and not in the ignored
// ph-assets/, for the same reason: the components point at it by name.
//
// Both themes are shot in one run, from the identical sequence, so the pairs
// line up pixel for pixel — a light and a dark shot that disagreed about where
// the text sits would need the landing to hold two sets of crop offsets.
//
// Theme comes from the emulated `prefers-color-scheme` and the app's default
// theme preference ('system'), so nothing has to be reached into and mutated.
import { chromium } from 'playwright-core'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const assets = join(here, '..', 'src', 'assets')
const URL = process.env.LOCALMD_URL ?? 'http://localhost:5173'

// The size the landing shows these at, 1:1. deviceScaleFactor 2 so the result
// is still sharp on the retina screens most of this audience is reading on;
// the <img> is pinned to the CSS width to halve it back down.
const VIEWPORT = { width: 1484, height: 812 }

const browser = await chromium.launch({ channel: 'chrome' })

for (const scheme of ['light', 'dark']) {
  const context = await browser.newContext({
    viewport: VIEWPORT,
    deviceScaleFactor: 2,
    colorScheme: scheme,
  })
  const page = await context.newPage()
  await page.goto(`${URL}/?demo=1`)

  // The demo opens its payoff note by itself; the citation chips in it are the
  // last thing to render, and they are the subject of the picture.
  await page.locator('.md-preview a.citation').first().waitFor({ state: 'visible', timeout: 30_000 })
  await page.waitForTimeout(600)
  const suffix = scheme === 'dark' ? '-dark' : ''
  // The whole frame, for the hero — it shows the window, the file tree and the
  // note together, and runs off the edge of the screen.
  await page.screenshot({
    path: join(assets, `landing-note${suffix}.jpg`),
    type: 'jpeg',
    quality: 72,
  })
  console.log('shot', `landing-note${suffix}.jpg`)

  await context.close()
}

await browser.close()
