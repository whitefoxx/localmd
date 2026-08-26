import { test, expect } from '@playwright/test'
import type { Page } from '@playwright/test'

/**
 * The transcript must cost the same to stream into whether the conversation is
 * one message long or two hundred.
 *
 * It once did not. Every message lived in ChatPanel's own render function, so a
 * delta — which mutates one part of one message — re-ran the whole transcript:
 * per-delta work proportional to the conversation, tens of times a second, on
 * the thread that answers clicks. A long thinking phase in a long session made
 * the app unclickable outright (measured: the same 2,300-delta thought took 13s
 * into a 40-turn session and 43s into a 150-turn one, with the panel's own
 * one-second timer starved for 283ms at a stretch).
 *
 * What guards it is the RATIO, not an absolute time: absolute numbers say more
 * about the machine than about the code, while "a long session costs no more
 * per delta than a short one" is the property that actually broke — and it
 * breaks again the moment something in a row reads session-wide reactive state.
 */

const PROBE = `(() => {
  const p = { maxTask: 0, maxGap: 0, inputDelays: [] }
  window.__probe = p
  new PerformanceObserver((l) => {
    for (const e of l.getEntries()) p.maxTask = Math.max(p.maxTask, e.duration)
  }).observe({ entryTypes: ['longtask'] })
  let last = performance.now()
  setInterval(() => {
    const t = performance.now()
    p.maxGap = Math.max(p.maxGap, t - last - 50)
    last = t
  }, 50)
  document.addEventListener(
    'pointerdown',
    (e) => p.inputDelays.push(Math.round(performance.now() - e.timeStamp)),
    true,
  )
})()`

interface Probe {
  maxTask: number
  maxGap: number
  inputDelays: number[]
}

/** A thought long enough to matter, delivered one delta per macrotask — the
 *  shape a reasoning model's stream has, at a rate a fast provider reaches. */
const THOUGHT = 'think x150 weighing the options for this step of the plan'

/** Exchanges in the seeded session. Enough that a per-delta walk of it is
 *  unmistakable against an empty one. */
const TURNS = 120

/** Write a session of `turns` exchanges straight into IndexedDB — a long
 *  conversation for the price of a millisecond instead of the minutes it would
 *  take to stream one. Shape matches StoredSession / UiMessage (stores/chat). */
async function seedSession(page: Page, turns: number): Promise<void> {
  await page.evaluate(async (turns) => {
    const reply = 'The note now records that decision and links the source. '.repeat(54)
    const uiMessages: unknown[] = []
    const history: unknown[] = []
    let id = 1
    let parentId: number | null = null
    for (let i = 0; i < turns; i++) {
      const ask = `Summarize section ${i} and file it under wiki/. `.repeat(3)
      uiMessages.push({ id: id++, role: 'user', parts: [{ type: 'text', text: ask }], parentId })
      parentId = id - 1
      uiMessages.push({
        id: id++,
        role: 'assistant',
        parts: [
          { type: 'tool', name: 'read_file', detail: `wiki/note-${i}.md` },
          { type: 'text', text: reply },
        ],
        parentId,
      })
      parentId = id - 1
      history.push({ role: 'user', content: ask })
      history.push({ role: 'assistant', content: reply })
    }
    const session = {
      id: 'seeded-long-session',
      kb: 'e2e-kb',
      title: 'Seeded long session',
      profileId: '',
      provider: 'mock',
      uiMessages,
      leafId: parentId,
      history,
      anthropicHistory: [],
      openaiHistory: [],
      createdAt: Date.now() - 1000,
      updatedAt: Date.now() - 1000,
      favorite: false,
    }
    await new Promise<void>((resolve, reject) => {
      const req = indexedDB.open('localmd', 2)
      req.onsuccess = () => {
        const db = req.result
        const t = db.transaction('sessions', 'readwrite')
        t.objectStore('sessions').put(session)
        t.oncomplete = () => {
          db.close()
          resolve()
        }
        t.onerror = () => reject(t.error)
      }
      req.onerror = () => reject(req.error)
    })
  }, turns)
}

/** Stream the thought and report how long it took plus what the main thread was
 *  doing — clicking empty transcript space throughout, so input delay is
 *  measured against real events rather than inferred from task lengths. */
async function streamThought(page: Page): Promise<{ ms: number; probe: Probe }> {
  await page.evaluate(PROBE)
  const input = page.getByPlaceholder(/Ask the agent/)
  await input.fill(THOUGHT)
  const started = Date.now()
  await input.press('Enter')

  const box = await page.locator('main').boundingBox()
  for (let i = 0; i < 8; i++) {
    await page.mouse.click((box?.x ?? 400) + 40, (box?.y ?? 300) + 40)
    await page.waitForTimeout(250)
  }
  await expect(page.getByText('Done thinking').last()).toBeVisible({ timeout: 120_000 })
  const ms = Date.now() - started
  return { ms, probe: (await page.evaluate('window.__probe')) as Probe }
}

async function openScaffolded(page: Page): Promise<void> {
  await page.goto('/?e2e=1')
  await expect(page.getByText('This folder is empty')).toBeVisible({ timeout: 10_000 })
  await page.getByRole('button', { name: /Initialize knowledge base/ }).click()
  await expect(page.getByPlaceholder(/Ask the agent/)).toBeVisible()
}

test('streaming into a long session costs no more than into an empty one', async ({ page }) => {
  test.setTimeout(180_000)

  await openScaffolded(page)
  const fresh = await streamThought(page)

  await seedSession(page, TURNS)
  await page.reload()
  await page.getByTitle('Chat history').click()
  await page.getByText('Seeded long session').first().click()
  await expect(page.getByPlaceholder(/Ask the agent/)).toBeVisible()
  const long = await streamThought(page)

  const ratio = long.ms / fresh.ms
  console.log(
    `[perf] fresh=${fresh.ms}ms long(${TURNS} turns)=${long.ms}ms ratio=${ratio.toFixed(2)}× ` +
      `maxTask=${Math.round(long.probe.maxTask)}ms maxGap=${Math.round(long.probe.maxGap)}ms ` +
      `worstInput=${Math.max(0, ...long.probe.inputDelays)}ms`,
  )

  // Was ~3.8× when every delta re-rendered the whole transcript; ~1.4× once a
  // delta reaches one row. The margin leaves room for a slow machine without
  // leaving room for the bug.
  expect(ratio).toBeLessThan(2.2)
  // And a click must still reach its handler in about a frame's wait.
  expect(Math.max(0, ...long.probe.inputDelays)).toBeLessThan(200)
})
