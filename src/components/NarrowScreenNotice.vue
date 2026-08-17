<script setup lang="ts">
/**
 * The narrow-screen bar.
 *
 * A phone can only ever reach the demo — picking a folder needs the File System
 * Access API, which no mobile browser has — and the demo is worth seeing there,
 * so this does not stand in front of it. The workspace already gives the
 * document the whole width on a narrow screen (see `isNarrow` in stores/ui), and
 * a demo you can read is the best argument the product has.
 *
 * What a phone still cannot do is the thing the three columns are for: the file
 * tree, the document and the agent at once. So this says that, from the bottom
 * of the screen, and offers the address to carry to a machine that can. A bar
 * rather than a wall: the reason to move to a desktop is visible behind it.
 */
import { onBeforeUnmount, ref, watch } from 'vue'
import { useUiStore } from '@/stores/ui'

const ui = useUiStore()
const copied = ref(false)

/**
 * Report our own height so the floating agent button can sit clear of us. The
 * bar wraps to a different number of lines at 320px than at 430, so this is
 * observed rather than assumed — a constant that cleared it on one phone would
 * bury the button on another.
 */
const bar = ref<HTMLElement | null>(null)
let observer: ResizeObserver | null = null

watch(bar, (el) => {
  observer?.disconnect()
  observer = null
  if (!el) {
    ui.narrowNoticeHeight = 0
    return
  }
  observer = new ResizeObserver(() => (ui.narrowNoticeHeight = el.offsetHeight))
  observer.observe(el)
  ui.narrowNoticeHeight = el.offsetHeight
})

onBeforeUnmount(() => {
  observer?.disconnect()
  ui.narrowNoticeHeight = 0
})

/**
 * Carry the address to a machine that can use it. `location.href`, not the bare
 * site: it keeps `?demo`, so the desktop lands on the same knowledge base this
 * visitor was just reading rather than back at the front door.
 */
async function copyAddress(): Promise<void> {
  try {
    await navigator.clipboard.writeText(location.href)
    copied.value = true
    setTimeout(() => (copied.value = false), 2500)
  } catch {
    // Clipboard denied (insecure context, or a browser that asks). The address
    // is in the URL bar; nothing is lost by staying quiet.
  }
}
</script>

<template>
  <Teleport to="body">
    <!-- Above the pricing dialog (z-60), the top layer otherwise: this is a
         standing note about the whole window, not part of any one panel. -->
    <div
      v-if="ui.narrowNoticeOpen"
      ref="bar"
      class="fixed inset-x-0 bottom-0 z-[70] border-t border-border bg-bg-1/95 px-4 py-3 backdrop-blur"
    >
      <div class="flex items-center gap-3">
        <div class="min-w-0 flex-1">
          <div class="text-sm font-medium text-fg-0">{{ $t('narrow.title') }}</div>
          <p class="mt-0.5 text-xs leading-snug text-fg-3">{{ $t('narrow.body') }}</p>
        </div>
        <button
          class="shrink-0 self-start rounded p-1 text-fg-3 hover:text-fg-0"
          :title="$t('common.close')"
          @click="ui.narrowNoticeDismissed = true"
        >
          <span class="codicon codicon-sm codicon-close" />
        </button>
      </div>
      <button class="btn-cta mt-2.5 w-full justify-center text-sm" @click="copyAddress">
        <span class="codicon codicon-sm" :class="copied ? 'codicon-check' : 'codicon-link'" />
        {{ copied ? $t('openKb.copied') : $t('openKb.copyAddress') }}
      </button>
    </div>
  </Teleport>
</template>
