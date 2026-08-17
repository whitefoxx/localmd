// Shoots the two screenshots the landing page puts on stage, in both themes,
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

// The two detail shots are cropped here rather than in CSS. They are only ever
// shown through a 526×260 window, so shipping the whole 1484-wide frame and
// hiding 85% of it costs about 350KB an image for nothing — and it puts the
// crop offsets in a Vue template, far away from the viewport size they are
// measured against. Coordinates are CSS pixels within VIEWPORT.
// A few pixels of slack on the left of the note's text column: the landing
// scales this by a hair to fill its column, and the trim has to come out of
// somewhere. Clipped glyphs on the left edge read as a broken render — on the
// right they read as a crop, which is why that edge is the faded one.
const CITE_NOTE = { x: 344, y: 352, width: 526, height: 260 } // chips in the note
const CITE_PDF = { x: 436, y: 312, width: 526, height: 260 } // the highlighted block

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

  await page.screenshot({
    path: join(assets, `landing-cite-note${suffix}.jpg`),
    type: 'jpeg',
    quality: 78,
    clip: CITE_NOTE,
  })
  console.log('shot', `landing-cite-note${suffix}.jpg`)

  // Click the chip: the PDF opens at the paragraph the claim came from, with
  // the block highlighted. The viewer renders out of reach of the main
  // document (nothing of the page shows up in `document` — no canvas, no text
  // layer, no growing span count), so there is no DOM signal here to wait on
  // and this waits on the clock instead. That is fine for a script whose
  // output a human looks at before it ships, and it is why the wait is
  // generous rather than tight.
  await page.locator('.md-preview a.citation').first().click()
  await page.waitForTimeout(8000)
  // Only once, from whichever theme runs first: this crop sits entirely inside
  // the PDF's own page, and a PDF page is white paper whatever the app around
  // it is wearing — the light and dark shots came out byte-for-byte identical.
  // So the landing uses one file for both themes. If CITE_PDF is ever widened
  // far enough to catch the app's chrome or the gap between pages, that stops
  // being true and this needs the `${suffix}` back.
  if (scheme === 'light') {
    await page.screenshot({
      path: join(assets, 'landing-cite-pdf.jpg'),
      type: 'jpeg',
      quality: 78,
      clip: CITE_PDF,
    })
    console.log('shot', 'landing-cite-pdf.jpg')
  }

  await context.close()
}

await browser.close()
