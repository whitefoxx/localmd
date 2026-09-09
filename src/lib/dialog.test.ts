import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { watch } from 'vue'
import {
  askConfirm,
  askPick,
  askText,
  notify,
  pendingDialog,
  registerDialogHost,
  settleDialog,
  type DialogRequest,
} from './dialog'

let seen: DialogRequest[] = []

/** Stand in for the host: answer each question with whatever `answer` returns. */
function host(answer: (req: DialogRequest) => unknown): () => void {
  const unregister = registerDialogHost()
  const stop = watch(
    pendingDialog,
    (req) => {
      if (!req) return
      seen.push(req)
      settleDialog(answer(req))
    },
    { flush: 'sync' },
  )
  return () => {
    stop()
    unregister()
  }
}

beforeEach(() => {
  seen = []
  vi.stubGlobal('crypto', { randomUUID: () => `id-${Math.random()}` })
})
afterEach(() => vi.unstubAllGlobals())

describe('with a host to answer', () => {
  it('carries each kind’s answer back to its caller', async () => {
    const close = host((req) => {
      if (req.kind === 'confirm') return true
      if (req.kind === 'text') return 'typed'
      if (req.kind === 'pick') return req.rows.slice(0, 1)
      return undefined
    })

    expect(await askConfirm({ title: 'c' })).toBe(true)
    expect(await askText({ title: 't', value: 'was' })).toBe('typed')
    expect(
      (await askPick({ title: 'p', rows: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }], summary: () => '', confirmLabel: () => '' })).map((r) => r.id),
    ).toEqual(['a'])
    await notify('n', 'body')

    expect(seen.map((r) => r.kind)).toEqual(['confirm', 'text', 'pick', 'notice'])
    close()
  })

  it('hands the text field its starting value', async () => {
    const close = host((req) => (req.kind === 'text' ? req.value : undefined))
    expect(await askText({ title: 't', value: 'wiki/notes' })).toBe('wiki/notes')
    close()
  })

  it('supersedes a question still on screen rather than stacking modals', async () => {
    // Deliberately does NOT answer, so the first ask is still open.
    const unregister = registerDialogHost()
    const first = askConfirm({ title: 'first' })
    const second = askConfirm({ title: 'second' })

    // The one that was open is refused; the newer one is what is showing.
    expect(await first).toBe(false)
    expect(pendingDialog.value?.title).toBe('second')
    settleDialog(true)
    expect(await second).toBe(true)
    unregister()
  })
})

describe('with nothing listening', () => {
  it('refuses in each kind’s own shape rather than hanging', async () => {
    // A decision defaults to no. The three refusals differ because the callers
    // read them differently: `false` is a no, `null` is a cancel distinct from
    // an empty string, and no rows is an empty batch.
    expect(await askConfirm({ title: 'c' })).toBe(false)
    expect(await askText({ title: 't' })).toBe(null)
    expect(await askPick({ title: 'p', rows: [{ id: 'a', label: 'A' }], summary: () => '', confirmLabel: () => '' })).toEqual([])
    await expect(notify('n')).resolves.toBeUndefined()
    expect(pendingDialog.value).toBe(null)
  })

  it('refuses a question that was open when the host went away', async () => {
    const unregister = registerDialogHost()
    const pending = askConfirm({ title: 'mid-flight' })
    unregister()

    expect(await pending).toBe(false)
    expect(pendingDialog.value).toBe(null)
  })
})
