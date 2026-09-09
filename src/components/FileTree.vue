<script setup lang="ts">
import { ref, provide, computed, watch, nextTick } from 'vue'
import { useFilesStore, type SelectedRow } from '@/stores/files'
import { useKbStore } from '@/stores/kb'
import { useKbIndexStore } from '@/stores/kbIndex'
import { useUiStore } from '@/stores/ui'
import * as fs from '@/lib/fs'
import { importFileInto } from '@/lib/capture'
import { indexableKind, indexDocument } from '@/lib/docindex'
import { checkRenumber, confirmRenumber } from '@/lib/renumber'
import {
  DRAG_ROWS,
  deleteRows,
  moveInteractive,
  moveRows,
  newFileInteractive,
  readDragRows,
  refreshGitStatus,
} from '@/lib/fileOps'
import FileTreeNode from '@/components/FileTreeNode.vue'
import type { TreeNode } from '@/lib/fs'
import { t } from '@/i18n'

const files = useFilesStore()
const kb = useKbStore()
const ui = useUiStore()
const fileInput = ref<HTMLInputElement | null>(null)
const indexStatus = ref('')
const expanded = ref(true)
const rootEl = ref<HTMLElement | null>(null)

/* Follow the active file: whenever it changes (a tab click, or an open from
 * backlinks / open-files / a wikilink / the agent), the tree expands the path
 * down to it, highlights that row alone, and scrolls it into view.
 * `block: 'nearest'` only nudges when the row is actually off-screen — e.g.
 * after the backlinks panel resizes below. */
watch(
  () => files.currentPath,
  async (path) => {
    if (!path) return
    files.revealPath(path)
    await nextTick() // rows of a just-expanded folder need to exist first
    const el = rootEl.value?.querySelector(`[data-tree-path="${CSS.escape(path)}"]`)
    el?.scrollIntoView({ block: 'nearest' })
  },
)

const ctxItem =
  'w-full flex items-center gap-2 px-3 py-1.5 text-left text-fg-1 hover:bg-bg-2 hover:text-fg-0'
const ctxSep = 'my-1 border-t border-border'

/* ── context menu (shared with every FileTreeNode via provide) ──────────── */
const ctx = ref<{ node: TreeNode; x: number; y: number } | null>(null)
provide('fileTreeCtx', (node: TreeNode, e: MouseEvent) => {
  ctx.value = { node, x: e.clientX, y: e.clientY }
})

/* Root drop = move to the KB root — but ONLY on true blank space (.self
 * modifiers): rows handle their own drops (dir = into it, file = into its
 * parent), so a drop between rows can't fall through to the root by accident. */
function onRootDragOver(e: DragEvent): void {
  if (e.dataTransfer?.types.includes(DRAG_ROWS)) e.preventDefault()
}
function onRootDrop(e: DragEvent): void {
  const rows = readDragRows(e.dataTransfer)
  if (!rows.length) return
  e.preventDefault()
  void moveRows(rows, '')
}

/* ── what the menu and the keys act on ───────────────────────────────────── */

/**
 * The rows every action below operates on: the selection, always.
 *
 * Not `ctx.node`. Right-clicking has already made the clicked row part of the
 * selection (FileTreeNode), so the two agree on one row and differ on four —
 * and reading the node instead would silently act on one of them while four sit
 * highlighted. A copy, because a delete mutates the selection as it goes.
 */
const picked = computed<SelectedRow[]>(() => files.selection.map((r) => ({ ...r })))
function closeMenu(): void {
  ctx.value = null
}
const menuStyle = computed(() => {
  if (!ctx.value) return {}
  const left = Math.max(4, Math.min(ctx.value.x, window.innerWidth - 210))
  const top = Math.max(4, Math.min(ctx.value.y, window.innerHeight - 340))
  return { left: `${left}px`, top: `${top}px` }
})

