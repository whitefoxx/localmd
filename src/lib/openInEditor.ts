/**
 * Showing a file to the user, wherever the request came from.
 *
 * The agent panel can fill the whole window, and while it does, the editor is
 * behind it. So "open this file" is two things everywhere in the app: open it,
 * and stop covering it. This lives here rather than in the chat panel because
 * every route to a file has the same obligation — a link in a reply, a hit in
 * the search palette, a citation chip — and a route that forgot it would open
 * files nobody can see.
 *
 * A file that is no longer there leaves the layout exactly as it was: dropping
 * out of the full-window view to reveal nothing is worse than the dead link,
 * because it looks like the app lost your place for no reason.
 */
import { useFilesStore } from '@/stores/files'
import { useUiStore } from '@/stores/ui'

/** Stop the agent panel covering the editor. No-op when it isn't. */
export function revealEditor(): void {
  const ui = useUiStore()
  if (ui.agentMaximized) ui.agentMaximized = false
}

/** Open a file and get out of its way — unless there was nothing to open. */
export async function openInEditor(path: string): Promise<void> {
  if (await useFilesStore().openFile(path)) revealEditor()
}
