/**
 * Citation navigation: clicking a `[[N:blockid]]` chip opens the cited
 * document and asks its viewer to scroll to and highlight the block. The
 * pending jump survives the viewer mount (documents load async), and each
 * viewer consumes it once its content is ready.
 */
import { defineStore } from 'pinia'
import { ref } from 'vue'
import { useFilesStore } from '@/stores/files'
import { useUiStore } from '@/stores/ui'

export interface PendingJump {
  path: string
  /** Block id like `b14-3`, or null when just opening the document. */
  blockId: string | null
  /** Monotonic — lets viewers react to repeat jumps to the same block. */
  nonce: number
}

let nonce = 0

export const useCitationsStore = defineStore('citations', () => {
  const pending = ref<PendingJump | null>(null)

  async function openCitation(path: string, blockId: string | null): Promise<void> {
    const ui = useUiStore()
    const files = useFilesStore()
    ui.graphOpen = false
    pending.value = { path, blockId, nonce: ++nonce }
    await files.openFile(path)
  }

  /** Called by a viewer once it has handled (or cannot handle) the jump. */
  function clear(): void {
    pending.value = null
  }

  return { pending, openCitation, clear }
})
