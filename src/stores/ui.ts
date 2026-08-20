import { defineStore } from 'pinia'
import { computed, ref, watch } from 'vue'
import { isE2eMode } from '@/lib/e2e'

const AGENT_WIDTH_KEY = 'browser-md:agentWidth'
const DEFAULT_AGENT_WIDTH = 384 // matches the old w-96
const SIDEBAR_WIDTH_KEY = 'browser-md:sidebarWidth'
const DEFAULT_SIDEBAR_WIDTH = 256 // matches the old w-64

/**
 * The width below which the workspace cannot hold its three columns at once.
 * The activity bar (48) plus both default panel widths (256 + 384) is 688px of
 * chrome before the document is given a pixel — and the document is the column
 * that gives, being the only `flex-1 min-w-0` of the three. On a phone it gave
 * all the way to zero, so the demo opened onto nothing at all.
 *
 * Above this the layout is untouched. Below it the panels start closed, so the
 * document gets the width instead, and each panel is clamped on screen so it
 * can always be closed again.
 */
export const NARROW_PX = 860
const ACTIVITY_BAR_PX = 48
/** How much of the document a narrow-screen drawer leaves showing. The strip is
 *  not decoration: tapping outside is how a drawer is dismissed, so there has to
 *  be an outside to tap. */
const DRAWER_PEEK_PX = 56

function persistedWidth(key: string, fallback: number): number {
  const stored = isE2eMode() ? 0 : Number(localStorage.getItem(key))
  return stored > 0 ? stored : fallback
}

