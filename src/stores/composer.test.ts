import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { nextTick } from 'vue'
import { useComposerStore } from './composer'
import { useChatStore } from './chat'
import { useKbStore } from './kb'
import type { TabRef } from '@/lib/connectTabs'

// Opening a KB makes the chat store go looking for its saved sessions, and
// there is no IndexedDB here. Nothing in these tests is about persistence.
vi.mock('@/lib/idb', () => ({
  listSessions: async () => [],
  saveSession: async () => {},
  deleteSession: async () => {},
  listRecents: async () => [],
  saveRecent: async () => {},
  removeRecent: async () => {},
}))

const tab = (tabId: number, title = `Tab ${tabId}`): TabRef => ({
  tabId,
  title,
  url: `https://example.com/${tabId}`,
  serverId: 'connect',
})

/** Put a conversation on screen, the way switching chat tabs does. `null` is
 *  the state before the first message, where no session exists yet. */
async function openSession(id: string | null): Promise<void> {
  const chat = useChatStore()
  const tabs = chat.tabs as unknown as Array<{ id: string }>
  if (id === null) tabs.length = 0
  else {
    if (!tabs.some((t) => t.id === id)) tabs.push({ id } as never)
    chat.activateTab(id)
  }
  await nextTick()
}

describe('composer — attached browser tabs', () => {
  beforeEach(async () => {
    setActivePinia(createPinia())
    useKbStore().name = 'kb'
    await nextTick()
  })

  it('stages several tabs, and lets one go on the ✕', async () => {
    const composer = useComposerStore()
    await openSession('s1')
    composer.attachTab(tab(1))
    composer.attachTab(tab(2))

    expect(composer.tabs.map((t) => t.tabId)).toEqual([1, 2])
    composer.detachTab(1)
    expect(composer.tabs.map((t) => t.tabId)).toEqual([2])
  })

  // A chip left above an empty box would claim the NEXT message is about that
  // page too — a claim the user never made. The address is not lost with it:
  // it went out inside the message and stays in the wire history.
  it('lets the staged tabs go with the message that carried them', async () => {
    const composer = useComposerStore()
    await openSession('s1')
    composer.attachTab(tab(1))
    composer.attachTab(tab(2))

    composer.clearTabs()
    expect(composer.tabs).toEqual([])
  })

  it('re-attaching a tab updates it in place instead of doubling it', async () => {
    const composer = useComposerStore()
    await openSession('s1')
    composer.attachTab(tab(1, 'Before'))
    composer.attachTab(tab(1, 'After navigating'))

    expect(composer.tabs).toHaveLength(1)
    expect(composer.tabs[0].title).toBe('After navigating')
  })

  it('gives each conversation its own tabs, and remembers them on the way back', async () => {
    const composer = useComposerStore()
    await openSession('s1')
    composer.attachTab(tab(1))

    await openSession('s2')
    expect(composer.tabs).toEqual([])
    composer.attachTab(tab(9))
    expect(composer.tabs.map((t) => t.tabId)).toEqual([9])

    await openSession('s1')
    expect(composer.tabs.map((t) => t.tabId)).toEqual([1])
  })

  it('carries tabs picked before the first message into the session it starts', async () => {
    const composer = useComposerStore()
    await openSession(null) // no conversation yet — the usual way to begin
    composer.attachTab(tab(1))
    expect(composer.tabs.map((t) => t.tabId)).toEqual([1])

    // Sending is what creates the session; the tabs must come along.
    await openSession('new-session')
    expect(composer.tabs.map((t) => t.tabId)).toEqual([1])
  })

  it('forgets everything when another KB is opened', async () => {
    const composer = useComposerStore()
    await openSession('s1')
    composer.attachTab(tab(1))

    useKbStore().name = 'other-kb'
    await nextTick()
    expect(composer.tabs).toEqual([])
  })
})
