// Renders scripts/og.html into public/og.png at the size the og:image meta
// tags in index.html declare (1200x630).
//
//   npm run shoot:og
//
// Generated rather than drawn once in an image editor, for the same reason as
// the landing imagery: the words on it are the message house's one-liner, and
// a picture of a sentence goes stale silently when the sentence changes.
import { chromium } from 'playwright-core'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const browser = await chromium.launch({ channel: 'chrome' })
// deviceScaleFactor 1: the meta tags declare 1200x630, and a 2x file would be
// a 2400-wide image claiming to be 1200 wide.
const page = await browser.newPage({ viewport: { width: 1200, height: 630 } })
await page.goto('file://' + join(here, 'og.html'))
await page.waitForTimeout(400)
await page.screenshot({ path: join(here, '..', 'public', 'og.png') })
console.log('shot public/og.png')
await browser.close()
