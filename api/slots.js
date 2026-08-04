/**
 * Early-access slot counter, proxied same-origin.
 *
 * The count lives in a public gist (storage the seller already knows how to
 * edit — `scripts/sign-key.mjs` updates it on every issuance). The page could
 * fetch the gist directly, but gist.githubusercontent.com is unreliable from
 * mainland China and half the early audience arrives from V2EX — a counter
 * that fails for exactly them would be worse than a stale constant. Proxying
 * on the site's own origin makes the counter as reachable as the site.
 *
 * This is deliberately NOT "the app grows a backend": the app never calls it
 * except to decorate the pricing dialog, falls back to the compiled constant
 * when it fails, and it stores one public integer about us — nothing about
 * any user. It is a sidecar of the same kind as the future payment webhook.
 *
 * GIST_RAW is the unpinned /raw/ URL (no revision), which follows the latest
 * edit. Empty = not configured; the endpoint 404s and the page falls back.
 */
const GIST_RAW = 'https://gist.githubusercontent.com/whitefoxx/75d6c9af709d7e650ff832b7da98a6ef/raw/slots'

export default async function handler(req, res) {
  if (!GIST_RAW) {
    res.status(404).end()
    return
  }
  try {
    const upstream = await fetch(GIST_RAW, { signal: AbortSignal.timeout(4000) })
    if (!upstream.ok) throw new Error(`gist ${upstream.status}`)
    const n = Number.parseInt((await upstream.text()).trim(), 10)
    if (!Number.isInteger(n) || n < 0) throw new Error('not a count')
    // A minute of edge cache keeps the gist out of the request path for
    // launch-day traffic; stale-while-revalidate keeps responses instant.
    res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=300')
    res.setHeader('Content-Type', 'text/plain')
    res.status(200).send(String(n))
  } catch {
    // Say "unavailable", never a wrong number: the client's fallback constant
    // is at least deliberately maintained.
    res.status(502).end()
  }
}
