import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useUpdateStore, watchForUpdates } from './update'

/**
 * The update prompt's one promise: clicking "Reload now" reloads.
 *
 * It used to delegate that to the service-worker client, which reloads on
 * `controllerchange` — an event a page that was never controlled never gets.
 * The card then sat on "Reloading…" with both buttons disabled, and the only
 * way out was the browser's own reload button.
 */
describe('update prompt', () => {
  let reload: ReturnType<typeof vi.fn>
  let listeners: Record<string, (() => void)[]>

  beforeEach(() => {
    setActivePinia(createPinia())
    vi.useFakeTimers()
    reload = vi.fn()
    listeners = {}
    vi.stubGlobal('window', { location: { reload } })
    vi.stubGlobal('navigator', {
      serviceWorker: {
        addEventListener: (type: string, fn: () => void) => {
          ;(listeners[type] ??= []).push(fn)
        },
        removeEventListener: (type: string, fn: () => void) => {
          listeners[type] = (listeners[type] ?? []).filter((f) => f !== fn)
        },
      },
    })
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('reloads as soon as the new worker takes over', async () => {
    const update = useUpdateStore()
    update.offer(async () => {})
    await update.applyNow()

    expect(reload).not.toHaveBeenCalled()
    listeners.controllerchange?.forEach((fn) => fn())
    expect(reload).toHaveBeenCalledTimes(1)

    // …and not a second time when the grace timer comes round.
    vi.advanceTimersByTime(10_000)
    expect(reload).toHaveBeenCalledTimes(1)
  })

  it('reloads anyway when the takeover never happens', async () => {
    const update = useUpdateStore()
    update.offer(async () => {})
    await update.applyNow()

    // An uncontrolled page is not "using" the registration, so skipWaiting
    // activates the new worker without ever taking this one over. Nothing
    // arrives; the reload still has to.
    vi.advanceTimersByTime(10_000)
    expect(reload).toHaveBeenCalledTimes(1)
  })

  it('is still dismissible while it is applying, and dismissing calls it off', async () => {
    const update = useUpdateStore()
    update.offer(async () => {})
    await update.applyNow()
    expect(update.applying).toBe(true)

    update.dismiss()
    expect(update.ready).toBe(false)
    expect(update.applying).toBe(false)

    // Neither clock may yank the page away after the user said no.
    vi.advanceTimersByTime(10_000)
    listeners.controllerchange?.forEach((fn) => fn())
    expect(reload).not.toHaveBeenCalled()
  })
})

/**
 * Looking for a new build is mostly a set of rules about when NOT to ask, and
 * each of them is a request someone would otherwise pay for.
 */
describe('watching for a newer build', () => {
  let update: ReturnType<typeof vi.fn>
  let handlers: Record<string, (() => void)[]>
  let registration: ServiceWorkerRegistration

  const fire = (type: string): void => (handlers[type] ?? []).forEach((f) => f())

  beforeEach(() => {
    vi.useFakeTimers()
    handlers = {}
    update = vi.fn().mockResolvedValue(undefined)
    registration = { update } as unknown as ServiceWorkerRegistration
    vi.stubGlobal('document', {
      visibilityState: 'visible',
      addEventListener: (type: string, fn: () => void) => {
        ;(handlers[type] ??= []).push(fn)
      },
    })
    vi.stubGlobal('navigator', { onLine: true })
    vi.stubGlobal('window', { setInterval: setInterval })
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('asks when the tab comes back to the foreground', () => {
    watchForUpdates(registration)
    fire('visibilitychange')
    expect(update).toHaveBeenCalledTimes(1)
  })

  it('asks on its own for a tab left open', () => {
    watchForUpdates(registration)
    vi.advanceTimersByTime(30 * 60 * 1000)
    expect(update).toHaveBeenCalledTimes(1)
  })

  /** Flicking between tabs is not a reason to talk to the server. */
  it('does not turn tab switching into a poll', () => {
    watchForUpdates(registration)
    fire('visibilitychange')
    fire('visibilitychange')
    fire('visibilitychange')
    expect(update).toHaveBeenCalledTimes(1)

    vi.advanceTimersByTime(61 * 1000)
    fire('visibilitychange')
    expect(update).toHaveBeenCalledTimes(2)
  })

  it('stays quiet while the tab is hidden', () => {
    watchForUpdates(registration)
    ;(document as unknown as { visibilityState: string }).visibilityState = 'hidden'
    fire('visibilitychange')
    vi.advanceTimersByTime(30 * 60 * 1000)
    expect(update).not.toHaveBeenCalled()
  })

  it('stays quiet while offline', () => {
    watchForUpdates(registration)
    ;(navigator as unknown as { onLine: boolean }).onLine = false
    fire('visibilitychange')
    expect(update).not.toHaveBeenCalled()
  })

  /** A check that fails is a check that happens again later, not an error. */
  it('survives a failed check', async () => {
    update.mockRejectedValueOnce(new Error('offline'))
    watchForUpdates(registration)
    expect(() => fire('visibilitychange')).not.toThrow()
    await vi.advanceTimersByTimeAsync(61 * 1000)
    fire('visibilitychange')
    expect(update).toHaveBeenCalledTimes(2)
  })
})
