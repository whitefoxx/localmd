/**
 * Resolve knowledge-base image paths inside rendered markdown.
 *
 * `renderMarkdown` cannot do this itself: reading a file goes through the
 * File System Access API and is asynchronous, while marked is synchronous. So
 * it emits `<img data-kb-src="…">` and this composable fills in the src once
 * the bytes are in hand — the same object-URL dance the image and PDF viewers
 * do, just applied to whatever the current render produced.
 *
 * Every URL handed out here is revoked when the content changes or the pane
 * goes away; an unrevoked object URL pins the whole blob in memory for the
 * life of the tab, which for a note full of screenshots adds up fast.
 */
import { onBeforeUnmount, onMounted, watch, type Ref } from 'vue'
import * as fs from '@/lib/fs'
import { mimeFor } from '@/lib/filetypes'

export function useKbImages(
  root: Ref<HTMLElement | null>,
  deps: () => unknown,
  resolve: (href: string) => string | null,
): void {
  let urls: string[] = []

  function revokeAll(): void {
    for (const url of urls) URL.revokeObjectURL(url)
    urls = []
  }

  async function load(): Promise<void> {
    const el = root.value
    if (!el) return
    revokeAll()
    const imgs = el.querySelectorAll<HTMLImageElement>('img[data-kb-src]')
    await Promise.all(
      Array.from(imgs).map(async (img) => {
        const href = img.dataset.kbSrc
        if (!href) return
        const path = resolve(href)
        if (!path) {
          img.classList.add('kb-image-missing')
          return
        }
        try {
          const buf = await fs.readBinary(path)
          const url = URL.createObjectURL(new Blob([buf], { type: mimeFor(path) }))
          urls.push(url)
          img.src = url
          img.classList.remove('kb-image-missing')
        } catch {
          img.classList.add('kb-image-missing')
        }
      }),
    )
  }

  // `flush: 'post'` so the v-html has already been written to the DOM. The
  // first pass is onMounted rather than `immediate`, which would run during
  // setup — before there is any DOM to search for images.
  watch(deps, () => void load(), { flush: 'post' })
  onMounted(() => void load())
  onBeforeUnmount(revokeAll)
}
