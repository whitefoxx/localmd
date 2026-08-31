/**
 * Whether this build reports anything — it reports two things, to the host
 * that serves it.
 *
 * This is the seam, and deliberately the whole of it. What is worth counting,
 * when counting is allowed, and the closed set of event names all live in
 * `src/lib/analytics.ts`, which both editions share and neither may restate.
 * This file answers only "does anything leave, and to whom", so an edition
 * that reports nothing is two empty functions — and carries no analytics
 * dependency at all, which is the part a reader can check.
 *
 * The `@vercel/analytics/vue` entry is not usable here: it imports vue-router
 * at module scope, and this app is a single page with no router.
 */
import { inject, track } from '@vercel/analytics'

/** Begin counting page views. Called once, at boot. */
export function startReporting(): void {
  inject()
}

/** Report one named event. */
export function reportEvent(name: string): void {
  track(name)
}
