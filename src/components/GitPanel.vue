<script setup lang="ts">
import { ref, watch } from 'vue'
import { useGitStore } from '@/stores/git'
import { useFilesStore } from '@/stores/files'
import { readHeadText } from '@/lib/git'
import { GIT_DECOR } from '@/lib/gitStatus'
import { diffLines, collapseContext, type HunkLine } from '@/lib/diff'
import * as fs from '@/lib/fs'
import { t } from '@/i18n'

const git = useGitStore()
const files = useFilesStore()

const message = ref('')
const checked = ref<Set<string>>(new Set())
const selected = ref<string | null>(null)
const diff = ref<HunkLine[]>([])

/** Only oversized (>100MB) binary additions are display-only. */
function committable(c: { oversized?: boolean }): boolean {
  return !c.oversized
}

// New change list → check everything committable by default, drop stale selections.
watch(
  () => git.changes,
  (changes) => {
    checked.value = new Set(changes.filter(committable).map((c) => c.path))
    if (!changes.find((c) => c.path === selected.value)) {
      selected.value = null
      diff.value = []
    }
  },
  { immediate: true },
)

function toggle(path: string): void {
  if (checked.value.has(path)) checked.value.delete(path)
  else checked.value.add(path)
  checked.value = new Set(checked.value)
}

async function showDiff(path: string): Promise<void> {
  selected.value = path
  if (git.changes.find((c) => c.path === path)?.binary) {
    diff.value = [{ type: 'same', text: t('git.binaryNoDiff') }]
    return
  }
  const before = (await readHeadText(path)) ?? ''
  const after = (await fs.tryReadFile(path)) ?? ''
  diff.value = collapseContext(diffLines(before, after))
}

async function doCommit(): Promise<void> {
  await git.commit([...checked.value], message.value)
  if (!git.error) message.value = ''
}

function fmtTime(ms: number): string {
  return new Date(ms).toLocaleString()
}
</script>

