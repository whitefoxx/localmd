<script setup lang="ts">
/**
 * Outline preview for PowerPoint decks: one card per slide with its title,
 * text (indented by outline level) and embedded pictures. The original layout
 * is deliberately not reproduced — a faithful browser renderer of PowerPoint's
 * layout model is a product in itself — and the header note says so. The
 * extractor is imported on demand; legacy binary .ppt opens here and says so.
 */
import { ref, watch, onBeforeUnmount } from 'vue'
import { useFilesStore } from '@/stores/files'
import * as fs from '@/lib/fs'
import { fileKind } from '@/lib/filetypes'
import { t } from '@/i18n'
import type { SlideOutline } from '@/lib/pptx'

const files = useFilesStore()
const slides = ref<SlideOutline[]>([])
const loading = ref(false)
const error = ref('')
const legacy = ref(false)
const imageUrls = ref(new Map<string, string>())

/** Guards against an earlier, slower load overwriting a later one. */
let loadToken = 0

function releaseImages(): void {
  for (const url of imageUrls.value.values()) URL.revokeObjectURL(url)
  imageUrls.value = new Map()
}

async function load(path: string | null): Promise<void> {
  const token = ++loadToken
  releaseImages()
  slides.value = []
  error.value = ''
  legacy.value = false
  if (!path || fileKind(path) !== 'slides') return
  loading.value = true
  try {
    const [{ extractPptx, LegacyPptError }, bytes] = await Promise.all([
      import('@/lib/pptx'),
      fs.readBinary(path),
    ])
    if (token !== loadToken) return
    try {
      const result = await extractPptx(bytes)
      if (token !== loadToken) return
      const urls = new Map<string, string>()
      for (const [key, blob] of result.media) urls.set(key, URL.createObjectURL(blob))
      imageUrls.value = urls
      slides.value = result.slides
    } catch (err) {
      if (err instanceof LegacyPptError) legacy.value = true
      else throw err
    }
  } catch (err) {
    if (token === loadToken) error.value = (err as Error).message || t('viewers.slides.loadFailed')
  } finally {
    if (token === loadToken) loading.value = false
  }
}

watch(() => files.currentPath, load, { immediate: true })
onBeforeUnmount(releaseImages)
</script>

<template>
  <div class="h-full panel-scroll">
    <div v-if="loading" class="h-full flex items-center justify-center gap-2 text-sm text-fg-3">
      <span class="codicon codicon-sm codicon-loading codicon-modifier-spin" />
      {{ $t('viewers.slides.loading') }}
    </div>

    <div v-else-if="legacy" class="h-full flex items-center justify-center text-fg-3">
      <div class="text-center max-w-md px-6">
        <span class="codicon codicon-lg codicon-file block mb-2" />
        <div class="text-fg-1 mb-1">{{ $t('viewers.slides.legacyTitle') }}</div>
        <p class="text-xs leading-relaxed">{{ $t('viewers.slides.legacyHint') }}</p>
      </div>
    </div>

    <div v-else-if="error" class="h-full flex items-center justify-center text-fg-3">
      <div class="text-center max-w-md px-6">
        <span class="codicon codicon-lg codicon-warning block mb-2" />
        <p class="text-xs leading-relaxed">{{ error }}</p>
      </div>
    </div>

    <div v-else-if="slides.length" class="max-w-3xl mx-auto px-8 py-6">
      <p class="text-xs text-fg-3 mb-4">{{ $t('viewers.slides.outlineHint') }}</p>
      <div
        v-for="(slide, i) in slides"
        :key="i"
        class="mb-4 rounded border border-border bg-bg-1 px-5 py-4"
      >
        <div class="flex items-baseline gap-3 mb-2">
          <span class="text-xs text-fg-3 shrink-0 select-none">{{ i + 1 }}</span>
          <div v-if="slide.title" class="text-fg-0 font-medium">{{ slide.title }}</div>
        </div>
        <p
          v-for="(line, j) in slide.lines"
          :key="j"
          class="text-sm text-fg-1 leading-relaxed"
          :style="{ paddingLeft: `${line.lvl * 1.25}rem` }"
        >
          {{ line.text }}
        </p>
        <div v-if="slide.images.length" class="flex flex-wrap gap-3 mt-3">
          <img
            v-for="key in slide.images"
            :key="key"
            :src="imageUrls.get(key)"
            class="max-h-56 max-w-full rounded border border-border"
          />
        </div>
      </div>
    </div>

    <div v-else class="h-full flex items-center justify-center text-fg-3 text-xs">
      {{ $t('viewers.slides.empty') }}
    </div>
  </div>
</template>
