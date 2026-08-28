/**
 * read_session — the agent reading past conversations. Chats live in the
 * browser's storage, not the KB folder, so this is the one tool whose
 * "filesystem" is the chat store: the listing overlays live tabs on stored
 * snapshots, a read renders the active branch only, and another KB's
 * sessions stay out of reach.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useKbStore } from '@/stores/kb'
import { useChatStore, type UiMessage } from '@/stores/chat'
import type { StoredSession } from '@/lib/idb'
import { TOOLS, type ToolCtx } from './tools'

// The settings store persists through a watcher; node has no localStorage.
globalThis.localStorage ??= {
  getItem: () => null,
  setItem: () => {},
} as unknown as Storage

/** In-memory stand-in for the IDB session store, reset per test. */
const db = vi.hoisted(() => ({ sessions: [] as unknown[] }))
type FakeSession = { id: string; kb: string; updatedAt: number }
vi.mock('@/lib/idb', () => ({
  saveSession: async (s: FakeSession) => {
    db.sessions = [...db.sessions.filter((x) => (x as FakeSession).id !== s.id), s]
  },
  getSession: async (id: string) =>
    db.sessions.find((s) => (s as FakeSession).id === id) ?? null,
  listSessions: async (kb: string) =>
    db.sessions
      .filter((s) => (s as FakeSession).kb === kb)
      .sort((a, b) => (b as FakeSession).updatedAt - (a as FakeSession).updatedAt),
  deleteSession: async (id: string) => {
    db.sessions = db.sessions.filter((s) => (s as FakeSession).id !== id)
  },
  listRecents: async () => [],
  saveRecent: async () => {},
  removeRecent: async () => {},
}))

const ctx: ToolCtx = { sessionId: 'cur' }
const readSession = (args: Record<string, unknown> = {}): Promise<string> =>
  TOOLS.find((t) => t.name === 'read_session')!.run(args, ctx)

const msg = (
  id: number,
  role: 'user' | 'assistant',
  text: string,
  parentId?: number | null,
): UiMessage =>
  ({
    id,
    ...(parentId !== undefined ? { parentId } : {}),
    role,
    parts: [{ type: 'text', text }],
  }) as UiMessage

function session(over: Partial<StoredSession> & { id: string }): StoredSession {
  return {
    kb: 'kb1',
    title: over.id,
    provider: 'sdk',
    uiMessages: [],
    anthropicHistory: [],
    openaiHistory: [],
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_000_000,
    ...over,
  } as StoredSession
}

/** Spin the timer queue until `cond` holds (the store's KB watcher settling). */
async function until(cond: () => boolean): Promise<void> {
  for (let i = 0; i < 100 && !cond(); i++) await new Promise((r) => setTimeout(r, 0))
}

beforeEach(async () => {
  setActivePinia(createPinia())
  db.sessions = [
    // The current conversation: a tree with one abandoned branch. The user
    // re-asked t1 as t3; the transcript is t3 → t4, and t2 must not leak.
    {
      ...session({ id: 'cur', title: 'launch plan', updatedAt: 1_700_000_300_000 }),
      uiMessages: [
        msg(1, 'user', 'first question', null),
        msg(2, 'assistant', 'answer one', 1),
        msg(3, 'user', 'second question', null),
        msg(4, 'assistant', 'answer two', 3),
      ],
      leafId: 4,
    },
    // A session persisted before branching existed: flat list, no leafId.
    {
      ...session({ id: 'old', title: 'pdf chat', updatedAt: 1_700_000_100_000 }),
      uiMessages: [msg(1, 'user', 'ask about pdf'), msg(2, 'assistant', 'pdf answer')],
      favorite: true,
    },
    // Another KB's conversation — not this agent's to read.
    {
      ...session({ id: 'foreign', kb: 'kb2', updatedAt: 1_700_000_200_000 }),
      uiMessages: [msg(1, 'user', 'other kb secret')],
    },
  ]
  useKbStore().name = 'kb1'
  const chat = useChatStore()
  await until(() => chat.sessions.length === 2) // KB watcher settled
})

describe('read_session listing', () => {
  it("lists this KB's sessions newest first, marking the current one", async () => {
    const out = await readSession()
    const lines = out.split('\n')
    expect(lines[0]).toBe('2 sessions, newest first:')
    expect(lines[1]).toContain('"launch plan"')
    expect(lines[1]).toContain('id: cur')
    expect(lines[1]).toContain('← this conversation')
    // Two messages on the ACTIVE branch — four in the tree.
    expect(lines[1]).toContain('2 messages')
    expect(lines[2]).toContain('id: old')
    expect(lines[2]).toContain('★')
    expect(out).not.toContain('foreign')
  })

  it('says so when the KB has no sessions', async () => {
    db.sessions = []
    useKbStore().name = 'kb-empty'
    await until(() => useChatStore().sessions.length === 0)
    expect(await readSession()).toBe('No chat sessions in this knowledge base yet.')
  })
})

describe('read_session reading', () => {
  it('renders the active branch, not the abandoned one', async () => {
    const out = await readSession({ id: 'cur' })
    expect(out).toContain('second question')
    expect(out).toContain('answer two')
    expect(out).not.toContain('answer one')
  })

  it('renders a pre-branching flat session as-is', async () => {
    const out = await readSession({ id: 'old' })
    expect(out).toContain('ask about pdf')
    expect(out).toContain('pdf answer')
    expect(out).toContain('title: "pdf chat"')
  })

  it("refuses another KB's session, same as an unknown id", async () => {
    const foreign = await readSession({ id: 'foreign' })
    expect(foreign).toContain('Error: no session with id foreign')
    expect(foreign).not.toContain('other kb secret')
    expect(await readSession({ id: 'nope' })).toContain('Error: no session with id nope')
  })

  it('pages a long transcript with read_session offsets', async () => {
    db.sessions.push({
      ...session({ id: 'big', title: 'long one', updatedAt: 1_700_000_050_000 }),
      uiMessages: [msg(1, 'user', 'x'.repeat(120_000)), msg(2, 'assistant', 'the tail end')],
    })
    const first = await readSession({ id: 'big' })
    const m = first.match(/continue with read_session offset=(\d+)/)
    expect(m).not.toBeNull()
    expect(first).not.toContain('the tail end')
    const rest = await readSession({ id: 'big', offset: Number(m![1]) })
    expect(rest).toContain('the tail end')
    expect(rest).not.toContain('truncated at')
  })
})
