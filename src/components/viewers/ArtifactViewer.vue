<script setup lang="ts">
/**
 * Renders an HTML artifact (agent-generated, self-contained) in a SANDBOXED
 * iframe. `sandbox="allow-scripts allow-popups"` WITHOUT allow-same-origin
 * forces an opaque origin: the artifact's JS runs but cannot read this app's
 * localStorage/cookies or reach the parent DOM. Never add allow-same-origin.
 */
import { ref, watch } from 'vue'
import * as fs from '@/lib/fs'
import { useFilesStore } from '@/stores/files'
import { escapeHtml, baseName } from '@/lib/wiki'

const files = useFilesStore()
const content = ref('')
const showSource = ref(false)

async function load(path: string | null): Promise<void> {
  content.value = ''
  showSource.value = false
  if (!path) return
  content.value = (await fs.tryReadFile(path)) ?? ''
}
watch(() => files.currentPath, load, { immediate: true })

/** Open in a real browser tab, still sandboxed: a tiny trusted wrapper page
 *  hosts the artifact in a sandbox=allow-scripts iframe (opaque origin), so it
 *  can't read this app's storage even though the tab itself is same-origin. */
function openInNewTab(): void {
  const name = files.currentPath ? baseName(files.currentPath) : 'artifact'
  const wrapper =
    `<!doctype html><meta charset="utf-8"><title>${escapeHtml(name)}</title>` +
    `<style>html,body{margin:0;height:100%}iframe{border:0;width:100%;height:100%}</style>` +
    `<iframe sandbox="allow-scripts allow-popups" srcdoc="${escapeHtml(content.value)}"></iframe>`
  const url = URL.createObjectURL(new Blob([wrapper], { type: 'text/html' }))
  window.open(url, '_blank', 'noopener')
  setTimeout(() => URL.revokeObjectURL(url), 60_000) // let the new tab load it first
}
</script>

<template>
  <div class="h-full w-full flex flex-col">
    <div class="flex items-center gap-2 px-3 h-8 border-b border-border shrink-0">
      <span class="codicon codicon-sm codicon-preview text-accent shrink-0" />
      <span class="text-xs text-fg-3 flex-1 truncate">{{ files.currentPath }}</span>
      <button class="btn text-xs" @click="showSource = !showSource">
        <span
          class="codicon codicon-sm mr-1"
          :class="showSource ? 'codicon-preview' : 'codicon-code'"
        />{{ showSource ? $t('viewers.artifact.preview') : $t('viewers.artifact.source') }}
      </button>
      <button class="btn text-xs" :title="$t('viewers.artifact.openNewTab')" @click="openInNewTab">
        <span class="codicon codicon-sm codicon-link-external mr-1" />{{ $t('viewers.artifact.newTab') }}
      </button>
    </div>
    <div class="flex-1 min-h-0">
      <iframe
        v-if="!showSource"
        :key="files.currentPath ?? ''"
        :srcdoc="content"
        sandbox="allow-scripts allow-popups"
        class="w-full h-full border-0 bg-white"
        title="artifact"
      />
      <pre
        v-else
        class="h-full overflow-auto panel-scroll p-3 text-xs font-mono selectable bg-bg-0 text-fg-1 whitespace-pre-wrap"
      >{{ content }}</pre>
    </div>
  </div>
</template>
