import { createApp } from 'vue'
import { createPinia } from 'pinia'
import { registerSW } from 'virtual:pwa-register'
import App from './App.vue'
import { i18n } from './i18n'
import './assets/main.css'

registerSW({ immediate: true })

createApp(App).use(createPinia()).use(i18n).mount('#app')

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