/* ── new items land in the target dir (selected folder / file's parent / root) */
function inTarget(name: string): string {
  return files.targetDir ? `${files.targetDir}/${name}` : name
}

async function newFile(): Promise<void> {
  closeMenu()
  await newFileInteractive()
}

async function newFolder(): Promise<void> {
  closeMenu()
  const name = prompt(t('files.newFolderPrompt'))?.trim()
  if (!name) return
  const path = inTarget(name)
  await fs.mkdir(path)
  await files.refreshTree()
  files.select(path, true)
}

function pickImport(): void {
  closeMenu()
  fileInput.value?.click()
}
async function onImport(e: Event): Promise<void> {
  const el = e.target as HTMLInputElement
  const list = el.files ? Array.from(el.files) : []
  el.value = ''
  if (!list.length) return
  const written: string[] = []
  for (const f of list) written.push(await importFileInto(f, files.targetDir))
  files.noteCaptured(written)
  await files.refreshTree()
  refreshGitStatus()
}

/** Build a PDF/EPUB/MD index for every indexable file under `dir` ('' = root). */
async function indexDocs(dir: string): Promise<void> {
  closeMenu()
  const prefix = dir ? `${dir}/` : ''
  const docs = files.allFiles.filter((p) => p.startsWith(prefix) && indexableKind(p))
  if (!docs.length) return
  for (let i = 0; i < docs.length; i++) {
    indexStatus.value = t('files.indexingN', { i: i + 1, total: docs.length })
    try {
      // Asked per document, not once for the batch: each one is a different
      // set of citations at stake, and only the documents actually at risk
      // interrupt anything (lib/renumber).
      const warning = await checkRenumber(docs[i])
      if (warning && !confirmRenumber(warning)) continue
      await indexDocument(docs[i])
    } catch (err) {
      console.error('index failed', docs[i], err)
    }
  }
  indexStatus.value = ''
  await files.refreshTree()
  await useKbIndexStore().refresh()
}

/** (Re)build the AI index for a single pdf/epub/md file. */
async function indexFile(path: string): Promise<void> {
  closeMenu()
  indexStatus.value = t('files.indexing')
  try {
    const warning = await checkRenumber(path)
    if (warning && !confirmRenumber(warning)) {
      indexStatus.value = ''
      return
    }
    await indexDocument(path)
  } catch (err) {
    console.error('index failed', path, err)
  }
  indexStatus.value = ''
  await useKbIndexStore().refresh()
}

/* ── open / rename / move / delete / copy / hand to the agent ───────────── */
function menuOpen(node: TreeNode): void {
  closeMenu()
  files.select(node.path, node.kind === 'dir')
  if (node.kind === 'dir') {
    if (!files.expandedDirs.has(node.path)) files.toggleDir(node.path)
  } else void files.openFile(node.path)
}

/** Rename is the one action that stays single: N files cannot share a name,
 *  and the lead is the row the user right-clicked. */
async function menuRename(row: SelectedRow): Promise<void> {
  closeMenu()
  const name = row.path.slice(row.path.lastIndexOf('/') + 1)
  const next = prompt(t('files.renamePrompt'), name)?.trim()
  if (!next || next === name) return
  const i = row.path.lastIndexOf('/')
  const newPath = i < 0 ? next : `${row.path.slice(0, i)}/${next}`
  await files.renameEntry(row.path, newPath, row.isDir)
  refreshGitStatus()
}

async function menuMove(): Promise<void> {
  closeMenu()
  await moveInteractive(picked.value)
}

async function menuDelete(): Promise<void> {
  closeMenu()
  await deleteRows(picked.value)
}

/**
 * Hand the selection to the agent as `@path` tokens.
 *
 * A draft, not a message: the composer is where the user says what they
 * actually want done with these files, and sending anything on their behalf
 * from a context menu would be this app answering its own question. `@path` is
 * the token the composer already speaks (lib/mentions), so this adds no second
 * way to refer to a file.
 */
