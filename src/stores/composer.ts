import { defineStore } from 'pinia'
import { ref, watch } from 'vue'
import { useKbStore } from '@/stores/kb'

/** A snapshot of text the user selected, staged in the composer as a context
 *  chip. Travels with the next message so the agent sees the exact passage the
 *  user is asking about.
 *
 *  `file` is the KB path a selection came from; an absent `file` means the text
 *  was quoted from a previous agent reply. `pinned` decides its lifetime: an
 *  unpinned chip is transient — it mirrors the live selection and vanishes when
 *  the user deselects. Pinning it (the quote icon) freezes it as a snapshot that
 *  lives until removed with ✕. */
export interface SelectionRef {
  id: string
  file?: string
  text: string
  pinned: boolean
}

export const useComposerStore = defineStore('composer', () => {
  /** Staged selections, in the order the user made them. At most one is the
   *  transient "live" chip (tracked by `liveId`); the rest are pinned. */
  const refs = ref<SelectionRef[]>([])
  let liveId: string | null = null

  /** Reflect the current selection as the single transient chip. `file` is the
   *  source path, or null for a quote from an agent reply. Pinned chips are
   *  untouched, and a selection already matching a pinned chip shows no dup. */
  function syncLive(file: string | null, text: string): void {
    const t = text.trim()
    if (!t) return
    const f = file || undefined
    const same = (r: SelectionRef): boolean => r.text === t && r.file === f
    if (refs.value.some((r) => r.pinned && same(r))) {
      dropLive()
      return
    }
    const live = liveId ? refs.value.find((r) => r.id === liveId && !r.pinned) : undefined
    if (live) {
      live.file = f
      live.text = t
    } else {
      const r: SelectionRef = { id: crypto.randomUUID(), file: f, text: t, pinned: false }
      refs.value.push(r)
      liveId = r.id
    }
  }

  /** Remove just the transient chip (leaving pinned ones). */
  function dropLive(): void {
    if (!liveId) return
    refs.value = refs.value.filter((r) => r.id !== liveId)
    liveId = null
  }

  /** Selection cleared (deselect) → drop every unpinned chip. */
  function clearTransient(): void {
    if (refs.value.some((r) => !r.pinned)) refs.value = refs.value.filter((r) => r.pinned)
    liveId = null
  }

  /** Toggle a chip between transient (gray) and pinned (blue). Pinning decouples
   *  it from the live selection so a fresh selection starts a new transient chip. */
  function togglePin(id: string): void {
    const r = refs.value.find((x) => x.id === id)
    if (!r) return
    r.pinned = !r.pinned
    if (r.pinned && r.id === liveId) liveId = null
  }

  function remove(id: string): void {
    refs.value = refs.value.filter((r) => r.id !== id)
    if (id === liveId) liveId = null
  }

  function clear(): void {
    if (refs.value.length) refs.value = []
    liveId = null
  }

  // Staged context belongs to the KB it was selected in — drop it on KB switch.
  const kb = useKbStore()
  watch(() => kb.name, clear)

  return { refs, syncLive, clearTransient, togglePin, remove, clear }
})
