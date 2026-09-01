/**
 * The one thing this app reports without being asked.
 *
 * A page view on load (wired in main.ts) and, on the start screen, the fact
 * that someone opened the demo. Nothing else: the moment a folder is open,
 * what happens inside it is the user's business, and an event named after a
 * file or a key would be exactly the sort of thing this product tells people
 * does not happen.
 *
 * `demo_open` is the one event that stays on the right side of that line —
 * it fires before any folder exists, and it answers the only question the
 * start screen cannot answer for itself: of the people who arrive, how many
 * try it. It is disclosed in docs/app/storage-and-privacy.md, which must
 * keep saying so.
 *
 * PROD only, like the page view: dev traffic and the e2e suite are not
 * anybody's funnel.
 *
 * The beacon is same-origin by construction: a copy of localmd you host
 * yourself reports to your origin, not ours, and there is nothing here that
 * phones home to localmd.app. docs/app/storage-and-privacy.md says so and
 * must keep saying so.
 *
 * The `@vercel/analytics/vue` entry is not usable here: it imports vue-router
 * at module scope, and this app is a single page with no router.
 */
import { inject, track } from '@vercel/analytics'

/** Names are a closed set on purpose — see the module comment before adding
 *  one, and update the privacy topic in the same commit. */
type Event = 'demo_open'

/** Begin counting page views. Called once, at boot. */
export function start(): void {
  if (!import.meta.env.PROD) return
  try {
    inject()
  } catch {
    // Counting is never worth breaking the thing being counted.
  }
}

export function report(event: Event): void {
  if (!import.meta.env.PROD) return
  try {
    track(event)
  } catch {
    // Counting is never worth breaking the thing being counted.
  }
}
