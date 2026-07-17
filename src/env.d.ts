/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

declare module '*.vue' {
  import type { DefineComponent } from 'vue'
  const component: DefineComponent<object, object, unknown>
  export default component
}

// File System Access "save as" picker — present in Chrome/Edge but not yet in
// TS's lib.dom (showDirectoryPicker and handle.resolve already are).
interface Window {
  showSaveFilePicker(options?: {
    suggestedName?: string
    startIn?: FileSystemHandle | string
    types?: { description?: string; accept: Record<string, string[]> }[]
  }): Promise<FileSystemFileHandle>
}
