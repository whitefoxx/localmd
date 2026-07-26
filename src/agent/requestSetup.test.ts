/**
 * request_setup — the agent asking the app to collect something. The property
 * that matters: a key reaches settings without ever appearing in what the
 * model is told.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useSetupStore } from '@/stores/setup'
import { useSettingsStore } from '@/stores/settings'
import { useToolsStore } from '@/stores/tools'
import { TOOLS, type ToolCtx } from './tools'

globalThis.localStorage ??= {
  getItem: () => null,
  setItem: () => {},
} as unknown as Storage

const ctx: ToolCtx = { sessionId: 's1' }
const spec = TOOLS.find((t) => t.name === 'request_setup')!
const ask = (args: Record<string, unknown>): Promise<string> => spec.run(args, ctx)

/** Wait for the card to appear, then act on it as the user would. */
async function onCard(fn: (id: string) => void): Promise<void> {
  const setup = useSetupStore()
  for (let i = 0; i < 100 && !setup.pendingFor('s1'); i++) {
    await new Promise((r) => setTimeout(r, 0))
  }
  const req = setup.pendingFor('s1')
  if (req) fn(req.id)
}

beforeEach(() => {
  setActivePinia(createPinia())
})

describe('key requests', () => {
  it('stores the value and tells the model only that one arrived', async () => {
    const run = ask({ kind: 'key', label: 'WeRead API Key', secret_id: 'weread_api_key' })
    await onCard(() => {
      // What SetupCard does on Save.
      useToolsStore().setSecret('weread_api_key', 'wrk-super-secret')
      useSetupStore().settle(useSetupStore().pendingFor('s1')!.id, 'provided')
    })
    const out = await run

    expect(useSettingsStore().state.toolSecrets.weread_api_key).toBe('wrk-super-secret')
    expect(out).not.toContain('wrk-super-secret')
    expect(out).toMatch(/cannot read it/)
  })

  it('refuses a key request with no id to store it under', async () => {
    expect(await ask({ kind: 'key', label: 'Some key' })).toMatch(/needs secret_id/)
  })

  it('tells the model not to loop when the user skips', async () => {
    const run = ask({ kind: 'key', label: 'K', secret_id: 'k' })
    await onCard((id) => useSetupStore().settle(id, 'skipped'))
    expect(await run).toMatch(/Do not ask again in a loop/)
  })
})

describe('other kinds', () => {
  it('reports a connected extension', async () => {
    const run = ask({ kind: 'extension', label: 'WebCLI', entry_id: 'webcli' })
    await onCard((id) => useSetupStore().settle(id, 'connected'))
    expect(await run).toMatch(/connected/)
  })

  it('returns the chosen option', async () => {
    const run = ask({ kind: 'choice', label: 'Which endpoint?', options: ['a', 'b'] })
    await onCard((id) => useSetupStore().settle(id, 'chose:b'))
    expect(await run).toBe('The user chose: b')
  })

  it('refuses a choice with nothing to choose from', async () => {
    expect(await ask({ kind: 'choice', label: 'Pick' })).toMatch(/needs options/)
  })
})

describe('setup store lifecycle', () => {
  it('supersedes an earlier request rather than stacking cards', async () => {
    const setup = useSetupStore()
    const first = setup.ask({ id: 'a', sessionId: 's1', kind: 'key', label: 'A', secretId: 'a' })
    const second = setup.ask({ id: 'b', sessionId: 's1', kind: 'key', label: 'B', secretId: 'b' })
    expect(await first).toBe('skipped')
    expect(setup.pending).toHaveLength(1)
    setup.settle('b', 'provided')
    expect(await second).toBe('provided')
    expect(setup.pending).toHaveLength(0)
  })

  it('releases a waiting request when its turn ends', async () => {
    const setup = useSetupStore()
    const p = setup.ask({ id: 'x', sessionId: 's1', kind: 'key', label: 'X', secretId: 'x' })
    setup.clearSession('s1')
    expect(await p).toBe('skipped')
    expect(setup.pending).toHaveLength(0)
  })

  it('keeps sessions independent', () => {
    const setup = useSetupStore()
    void setup.ask({ id: 'a', sessionId: 's1', kind: 'key', label: 'A', secretId: 'a' })
    void setup.ask({ id: 'b', sessionId: 's2', kind: 'key', label: 'B', secretId: 'b' })
    expect(setup.pendingFor('s1')?.id).toBe('a')
    expect(setup.pendingFor('s2')?.id).toBe('b')
  })
})
