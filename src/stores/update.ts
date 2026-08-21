import { defineStore } from 'pinia'
import { ref } from 'vue'

/**
 * A newer build is on the server and waiting to take over.
 *
 * The service worker is registered with `registerType: 'prompt'` (see
 * vite.config.ts), so a new version installs and then *stops* — it does not
 * activate, and this page goes on being served by the precache it was loaded
 * against. Applying it is a page reload, and a page reload is not free here:
 * it ends whatever the agent was doing and, unless the browser still remembers
 * granting the folder, drops the user back on the start screen. So the reload
 * is a thing the user does, not a thing that happens to them.
 *
 * The one exception is when there is nothing to lose — see main.ts.
 */

/** How long to wait for the new worker to take over before reloading anyway. */
const TAKEOVER_GRACE_MS = 2500

/** How often an open tab asks whether a newer build exists. */
const CHECK_EVERY_MS = 30 * 60 * 1000
/** Floor between checks, so flicking between tabs is not a poll. */
const CHECK_COOLDOWN_MS = 60 * 1000

/**
 * Keep asking whether a newer build has shipped.
 *
 * The registration is checked when the page loads and then, by default, never
 * again — so a tab that was already open when a deploy landed goes on serving
 * the build it started with for as long as it stays open. Nothing looks broken;
 * the fix you just shipped is simply not there, and the natural reaction (a
 * hard reload) makes it *more* confusing rather than less: a hard reload
 * bypasses the worker for the page's own requests, so the new bundle appears
 * while the old precache is still being replaced underneath it.
 *
 * Two triggers, because the useful moments are different. Coming back to the
 * tab is when a person would notice anything at all; the timer covers a tab
 * left in the foreground for hours. Both go through the same cooldown, so
 * switching between tabs cannot turn into a poll, and neither fires while the
 * tab is hidden or the machine is offline — an update check that cannot
 * succeed is just a request nobody asked for.
 *
 * What it does NOT do is apply anything: finding a build and taking it are
 * separate decisions, and the second one belongs to whoever is mid-sentence
 * (see the module comment above, and main.ts for the one case with nothing to
 * lose).
 */
export function watchForUpdates(registration: ServiceWorkerRegistration): void {
  let last = 0
  const check = (): void => {
    if (document.visibilityState !== 'visible' || !navigator.onLine) return
    const now = Date.now()
    if (now - last < CHECK_COOLDOWN_MS) return
    last = now
    // A failed check is not an error worth surfacing — offline, a flaky
    // network, a deploy mid-flight. The next trigger tries again.
    void registration.update().catch(() => {})
  }
  document.addEventListener('visibilitychange', check)
  window.setInterval(check, CHECK_EVERY_MS)
}

export const useUpdateStore = defineStore('update', () => {
  /** A build is waiting and the user has not dealt with it yet. */
  const ready = ref(false)
  /** The reload has been asked for; the page is on its way out. */
  const applying = ref(false)

  /** Supplied by the registration in main.ts: messages the waiting worker to
   *  skip waiting, which lands as `controlling` and reloads the page. */
  let apply: (() => Promise<void>) | null = null
  let graceTimer: ReturnType<typeof setTimeout> | null = null

  function offer(fn: () => Promise<void>): void {
    apply = fn
    ready.value = true
  }

  /**
   * Reload, once, whatever happened to the worker.
   *
   * The plugin's own client reloads on `controllerchange`, and that event is
   * not guaranteed to arrive: a page that was never controlled (the load that
   * *installed* the first worker is not — the build sets no `clientsClaim`)
   * is not "using" the registration, so skipWaiting activates the new worker
   * without ever taking this page over. Nothing then reloads, and the card sat
   * on "Reloading…" with both its buttons disabled — a dead end reachable from
   * one click. Owning the reload here (on takeover, or on a timer when takeover
   * never comes) means the answer to "reload now?" is always a reload.
   */
  let reloaded = false
  function reloadNow(): void {
    if (reloaded) return
    reloaded = true
    window.location.reload()
  }

  async function applyNow(): Promise<void> {
    if (!apply || applying.value) return
    applying.value = true
    navigator.serviceWorker?.addEventListener('controllerchange', reloadNow, { once: true })
    graceTimer = setTimeout(reloadNow, TAKEOVER_GRACE_MS)
    await apply()
  }

  /** Not now. The worker stays waiting; the next full page load picks it up,
   *  and nothing asks again this session. Still offered *while* applying: a
   *  reload that is taking suspiciously long has to stay refusable. */
  function dismiss(): void {
    if (graceTimer) {
      clearTimeout(graceTimer)
      graceTimer = null
    }
    navigator.serviceWorker?.removeEventListener('controllerchange', reloadNow)
    reloaded = true // a takeover that lands late must not yank the page away
    applying.value = false
    ready.value = false
  }

  return { ready, applying, offer, applyNow, dismiss }
})
