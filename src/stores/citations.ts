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
import { chooseBlockSource, resolveCitePath } from '@/lib/citations'

/** Direct jump target from the annotations page — no doc-index involved.
 *  EPUB sets `cfi`; PDF sets `page` (1-based) + region `rects` (PDF points,
 *  top-left origin, the annotation's own segmentRects); DOCX sets `range`
 *  (the `b1-3:10~b1-4:22` locator). */
export interface AnnotationTarget {
  cfi?: string
  page?: number
  rects?: { x: number; y: number; w: number; h: number }[]
  range?: string
}

export interface PendingJump {
  path: string
  /** Block id like `b14-3`, or null when just opening the document. */
  blockId: string | null
  /** Set when jumping to a user annotation instead of an indexed block. */
  annotation?: AnnotationTarget
  /** Monotonic — lets viewers react to repeat jumps to the same block. */
  nonce: number
}

let nonce = 0

/** A click that could not be answered: several documents hold the block id, or
 *  none that still exists does. Rendered by CitationPicker — the click stops
 *  here and the user settles it, because the alternative is opening a book at
 *  random and calling it the source. */
export interface Unresolved {
  blockId: string
  /** Documents holding the id, all of which exist. Empty = nothing to open. */
  paths: string[]
  /** Set instead of `paths` when a declared path names no file in the KB. */
  declared?: string
}

export const useCitationsStore = defineStore('citations', () => {
  const pending = ref<PendingJump | null>(null)
  const unresolved = ref<Unresolved | null>(null)

  /** Set the jump and open the document — `path` is trusted to be real here.
   *  Answers whether the document is now on screen (see files.openFile): a
   *  citation whose file has since been deleted opens nothing, and the caller
   *  may need to know that rather than rearrange the app around a blank. */
  async function jump(path: string, blockId: string | null): Promise<boolean> {
    const ui = useUiStore()
    const files = useFilesStore()
    ui.graphOpen = false
    pending.value = { path, blockId, nonce: ++nonce }
    return files.openFile(path)
  }

  /** Open a cited document. The declared path is repaired first (basename
   *  match) — the model abbreviates and users move files, and a chip that
   *  opens a "not found" tab has failed at its one job. When no file
   *  defensibly matches, fall back to locating the block through the
   *  document indexes rather than opening a dead path. */
  async function openCitation(path: string, blockId: string | null): Promise<boolean> {
    const files = useFilesStore()
    const resolved = resolveCitePath(path, files.allFiles)
    if (resolved) return jump(resolved, blockId)
    if (blockId) return openByBlock(blockId)
    // Nothing to search for either. Say the file is gone, rather than opening
    // a tab onto a path that is not there and letting the viewer explain.
    unresolved.value = { blockId: '', paths: [], declared: path }
    return false
  }

  /** Jump from the annotations page to a highlight's position in the book. */
  async function openAnnotation(path: string, target: AnnotationTarget): Promise<void> {
    const ui = useUiStore()
    const files = useFilesStore()
    ui.graphOpen = false
    pending.value = { path, blockId: null, annotation: target, nonce: ++nonce }
    await files.openFile(path)
  }

  /**
   * Fallback for chips with no resolved source (declaration out of reach, or
   * the numberless [[bxx-y]] form): locate the block through the document
   * indexes.
   *
   * Block ids are per-document NAMES, so several documents legitimately hold
   * the same one and the candidate list is a question, not a ranking. This
   * used to answer it with `sources[0]` — the first one the section cache
   * happened to load — which is how a note on Han-dynasty salt policy opened a
   * book about undergraduate mathematics. The decision now lives in
   * lib/citations, and when it cannot be made it is handed to the user.
   */
  async function openByBlock(blockId: string): Promise<boolean> {
    const kbIndex = useKbIndexStore()
    const files = useFilesStore()
    let sources = kbIndex.findBlockSources(blockId)
    if (!sources.length) {
      await kbIndex.refresh() // index may not be loaded yet
      sources = kbIndex.findBlockSources(blockId)
    }
    const choice = chooseBlockSource(sources, {
      current: files.currentPath,
      exists: (p) => files.allFiles.includes(p),
    })
    if (choice.kind === 'one') {
      // jump, not openCitation: the path came out of an index, and repairing
      // THAT would send openCitation back here forever.
      return jump(choice.path, blockId)
    }
    unresolved.value = { blockId, paths: choice.kind === 'ambiguous' ? choice.paths : [] }
    return false
  }

  /** The picker's answer — the one place an ambiguous block id is settled. */
  async function resolveTo(path: string): Promise<boolean> {
    const u = unresolved.value
    unresolved.value = null
    if (!u) return false
    return jump(path, u.blockId || null)
  }

  function dismissUnresolved(): void {
    unresolved.value = null
  }

  /** Called by a viewer once it has handled (or cannot handle) the jump. */
  function clear(): void {
    pending.value = null
  }

  return { pending, unresolved, openCitation, openAnnotation, openByBlock, resolveTo, dismissUnresolved, clear }
})