function menuAddToChat(): void {
  closeMenu()
  const rows = picked.value
  if (!rows.length) return
  ui.agentOpen = true
  ui.pendingPrompt = rows.map((r) => `@${r.path}`).join(' ')
}

async function menuCopyPath(relative: boolean): Promise<void> {
  closeMenu()
  const prefix = relative ? '' : `${kb.name ?? ''}/`
  const text = picked.value.map((r) => `${prefix}${r.path}`).join('\n')
  try {
    await navigator.clipboard.writeText(text)
  } catch (err) {
    console.error('clipboard write failed', err)
  }
}

/**
 * The two keys the menu has always advertised, and until now did not have.
 *
 * Bound to the tree rather than the window: rows are buttons, so after a click
 * the focus is inside here and the event bubbles to this handler — which also
 * means Backspace keeps meaning "delete a character" everywhere else in the
 * app, with no global listener to guess at.
 */
function onKeydown(e: KeyboardEvent): void {
  const el = e.target as HTMLElement | null
  if (el?.isContentEditable || el?.closest('input, textarea')) return
  if (!picked.value.length) return
  if (e.key === 'F2') {
    const lead = picked.value.at(-1)
    if (lead) {
      e.preventDefault()
      void menuRename(lead)
    }
    return
  }
  if (e.key === 'Backspace' || e.key === 'Delete') {
    e.preventDefault()
    void menuDelete()
  }
}
</script>

