/**
 * The palette's command table.
 *
 * Every action the palette can run is a row here, not a branch in the palette:
 * adding "toggle the graph" is adding data. Rows name an existing store
 * mutation — the palette is a second way to reach what the toolbar already
 * does, never a place where behaviour lives.
 *
 * A row may point at a `HotkeyId`, which is how its key combo gets shown; the
 * binding itself stays in the hotkey registry (@/lib/hotkeys) so Settings and
 * the palette can never disagree about it.
 *
 * Labels are i18n keys resolved at render time, so the list follows the user's
 * language without being rebuilt.
 */
import { useUiStore } from '@/stores/ui'
import { useFilesStore } from '@/stores/files'
import { useChatStore } from '@/stores/chat'
import { useGitStore } from '@/stores/git'
import { useReviewStore } from '@/stores/review'
import { useThemeStore } from '@/stores/theme'
import type { HotkeyId } from '@/lib/hotkeys'

export interface Command {
  id: string
  /** i18n key, e.g. 'commands.graph'. */
  label: string
  /** Codicon name shown at the left of the row. */
  icon: string
  /** Show this command's key binding, taken from the hotkey registry. */
  hotkey?: HotkeyId
  /** Rows whose `when` is false are not offered — a Git command in a folder
   *  that is not a repository would only be a dead end. */
  when?: () => boolean
  run: () => void
}

export function useCommands(): Command[] {
  const ui = useUiStore()
  const files = useFilesStore()
  const chat = useChatStore()
  const git = useGitStore()
  const review = useReviewStore()
  const theme = useThemeStore()

  return [
    {
      id: 'agent',
      label: 'commands.agent',
      icon: 'codicon-comment-discussion',
      hotkey: 'agent',
      run: () => (ui.agentOpen = !ui.agentOpen),
    },
    {
      id: 'agentMaximize',
      label: 'commands.agentMaximize',
      icon: 'codicon-screen-full',
      hotkey: 'agentMaximize',
      // One store action either way (it also opens the panel and leaves zen —
      // see toggleAgentMaximized); two rows because a palette row has to say
      // which way it goes before you run it, and `when` keeps them exclusive.
      when: () => !ui.agentMaximized,
      run: () => ui.toggleAgentMaximized(),
    },
    {
      id: 'agentRestore',
      label: 'commands.agentRestore',
      icon: 'codicon-screen-normal',
      hotkey: 'agentMaximize',
      when: () => ui.agentMaximized,
      run: () => ui.toggleAgentMaximized(),
    },
    {
      id: 'newChat',
      label: 'commands.newChat',
      icon: 'codicon-add',
      run: () => {
        chat.newSession()
        ui.agentOpen = true
      },
    },
    {
      id: 'chatHistory',
      label: 'commands.chatHistory',
      icon: 'codicon-list-unordered',
      run: () => {
        ui.agentOpen = true
        chat.historyOpen = true
      },
    },
    {
      id: 'sidebar',
      label: 'commands.sidebar',
      icon: 'codicon-list-tree',
      hotkey: 'sidebar',
      run: () => (ui.sidebarOpen = !ui.sidebarOpen),
    },
    {
      id: 'zen',
      label: 'commands.zen',
      icon: 'codicon-screen-full',
      hotkey: 'zen',
      run: () => ui.toggleZen(),
    },
    {
      id: 'graph',
      label: 'commands.graph',
      icon: 'codicon-type-hierarchy-sub',
      run: () => (ui.graphOpen = !ui.graphOpen),
    },
    {
      id: 'health',
      label: 'commands.health',
      icon: 'codicon-pulse',
      run: () => (ui.healthOpen = true),
    },
    {
      id: 'git',
      label: 'commands.git',
      icon: 'codicon-source-control',
      when: () => git.isRepo,
      run: () => {
        git.panelOpen = true
        void git.refresh()
      },
    },
    {
      id: 'review',
      label: 'commands.review',
      icon: 'codicon-checklist',
      run: () => (review.panelOpen = true),
    },
    {
      id: 'tabPrev',
      label: 'commands.tabPrev',
      icon: 'codicon-arrow-left',
      hotkey: 'tabPrev',
      when: () => files.openTabs.length > 1,
      run: () => void files.cycleTab(-1),
    },
    {
      id: 'tabNext',
      label: 'commands.tabNext',
      icon: 'codicon-arrow-right',
      hotkey: 'tabNext',
      when: () => files.openTabs.length > 1,
      run: () => void files.cycleTab(1),
    },
    {
      id: 'closeAllTabs',
      label: 'commands.closeAllTabs',
      icon: 'codicon-close-all',
      when: () => files.openTabs.length > 0,
      run: () => void files.closeAllTabs(),
    },
    {
      id: 'theme',
      label: 'commands.theme',
      icon: 'codicon-color-mode',
      run: () => theme.cycle(),
    },
    {
      id: 'settings',
      label: 'commands.settings',
      icon: 'codicon-settings-gear',
      run: () => ui.openSettings(),
    },
    {
      id: 'help',
      label: 'commands.help',
      icon: 'codicon-question',
      run: () => ui.openHelp(),
    },
  ]
}