<template>
  <Teleport to="body">
    <div
      v-if="git.panelOpen"
      class="fixed inset-0 z-50 bg-black/50 flex items-center justify-center"
      @click.self="git.panelOpen = false"
    >
      <div class="w-[760px] max-w-[94vw] max-h-[86vh] rounded-lg border border-border bg-bg-1 flex flex-col">
        <!-- Header -->
        <div class="flex items-center gap-2 px-4 h-11 border-b border-border shrink-0">
          <span class="codicon codicon-source-control text-accent" />
          <span class="font-semibold text-fg-0">Git</span>
          <span v-if="git.branch" class="text-xs text-fg-3 shrink-0">
            <span class="codicon codicon-sm codicon-git-branch" /> {{ git.branch }}
          </span>
          <!-- Inline status: the header height is fixed, so busy→idle never
               shifts the changes/diff below (it used to be a row that appeared
               and disappeared on every open). -->
          <span
            class="text-xs flex-1 min-w-0 truncate px-1"
            :class="git.error ? 'text-removed' : 'text-fg-3'"
            :title="git.error || git.progress || git.busy || git.lastSync || ''"
          >
            <template v-if="git.busy">
              <span class="codicon codicon-sm codicon-loading codicon-modifier-spin mr-1" />{{
                git.progress || git.busy
              }}
            </template>
            <template v-else-if="git.error">{{ git.error }}</template>
            <template v-else-if="git.lastSync">{{ git.lastSync }}</template>
          </span>
          <template v-if="git.remote">
            <span class="text-xs text-fg-3 truncate">{{ git.remote.owner }}/{{ git.remote.repo }}</span>
            <button class="btn text-xs" :disabled="!!git.busy" @click="git.sync('pull')">
              <span class="codicon codicon-sm codicon-arrow-down mr-1" />{{ $t('git.pull') }}
            </button>
            <button class="btn text-xs" :disabled="!!git.busy" @click="git.sync('push')">
              <span class="codicon codicon-sm codicon-arrow-up mr-1" />{{ $t('git.push') }}
            </button>
          </template>
          <button class="text-fg-3 hover:text-fg-0" :disabled="!!git.busy" :title="$t('git.refresh')" @click="git.refresh()">
            <span class="codicon codicon-sm codicon-refresh" />
          </button>
          <button class="text-fg-3 hover:text-fg-0" @click="git.panelOpen = false">
            <span class="codicon codicon-close" />
          </button>
        </div>

        <div class="flex-1 flex min-h-0">
          <!-- Changes + commit -->
          <div class="w-[300px] shrink-0 border-r border-border flex flex-col">
            <div class="px-3 py-2 text-xs uppercase tracking-wide text-fg-3 shrink-0">
              {{ $t('git.changes', { n: git.changes.length }) }}
            </div>
            <div class="flex-1 panel-scroll">
              <div v-if="!git.changes.length" class="px-3 text-xs text-fg-3">
                {{ $t('git.noChanges') }}
              </div>
              <div
                v-for="c in git.changes"
                :key="c.path"
                class="flex items-center gap-2 px-3 py-1 text-xs cursor-pointer hover:bg-bg-2"
                :class="{ 'bg-bg-2': c.path === selected }"
                @click="showDiff(c.path)"
              >
                <input
                  type="checkbox"
                  :checked="checked.has(c.path)"
                  :disabled="!committable(c)"
                  class="shrink-0"
                  :title="committable(c) ? '' : $t('git.oversizedCheckbox')"
                  @click.stop="committable(c) && toggle(c.path)"
                />
                <span class="truncate flex-1" :class="GIT_DECOR[c.kind].class" :title="c.path">{{ c.path }}</span>
                <span
                  v-if="c.binary"
                  class="text-[10px] px-1 rounded bg-bg-2 text-fg-3 shrink-0"
                  :title="c.oversized ? $t('git.oversizedTitle') : $t('git.binaryTitle')"
                >{{ c.oversized ? '>100MB' : $t('git.binary') }}</span>
                <span
                  class="shrink-0 text-xs font-medium w-3 text-center"
                  :class="GIT_DECOR[c.kind].class"
                  :title="c.kind"
                >{{ GIT_DECOR[c.kind].letter }}</span>
              </div>
            </div>
            <div class="p-3 border-t border-border shrink-0">
              <textarea
                v-model="message"
                rows="2"
                class="input resize-none text-xs mb-2"
                :placeholder="$t('git.commitPlaceholder')"
              />
              <button
                class="btn-primary text-xs w-full"
                :disabled="!!git.busy || !message.trim() || !checked.size"
                @click="doCommit"
              >
                <span class="codicon codicon-sm codicon-check mr-1" />{{ $t('git.commitN', { n: checked.size }) }}
              </button>
            </div>
          </div>

          <!-- Diff / log -->
          <div class="flex-1 min-w-0 flex flex-col">
            <template v-if="selected">
              <div class="px-3 py-2 text-xs text-fg-3 border-b border-border shrink-0 truncate">
                {{ selected }} · {{ $t('git.diffVsHead') }}
                <button class="ml-2 text-accent hover:underline" @click="files.openFile(selected!); git.panelOpen = false">
                  {{ $t('common.open') }}
                </button>
              </div>
              <div class="flex-1 panel-scroll font-mono text-xs leading-5">
                <template v-for="(line, i) in diff" :key="i">
                  <div
                    v-if="line.type === 'skip'"
                    class="px-3 py-0.5 text-center text-fg-3 bg-bg-2/60 select-none"
                  >{{ $t('git.unchangedLines', { n: line.count }) }}</div>
                  <div
                    v-else
                    class="px-3 whitespace-pre-wrap"
                    :class="{
                      'bg-added/15 text-added': line.type === 'add',
                      'bg-removed/15 text-removed': line.type === 'del',
                      'text-fg-2': line.type === 'same',
                    }"
                  >{{ (line.type === 'add' ? '+ ' : line.type === 'del' ? '- ' : '  ') + line.text }}</div>
                </template>
              </div>
            </template>
            <template v-else>
              <div class="px-3 py-2 text-xs uppercase tracking-wide text-fg-3 shrink-0">{{ $t('git.recentCommits') }}</div>
              <div class="flex-1 panel-scroll">
                <div
                  v-for="e in git.log"
                  :key="e.oid"
                  class="px-3 py-1.5 border-b border-border/40"
                >
                  <div class="text-sm text-fg-1 truncate">{{ e.message }}</div>
                  <div class="text-xs text-fg-3">
                    <span class="font-mono">{{ e.oid.slice(0, 7) }}</span> · {{ e.author }} · {{ fmtTime(e.when) }}
                  </div>
                </div>
                <div v-if="!git.log.length" class="px-3 text-xs text-fg-3">{{ $t('git.noCommits') }}</div>
              </div>
            </template>
          </div>
        </div>
      </div>
    </div>
  </Teleport>
</template>
