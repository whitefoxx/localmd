/** Stop waiting on `work` the moment `signal` aborts.
 *
 *  Handing the signal to the work itself is what cancels it — a fetch dies, an
 *  MCP call rejects. This is for the rest: work that cannot be cancelled (a
 *  push already in flight, a parse mid-loop) must not hold its caller — and the
 *  spinner the user is watching — open past the abort. The loser keeps running
 *  and its result is discarded; its rejection is swallowed rather than surfacing
 *  later as an unhandled one. */
export function untilAborted<T>(work: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return work
  work.catch(() => {})
  return Promise.race([
    work,
    new Promise<never>((_, reject) => {
      const fail = (): void => reject(Object.assign(new Error('Aborted'), { name: 'AbortError' }))
      if (signal.aborted) fail()
      else signal.addEventListener('abort', fail, { once: true })
    }),
  ])
}

/** Map with a concurrency cap; results keep input order. Rejections are
 *  captured per-item as Error results rather than failing the whole batch. */
export async function mapLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<Array<R | Error>> {
  const results = new Array<R | Error>(items.length)
  let next = 0
  async function worker(): Promise<void> {
    while (next < items.length) {
      const i = next++
      try {
        results[i] = await fn(items[i], i)
      } catch (err) {
        results[i] = err instanceof Error ? err : new Error(String(err))
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
  return results
}

/**
 * Wrap an async refresh so it is never dropped and never piles up.
 *
 * The naive guard — "already running? return" — silently loses the newest
 * request, and the newest request is the one that knows about the change that
 * just happened. A file written while a status read is in flight leaves the UI
 * describing the state from before it, until something unrelated (a window
 * focus, another operation) happens to ask again. That is the shape of every
 * "sometimes it updates, sometimes I have to refresh" report.
 *
 * Queueing every call is the other failure: five writes in a turn become five
 * full re-scans, run back to back.
 *
 * Coalescing keeps exactly one pending re-run. Anything arriving during a pass
 * collapses into a single follow-up that starts when the current one ends, so
 * the last caller's change is always reflected and a burst costs two passes
 * rather than one per event. Every caller's promise resolves only once the
 * work that covers it has finished, so `await refresh()` still means "the view
 * now includes what I just did".
 *
 * A pass that throws does not wedge the next one: refreshing is best-effort,
 * and a permanently stuck refresher is worse than a missed frame.
 */
export function coalesce(run: () => Promise<void>): () => Promise<void> {
  let active: Promise<void> | null = null
  let queued = false
  const cycle = async (): Promise<void> => {
    do {
      queued = false
      try {
        await run()
      } catch {
        /* best-effort: the next pass gets its own chance */
      }
      // No await between the loop test and the reset, so a caller cannot slip
      // in and set `queued` on a cycle that is already finishing.
    } while (queued)
    active = null
  }
  return () => {
    if (active) {
      queued = true
      return active
    }
    active = cycle()
    return active
  }
}
