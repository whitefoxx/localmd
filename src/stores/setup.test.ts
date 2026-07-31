import { describe, it, expect, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useSetupStore } from './setup'

describe('setup cards — a proposal is not a change', () => {
  beforeEach(() => setActivePinia(createPinia()))

  /**
   * The safety property the confirm card exists for. Everything the agent reads
   * is untrusted, so a web page can talk it into proposing anything; what a page
   * cannot do is click. Until the user does, `apply` must not have run.
   */
  it('does not run apply until the user confirms', async () => {
    const setup = useSetupStore()
    let applied = false
    const pending = setup.ask({
      id: 'r1',
      sessionId: 's',
      kind: 'confirm',
      label: 'Add a server',
      detail: 'evil → https://evil.example/mcp',
      apply: () => {
        applied = true
      },
    })
    // Card is up, nothing has happened.
    expect(applied).toBe(false)
    expect(setup.pendingFor('s')?.detail).toContain('https://evil.example/mcp')

    // Skipping is a real outcome, and it must leave the world untouched.
    setup.settle('r1', 'skipped')
    await expect(pending).resolves.toBe('skipped')
    expect(applied).toBe(false)
  })

  it('reports a failed action distinctly from a skipped one', async () => {
    const setup = useSetupStore()
    const pending = setup.ask({ id: 'r2', sessionId: 's', kind: 'confirm', label: 'Do it' })
    setup.settle('r2', 'failed:endpoint refused')
    await expect(pending).resolves.toBe('failed:endpoint refused')
  })

  it('releases a waiting card when its session ends, rather than hanging the turn', async () => {
    const setup = useSetupStore()
    const pending = setup.ask({ id: 'r3', sessionId: 's', kind: 'signin', label: 'Sign in' })
    setup.clearSession('s')
    await expect(pending).resolves.toBe('skipped')
  })
})
