import { createApp } from 'vue'
import { createPinia } from 'pinia'
import { registerSW } from 'virtual:pwa-register'
import App from './App.vue'
import { i18n } from './i18n'
import { useKbStore } from './stores/kb'
import { useUpdateStore, watchForUpdates } from './stores/update'
import { start as startAnalytics } from './lib/analytics'
import './assets/main.css'

createApp(App).use(createPinia()).use(i18n).mount('#app')

// Service worker. Registered after the mount, not before it, because the
// update callback reads pinia stores — and because nothing here should delay
// the first paint.
//
// `onNeedRefresh` is what makes this a prompt rather than an ambush: without a
// callback the plugin's client reloads the page by itself (see vite.config.ts).
// A no-op is deliberately not enough either — the offer has to reach the user.
const updateSW = registerSW({
  immediate: true,
  // Registration checks for a new build once, at load. An open tab has to keep
  // asking, or a deploy stays invisible to it for as long as it stays open.
  onRegisteredSW(_url, registration) {
    if (registration) watchForUpdates(registration)
  },
  onNeedRefresh() {
    const update = useUpdateStore()
    update.offer(updateSW)
    // With no KB open there is no unsaved work, no agent turn and no folder
    // handle to lose, so reloading now is invisible rather than clever — and
    // it keeps the common case (a visitor on the start screen) always current.
    if (!useKbStore().isOpen) void update.applyNow()
  },
})

// An anonymous page view for the deployed site, and the only thing this app
// sends without the user asking for it (docs/app/storage-and-privacy.md says
// so, and must keep saying so). One call at boot is the whole story: this is a
// single page with no router. Whether it reaches anyone is the edition's
// answer, and PROD-only is enforced inside — dev traffic and the e2e suite,
// which runs against the dev server, are not anybody's funnel.
startAnalytics()

// E2E mode: in-memory KB + mock provider (see src/e2e/bootstrap.ts).
if (new URLSearchParams(location.search).has('e2e')) {
  void import('@/e2e/bootstrap').then((m) => m.bootstrapE2e())
}

// Demo mode: in-memory KB seeded from public/demo (see src/demo/bootstrap.ts).
if (new URLSearchParams(location.search).has('demo')) {
  void import('@/demo/bootstrap').then((m) => m.bootstrapDemo())
}

// Dev-only: regenerate the demo's prebuilt document index (see
// src/demo/buildIndex.ts). Never reaches a production bundle.
if (import.meta.env.DEV && new URLSearchParams(location.search).has('demo-build')) {
  void import('@/demo/buildIndex').then((m) => m.buildDemoIndex())
}
