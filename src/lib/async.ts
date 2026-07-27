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