export const useUiStore = defineStore('ui', () => {
  /** The wikilink graph, shown as a full-screen overlay above the editor
   *  (which stays mounted — closing the graph never reloads a PDF). */
  const graphOpen = ref(false)

  /** Viewport width, kept live so the layout can react to a rotation or a
   *  resized window. One listener for the whole app; everything narrow-aware
   *  reads it from here rather than each growing its own. */
  const viewportWidth = ref(typeof window === 'undefined' ? NARROW_PX : window.innerWidth)
  if (typeof window !== 'undefined') {
    window.addEventListener('resize', () => (viewportWidth.value = window.innerWidth))
  }
  const isNarrow = computed(() => viewportWidth.value < NARROW_PX)

  /** Both panels start open — unless there is no room for them beside the
   *  document, in which case the document wins. Neither flag is persisted, so
   *  this only ever decides the first paint: the toggles behave the same
   *  afterwards, at any width. */
  const sidebarOpen = ref(!isNarrow.value)
  const agentOpen = ref(!isNarrow.value)
  /** Agent panel maximized to fill the whole window (not native fullscreen —
   *  just an overlay covering the app). Transient; not persisted. */
  const agentMaximized = ref(false)
  /**
   * Reading with nothing else on screen: the activity bar, the file tree, the
   * editor tabs and the agent panel all step out, and the reader's own toolbar
   * fades until the cursor goes looking for it. A mode you enter for a chapter
   * and leave, so it is transient — a KB that reopened with its chrome missing
   * would read as a broken app rather than a remembered preference.
   */
  const zen = ref(false)
  /**
   * The cursor has gone looking for the controls: in zen the reader's toolbar
   * and the way out are drawn only while this is true. Set on entering too, so
   * the way out is on screen for as long as it takes to move the mouse — a
   * mode with no visible exit is a trap, however well documented.
   */
  const zenPeek = ref(false)

  function toggleZen(): void {
    zen.value = !zen.value
    zenPeek.value = zen.value
  }

  /** The narrow-screen bar along the bottom. Its state lives here because it is
   *  not private to that component: it occupies the bottom strip of the window,
   *  which the floating agent button has to step over — and which is also where
   *  a drawer's own controls sit, so it stands down while one is out rather than
   *  covering the thing you just opened. It returns when the drawer does away. */
  const narrowNoticeDismissed = ref(false)
  const narrowNoticeOpen = computed(
    () =>
      isNarrow.value &&
      !narrowNoticeDismissed.value &&
      !zen.value &&
      !sidebarOpen.value &&
      !agentOpen.value,
  )
  /** How tall that bar currently is, reported by the bar itself. Measured rather
   *  than assumed: its text wraps to a different number of lines at 320px than
   *  at 430, and a hard-coded offset that clears it on one phone hides the
   *  floating agent button behind it on another. */
  const narrowNoticeHeight = ref(0)
  /**
   * Whether the EPUB reader's table of contents panel is open.
   *
   * It lives here rather than in the reader because the reader does not live
   * long enough to hold it: `EpubViewer` is mounted with `v-else-if`, so
   * looking at any other file destroys the component and coming back builds a
   * new one with a fresh `ref(false)`. Reading position already survived that
   * trip through `lib/viewMemory`; an open panel is not a position, it is one
   * of this app's panel flags, and they all live here.
   *
   * Deliberately one flag for the reader rather than one per book: it says how
   * you like to read, not where you are in a particular book.
   */
  const epubTocOpen = ref(false)

  const searchOpen = ref(false)
  const healthOpen = ref(false)
  const settingsOpen = ref(false)
  /** The paid-tier explainer. Lives here rather than in the start screen so the
   *  Licence pane can open it too — someone who already has a folder open never
   *  sees the start screen, and they are exactly who would go looking. */
  const pricingOpen = ref(false)
  /** Show the editor tab bar. When hidden, files open via the Open Files list. */
  const editorTabsVisible = ref(true)

  /** Text handed to the chat composer from elsewhere in the app — Settings →
   *  Tools uses it to turn "I need a tool that…" into a message the user can
   *  edit and send. The composer consumes it and clears it, so it is a one-shot
   *  handoff rather than shared state. */
  const pendingPrompt = ref('')

  /** Which Settings pane to land on when the modal is opened from elsewhere —
   *  sending someone to "Settings" and letting them hunt for the right pane is
   *  most of the reason setup feels hard. One-shot, like pendingPrompt. */
  const settingsSection = ref<string | null>(null)

  /** Open Settings on a specific pane. */
  function openSettings(section?: string): void {
    if (section) settingsSection.value = section
    settingsOpen.value = true
  }

  /** The Help panel, and which topic it lands on — null shows the contents.
   *  Settings links into it by topic, so "where is this explained?" is one
   *  click rather than a hunt through a manual. */
  const helpOpen = ref(false)
  const helpTopic = ref<string | null>(null)

  function openHelp(topic?: string): void {
    helpTopic.value = topic ?? null
    helpOpen.value = true
  }

  /** Widths (px) of the resizable panels, persisted per browser. */
  const agentWidth = ref(persistedWidth(AGENT_WIDTH_KEY, DEFAULT_AGENT_WIDTH))
  const sidebarWidth = ref(persistedWidth(SIDEBAR_WIDTH_KEY, DEFAULT_SIDEBAR_WIDTH))
  watch(agentWidth, (w) => {
    if (!isE2eMode()) localStorage.setItem(AGENT_WIDTH_KEY, String(Math.round(w)))
  })
  watch(sidebarWidth, (w) => {
    if (!isE2eMode()) localStorage.setItem(SIDEBAR_WIDTH_KEY, String(Math.round(w)))
  })

  /**
   * What each panel is actually drawn at. The stored width above is the user's
   * preference and is never overwritten here — a window dragged narrow and back
   * again restores it — but on a narrow screen the panels are drawers laid over
   * the document, and a drawer that reaches the far edge has no outside left to
   * tap. So the drawn width is capped to leave the activity bar and a strip of
   * the document showing. On any normal window this is the stored width
   * unchanged.
   */
  const maxPanelWidth = computed(() =>
    isNarrow.value
      ? viewportWidth.value - ACTIVITY_BAR_PX - DRAWER_PEEK_PX
      : viewportWidth.value - ACTIVITY_BAR_PX,
  )
  const shownAgentWidth = computed(() => Math.min(agentWidth.value, maxPanelWidth.value))
  const shownSidebarWidth = computed(() => Math.min(sidebarWidth.value, maxPanelWidth.value))

  /** On a narrow screen the two drawers occupy the same space, so opening one
   *  puts the other away. Guarded on `isNarrow`, so a desktop keeps both. */
  watch(sidebarOpen, (open) => {
    if (open && isNarrow.value) agentOpen.value = false
  })
  watch(agentOpen, (open) => {
    if (open && isNarrow.value) sidebarOpen.value = false
  })

  /** Tapping the document beside a drawer closes it — the drawer's own dismiss. */
  function closeDrawers(): void {
    sidebarOpen.value = false
    agentOpen.value = false
  }

  return {
    graphOpen,
    viewportWidth,
    isNarrow,
    narrowNoticeDismissed,
    narrowNoticeOpen,
    narrowNoticeHeight,
    sidebarOpen,
    agentOpen,
    shownAgentWidth,
    shownSidebarWidth,
    closeDrawers,
    agentMaximized,
    zen,
    zenPeek,
    toggleZen,
    searchOpen,
    epubTocOpen,
    healthOpen,
    settingsOpen,
    pricingOpen,
    editorTabsVisible,
    pendingPrompt,
    settingsSection,
    openSettings,
    helpOpen,
    helpTopic,
    openHelp,
    agentWidth,
    sidebarWidth,
  }
})
