/**
 * Demo bootstrap (`?demo`): seed the in-memory demo KB, open it, and land the
 * visitor on the note that pays off — one with live citations into a PDF that
 * is really here. See `lib/demo.ts` for why it is memory-backed.
 *
 * Nothing here configures a model. The first thing a visitor should experience
 * costs no tokens and cannot fail: click a citation, land on the paragraph.
 */
import { seedDemoKb, loadDemoManifest } from '@/lib/demo'
import { useKbStore } from '@/stores/kb'
import { useFilesStore } from '@/stores/files'

export async function bootstrapDemo(): Promise<void> {
  const manifest = await loadDemoManifest()
  const root = await seedDemoKb(manifest)

  const kb = useKbStore()
  if (!(await kb.openHandle(root, { ephemeral: true }))) return

  // Same post-open sequence OpenKbScreen runs — opening a handle does not by
  // itself populate the tree, and everything derived from it (search,
  // backlinks, the graph, the health check) reads the tree, not the disk.
  const files = useFilesStore()
  await files.refreshTree()
  // Deliberately NOT restoreTabs(): those are the visitor's own tabs, whose
  // paths do not exist in here. The demo opens exactly one note, on purpose.
  if (manifest.open) await files.openFile(manifest.open)
}
