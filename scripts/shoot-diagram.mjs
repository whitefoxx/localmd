// Renders scripts/diagram-scatter.html to src/assets, once per theme.
//
//   npm run shoot:diagram
//
// Unlike shoot-landing.mjs this needs no dev server — the drawing is a
// standalone file, so it can be reopened in a browser and adjusted directly.
//
// PNG, not JPEG: this is flat colour, hairline rules and small type, which is
// exactly what JPEG is worst at and what PNG compresses well.
import { chromium } from 'playwright-core'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const page_url = pathToFileURL(join(here, 'diagram-scatter.html')).href
const assets = join(here, '..', 'src', 'assets')

const browser = await chromium.launch({ channel: 'chrome' })

for (const theme of ['light', 'dark']) {
  const context = await browser.newContext({
    viewport: { width: 460, height: 560 },
    deviceScaleFactor: 2,
  })
  const page = await context.newPage()
  await page.goto(page_url)
  await page.evaluate((t) => document.documentElement.setAttribute('data-theme', t), theme)
  await page.waitForTimeout(250)
  const name = `landing-scatter${theme === 'dark' ? '-dark' : ''}.png`
  // Shoot the body box, not the viewport: the drawing sets its own height, and
  // a viewport-sized shot would pad it with whatever space was left over.
  await page.locator('body').screenshot({ path: join(assets, name) })
  console.log('shot', name)
  await context.close()
}

await browser.close()
