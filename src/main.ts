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
