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
import { seedDemoKb, loadDemoManifest } from '@/lib/demo'
import { trialSession, trialProfile } from '@/lib/trial'
import { useKbStore } from '@/stores/kb'
import { useFilesStore } from '@/stores/files'
import { useSettingsStore } from '@/stores/settings'

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

  await lendTrialModel()
}

/**
 * Put a trial model in the primary slot, if the visitor has none of their own.
 *
 * Never overrides a configured primary: someone who already pasted their key
 * is not the person this is for, and quietly swapping their model for a capped
 * one — on their own knowledge base, at our choice of provider — would be a
 * small betrayal of the thing the app is about. Failure is silent by design;
 * the composer already explains what to do when no model is set.
 */
async function lendTrialModel(): Promise<void> {
  const settings = useSettingsStore()
  if (settings.state.slots.primary) return
  try {
    const profile = trialProfile(await trialSession())
    settings.state.profiles = [...settings.state.profiles, profile]
    settings.state.slots = { ...settings.state.slots, primary: profile.id }
  } catch {
    // Exhausted, unconfigured or unreachable — all the same to the visitor,
    // who still has a knowledge base they can read and click through.
  }
}