<template>
  <div
    ref="rootEl"
    class="pb-2"
    @click.self="files.clearSelection()"
    @keydown="onKeydown"
    @dragover.self="onRootDragOver"
    @drop.self="onRootDrop"
  >
    <!-- The tree scrolls inside the sidebar's panel-scroll container; the
         heading + actions row stays pinned to its top edge (opaque bg so rows
         slide underneath). -->
    <div class="sticky top-0 z-10 flex items-center px-3 pt-2 pb-1 bg-bg-1">
      <button
        class="flex items-center gap-1 text-xs uppercase tracking-wide text-fg-3 hover:text-fg-1 flex-1 min-w-0"
        @click="expanded = !expanded"
      >
        <span
          class="codicon codicon-sm shrink-0"
          :class="expanded ? 'codicon-chevron-down' : 'codicon-chevron-right'"
        />
        <span class="truncate">{{ indexStatus || $t('files.heading') }}</span>
      </button>
      <button class="text-fg-3 hover:text-fg-1 ml-2" :title="$t('files.newFile')" @click="newFile">
        <span class="codicon codicon-sm codicon-new-file" />
      </button>
      <button class="text-fg-3 hover:text-fg-1 ml-2" :title="$t('files.newFolder')" @click="newFolder">
        <span class="codicon codicon-sm codicon-new-folder" />
      </button>
      <button class="text-fg-3 hover:text-fg-1 ml-2" :title="$t('files.importFiles')" @click="pickImport">
        <span class="codicon codicon-sm codicon-desktop-download" />
      </button>
      <button
        class="text-fg-3 hover:text-fg-1 ml-2"
        :title="$t('files.collapseAll')"
        @click="files.collapseAll()"
      >
        <span class="codicon codicon-sm codicon-collapse-all" />
      </button>
      <button
        class="text-fg-3 hover:text-fg-1 ml-2"
        :title="$t('files.refresh')"
        @click="() => files.refreshTree()"
      >
        <span class="codicon codicon-sm codicon-refresh" />
      </button>
    </div>
    <template v-if="expanded">
      <FileTreeNode v-for="node in files.tree" :key="node.path" :node="node" :depth="0" />
      <div v-if="!files.tree.length" class="px-3 py-2 text-xs text-fg-3">{{ $t('files.emptyFolder') }}</div>
    </template>
    <input ref="fileInput" type="file" multiple class="hidden" @change="onImport" />

    <!-- Right-click context menu. Everything below the first block acts on the
         SELECTION, which the right-click has already made the clicked row part
         of; only the top block — new file, index, open, rename — is about the
         one row, and it stands down as soon as there is more than one. -->
    <template v-if="ctx">
      <div class="fixed inset-0 z-40" @click="closeMenu" @contextmenu.prevent="closeMenu" />
      <div
        class="fixed z-50 min-w-[190px] rounded-md border border-border bg-bg-1 shadow-lg py-1 text-sm"
        :style="menuStyle"
      >
        <template v-if="picked.length > 1">
          <!-- Says what the menu is about to act on. Four highlighted rows and
               a menu that could mean any of them is the one thing a batch
               action must not be ambiguous about. -->
          <div class="px-3 py-1.5 text-xs text-fg-3">
            {{ $t('files.menu.selected', { n: picked.length }) }}
          </div>
          <div :class="ctxSep" />
        </template>
        <template v-else-if="ctx.node.kind === 'dir'">
          <button :class="ctxItem" @click="newFile">
            <span class="codicon codicon-sm codicon-new-file" />{{ $t('files.menu.newFile') }}
          </button>
          <button :class="ctxItem" @click="newFolder">
            <span class="codicon codicon-sm codicon-new-folder" />{{ $t('files.menu.newFolder') }}
          </button>
          <button :class="ctxItem" @click="pickImport">
            <span class="codicon codicon-sm codicon-cloud-upload" />{{ $t('files.menu.importFiles') }}
          </button>
          <button :class="ctxItem" @click="indexDocs(ctx.node.path)">
            <span class="codicon codicon-sm codicon-book" />{{ $t('files.menu.indexDocs') }}
          </button>
          <div :class="ctxSep" />
        </template>
        <template v-else>
          <button :class="ctxItem" @click="menuOpen(ctx.node)">
            <span class="codicon codicon-sm codicon-go-to-file" />{{ $t('files.menu.open') }}
          </button>
          <button
            v-if="indexableKind(ctx.node.path)"
            :class="ctxItem"
            @click="indexFile(ctx.node.path)"
          >
            <span class="codicon codicon-sm codicon-book" />{{ $t('files.menu.indexForAi') }}
          </button>
          <div :class="ctxSep" />
        </template>

        <button :class="ctxItem" @click="menuAddToChat">
          <span class="codicon codicon-sm codicon-comment-discussion" />{{
            $t('files.menu.addToChat')
          }}
        </button>
        <div :class="ctxSep" />
        <!-- Rename stays single: N files cannot share a name. -->
        <button v-if="picked.length === 1" :class="ctxItem" @click="menuRename(picked[0]!)">
          <span class="codicon codicon-sm codicon-edit" />{{ $t('files.menu.rename') }}
          <span class="ml-auto text-fg-3 text-xs">F2</span>
        </button>
        <button :class="ctxItem" @click="menuMove">
          <span class="codicon codicon-sm codicon-arrow-right" />{{ $t('files.menu.moveTo') }}
        </button>
        <button :class="ctxItem" @click="menuDelete">
          <span class="codicon codicon-sm codicon-trash text-removed" />
          <span class="text-removed">{{
            picked.length > 1
              ? $t('files.menu.deleteN', { n: picked.length })
              : $t('files.menu.delete')
          }}</span>
          <span class="ml-auto text-fg-3 text-xs">⌫</span>
        </button>
        <div :class="ctxSep" />
        <button :class="ctxItem" @click="menuCopyPath(false)">
          <span class="codicon codicon-sm codicon-link" />{{
            picked.length > 1 ? $t('files.menu.copyPaths') : $t('files.menu.copyPath')
          }}
        </button>
        <button :class="ctxItem" @click="menuCopyPath(true)">
          <span class="codicon codicon-sm codicon-link" />{{
            picked.length > 1
              ? $t('files.menu.copyRelativePaths')
              : $t('files.menu.copyRelativePath')
          }}
        </button>
      </div>
    </template>
  </div>
</template>
