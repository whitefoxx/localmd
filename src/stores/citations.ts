/**
 * Citation navigation: clicking a `[[N:blockid]]` chip opens the cited
 * document and asks its viewer to scroll to and highlight the block. The
 * pending jump survives the viewer mount (documents load async), and each
 * viewer consumes it once its content is ready.
 */
import { defineStore } from 'pinia'
import { ref } from 'vue'
import { useFilesStore } from '@/stores/files'
import { useKbIndexStore } from '@/stores/kbIndex'
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

  /** Fallback for chips with no resolved source (declaration out of reach, or
   *  the numberless [[bxx-y]] form): locate the block through the document
   *  indexes. Block ids repeat across documents, so prefer the current one. */
  async function openByBlock(blockId: string): Promise<void> {
    const kbIndex = useKbIndexStore()
    const files = useFilesStore()
    let sources = kbIndex.findBlockSources(blockId)
    if (!sources.length) {
      await kbIndex.refresh() // index may not be loaded yet
      sources = kbIndex.findBlockSources(blockId)
    }
    if (!sources.length) return
    const path = files.currentPath && sources.includes(files.currentPath)
      ? files.currentPath
      : sources[0]
    await openCitation(path, blockId)
  }

  /** Called by a viewer once it has handled (or cannot handle) the jump. */
  function clear(): void {
    pending.value = null
  }

  return { pending, openCitation, openByBlock, clear }
})
