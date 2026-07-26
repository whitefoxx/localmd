/**
 * DuckDuckGo result cleanup, used by the Jina web_search tool as its named
 * `ddg-links` transform (see lib/httpTools.ts).
 *
 * The tool itself is declarative — a URL template pointing at r.jina.ai, which
 * renders `html.duckduckgo.com`'s no-JS results page to markdown. What a
 * template can't express is untangling DDG's redirect wrappers and dropping its
 * ad rows, so that stays here as code the spec references by name.
 */

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
