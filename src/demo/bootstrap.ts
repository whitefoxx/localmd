/**
 * Demo bootstrap (`?demo`): seed the in-memory demo KB, open it, and land the
 * visitor on the note that pays off — one with live citations into a PDF that
 * is really here. See `lib/demo.ts` for why it is memory-backed.
 *
 * Order matters. The first thing a visitor experiences costs no tokens and
 * cannot fail: click a citation, land on the paragraph. Only then does this
 * try to borrow a trial model so they can also ask their own question — and if
 * that is exhausted, switched off, or unreachable, the demo is exactly as it
 * was a moment before. The payoff never depends on our being able to pay for
 * anything.
 */
import { watch } from 'vue'
import { seedDemoKb, loadDemoManifest } from '@/lib/demo'
import { lendTrialProfile } from '@/lib/trial'
import { useKbStore } from '@/stores/kb'
import { useFilesStore } from '@/stores/files'
import { useSettingsStore } from '@/stores/settings'
import { useKbIndexStore } from '@/stores/kbIndex'

/**
 * Enter the demo from anywhere in the app — the start screen, or a chat panel
 * with no model configured.
 *
 * Stamps the URL as well as opening the KB, because `?demo` is the door: a
 * reload lands back in the demo, and the address can be handed to someone.
 * Whatever was open is put away first — flushed, then dropped — since the demo
 * replaces the KB under the same stores, and a pending write must not land in
 * a folder the user has already left.
 */
export async function enterDemo(): Promise<void> {
  const url = new URL(location.href)
  url.searchParams.set('demo', '1')
  history.replaceState(null, '', url)
  const files = useFilesStore()
  await files.flush()
  files.reset()
  useKbIndexStore().reset()
  await bootstrapDemo()
}

export async function bootstrapDemo(): Promise<void> {
  const manifest = await loadDemoManifest()
  const root = await seedDemoKb(manifest)

  const kb = useKbStore()
  if (!(await kb.openHandle(root, { ephemeral: true, demo: true }))) return

  // Same post-open sequence OpenKbScreen runs — opening a handle does not by
  // itself populate the tree, and everything derived from it (search,
  // backlinks, the graph, the health check) reads the tree, not the disk.
  const files = useFilesStore()
  await files.refreshTree()
  // Deliberately NOT restoreTabs(): those are the visitor's own tabs, whose
  // paths do not exist in here. The demo opens exactly one note, on purpose.
  if (manifest.open) await files.openFile(manifest.open)

  guardAgainstLosingWork()
  await lendTrialModel()
}

/**
 * Warn before leaving, but only once there is something to lose, and only
 * while the thing to lose is still the demo.
 *
 * The demo's real hazard was never the agent writing files — nothing here
 * touches the disk. It is a visitor spending twenty minutes in a knowledge base
 * that evaporates when the tab closes. Warning on arrival would be noise, so
 * the handler is only attached after the first change: the file tree gaining or
 * losing something, or an editor buffer going dirty. Both are synchronous to
 * read at unload time, which `beforeunload` requires.
 *
 * Closing the tab is not the only way out, though: opening a folder replaces
 * the demo, and once that happens the warning is about a knowledge base that
 * no longer exists while what IS open is a folder on disk that outlives the
 * tab. So whether there is still anything to lose is decided at unload time —
 * also a synchronous read — rather than at the moment the handler goes on.
 */
function guardAgainstLosingWork(): void {
  const kb = useKbStore()
  const files = useFilesStore()
  const demoKb = kb.name
  const warn = (e: BeforeUnloadEvent) => {
    if (kb.name === demoKb) e.preventDefault()
  }
  const stop = watch(
    [() => files.tree.length, () => files.saveState],
    () => {
      window.addEventListener('beforeunload', warn)
      stop()
    },
  )
}

/**
 * Put a trial model in the primary slot, if the visitor has none of their own.
 *
 * Never overrides a configured primary: someone who already pasted their key
 * is not the person this is for, and quietly swapping their model for a capped
 * one — on their own knowledge base, at our choice of provider — would be a
 * small betrayal of the thing the app is about. Failure is silent by design;
 * the composer already explains what to do when no model is set.
 *
 * A trial that has nothing to lend is the same silence: the demo is still
 * worth reading and clicking through without a model behind it.
 */
async function lendTrialModel(): Promise<void> {
  const settings = useSettingsStore()
  if (settings.state.slots.primary) return
  try {
    const profile = await lendTrialProfile()
    settings.state.profiles = [...settings.state.profiles, profile]
    settings.state.slots = { ...settings.state.slots, primary: profile.id }
  } catch {
    // Exhausted, unconfigured or unreachable — all the same to the visitor,
    // who still has a knowledge base they can read and click through.
  }
}
