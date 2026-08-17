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
export const useUpdateStore = defineStore('update', () => {
  /** A build is waiting and the user has not dealt with it yet. */
  const ready = ref(false)
  /** The reload has been asked for; the page is on its way out. */
  const applying = ref(false)

  /** Supplied by the registration in main.ts: messages the waiting worker to
   *  skip waiting, which lands as `controlling` and reloads the page. */
  let apply: (() => Promise<void>) | null = null

  function offer(fn: () => Promise<void>): void {
    apply = fn
    ready.value = true
  }

  async function applyNow(): Promise<void> {
    if (!apply || applying.value) return
    applying.value = true
    await apply()
  }

  /** Not now. The worker stays waiting; the next full page load picks it up,
   *  and nothing asks again this session. */
  function dismiss(): void {
    ready.value = false
  }

  return { ready, applying, offer, applyNow, dismiss }
})
