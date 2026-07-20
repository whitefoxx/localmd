/**
 * Jina AI Reader — keyless web fetch + search, the built-in fallback for when
 * the web-agent browser extension isn't connected.
 *
 * `r.jina.ai/<url>` returns a page rendered to clean markdown; web *search* is
 * DuckDuckGo's no-JS results page (html.duckduckgo.com) read the same way. No
 * API key and no user cookies — so login-walled or heavily bot-protected pages
 * won't work; that's what the extension (which carries the user's session) is
 * for. Keyless usage is rate-limited (~20 req/min). CORS is open (r.jina.ai
 * echoes the Origin), so the browser can call it directly.
 */

const JINA = 'https://r.jina.ai/'
const READ_TIMEOUT_MS = 45_000

/** Prepend https:// when the caller passed a bare host. */
export function withScheme(url: string): string {
  return /^https?:\/\//i.test(url.trim()) ? url.trim() : `https://${url.trim()}`
}

/** DuckDuckGo's no-JS results endpoint for a query (clean, link-rich HTML). */
export function ddgSearchUrl(query: string): string {
  return `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`
}

/**
 * Clean DuckDuckGo's results markdown for the agent:
 *  - rewrite redirect links (`…/l/?…uddg=<encoded-target>…`) to their real
 *    target URLs, so results carry citeable destinations, not a DDG bounce;
 *  - drop sponsored rows (`duckduckgo.com/y.js?ad_…`) — the agent must never
 *    cite an ad as a source;
 *  - drop empty-anchor chrome (`[](…)` logo/form links) that adds only noise.
 */
export function decodeDdgLinks(md: string): string {
  const decoded = md.replace(
    /https?:\/\/(?:[a-z-]+\.)*duckduckgo\.com\/l\/\?[^)\s"']*?uddg=([^&)\s"']+)[^)\s"']*/gi,
    (whole, enc: string) => {
      try {
        return decodeURIComponent(enc)
      } catch {
        return whole
      }
    },
  )
  return decoded
    .split('\n')
    .filter((line) => !/duckduckgo\.com\/y\.js/i.test(line)) // sponsored rows
    .join('\n')
    .replace(/\[\]\((?:https?:)?\/\/[^)]*\)/g, '') // empty-text anchors
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/** Read a URL as markdown through Jina. Throws on network / non-2xx. */
export async function jinaRead(target: string, signal?: AbortSignal): Promise<string> {
  const timeout = AbortSignal.timeout(READ_TIMEOUT_MS)
  const res = await fetch(JINA + withScheme(target), {
    // Drop image data-URIs — noise the agent doesn't need and can't view here.
    headers: { 'X-Retain-Images': 'none' },
    signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
  })
  if (!res.ok) throw new Error(`Jina reader returned HTTP ${res.status}`)
  return (await res.text()).trim()
}

/** Search the web via DuckDuckGo, read through Jina, with real result URLs. */
export async function jinaSearch(query: string, signal?: AbortSignal): Promise<string> {
  return decodeDdgLinks(await jinaRead(ddgSearchUrl(query), signal))
}
