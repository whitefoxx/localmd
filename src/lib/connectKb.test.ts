/**
 * Which knowledge base the browser thinks is open, and what happens when its
 * popup asks for another one.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'

import { kbSnapshot, openKbByName, syncKbFolders, SYNC_KB_TOOL } from '@/lib/connectKb'
import { useKbStore } from '@/stores/kb'

describe('kbSnapshot', () => {
  it('lists the recents in order and names the open one', () => {
    expect(kbSnapshot([{ name: 'trace' }, { name: 'notes' }], 'notes')).toEqual({
      folders: ['trace', 'notes'],
      current: 'notes',
    })
  })

  it('offers a folder opened before its recents row landed', () => {
    expect(kbSnapshot([{ name: 'trace' }], 'fresh').folders).toEqual(['fresh', 'trace'])
  })

  it('says plainly that nothing is open', () => {
    expect(kbSnapshot([{ name: 'trace' }], '')).toEqual({ folders: ['trace'], current: '' })
  })
})

describe('syncKbFolders', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it('sends the list and the open folder as the tool wants them', async () => {
    const kb = useKbStore()
    kb.name = 'trace'
    kb.recents = [{ name: 'trace', lastOpened: 2 }, { name: 'notes', lastOpened: 1 }] as never
    const calls: Array<{ tool: string; args: Record<string, unknown> }> = []
    await syncKbFolders({
      serverId: 'connect',
      call: async (tool, args) => {
        calls.push({ tool, args })
        return '{}'
      },
    })
    expect(calls[0].tool).toBe(SYNC_KB_TOOL)
    expect(JSON.parse(String(calls[0].args.folders))).toEqual(['trace', 'notes'])
    expect(calls[0].args.current).toBe('trace')
  })
})

describe('openKbByName', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it('opens a folder the user picked in the popup', async () => {
    const kb = useKbStore()
    kb.recents = [{ name: 'notes', lastOpened: 1 }] as never
    const open = vi.spyOn(kb, 'openRecent').mockResolvedValue(true)
    expect(await openKbByName('notes')).toBe('opened')
    expect(open).toHaveBeenCalled()
  })

  it('does nothing when it is already the open one', async () => {
    const kb = useKbStore()
    kb.name = 'notes'
    kb.recents = [{ name: 'notes', lastOpened: 1 }] as never
    const open = vi.spyOn(kb, 'openRecent')
    expect(await openKbByName('notes')).toBe('already')
    expect(open).not.toHaveBeenCalled()
  })

  it('reports a name it does not have rather than guessing at one', async () => {
    useKbStore().recents = [{ name: 'notes', lastOpened: 1 }] as never
    expect(await openKbByName('gone')).toBe('unknown')
    expect(await openKbByName('')).toBe('unknown')
  })

  it('reports a folder that would not open — a lapsed grant needs a gesture', async () => {
    const kb = useKbStore()
    kb.recents = [{ name: 'notes', lastOpened: 1 }] as never
    vi.spyOn(kb, 'openRecent').mockResolvedValue(false)
    expect(await openKbByName('notes')).toBe('failed')
  })
})
