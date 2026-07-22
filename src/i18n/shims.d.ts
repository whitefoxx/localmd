// Augments Vue's component instance with the global `$t` helper registered by
// the i18n plugin (src/i18n). The `import 'vue'` makes this a module so the
// `declare module 'vue'` below AUGMENTS Vue's types instead of replacing them.
import 'vue'

declare module 'vue' {
  interface ComponentCustomProperties {
    $t: (key: string, params?: Record<string, string | number>) => string
  }
}
