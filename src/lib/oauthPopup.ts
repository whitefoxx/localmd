/**
 * The one part of OAuth that has to happen in a window rather than in code.
 *
 * The user authenticates on the authorization server's own page — we never see
 * the password, and cannot: that is the entire point of the redirect. A popup
 * rather than a redirect of the app itself, because the app holds the PKCE
 * verifier in memory, and navigating away would throw it out along with any
 * unsaved work in the knowledge base.
 */

/** Where the redirect lands. A static page under public/, so it costs one small
 *  document rather than the whole bundle — see public/oauth/callback.html. */
export function redirectUri(): string {
  return new URL('/oauth/callback.html', window.location.origin).toString()
}

/** Where the published client metadata document lives. Its `client_id` field
 *  must equal this string — that is what makes the URL an identity. */
const CIMD_URL = 'https://localmd.app/oauth-client.json'

/**
 * The client_id to use with an authorization server that takes a metadata
 * document, or null to register instead.
 *
 * The condition is not a feature flag, it is the fact that makes CIMD work: the
 * authorization server fetches this URL itself, so it must be publicly
 * reachable AND must be the document we are described by. Both are true exactly
 * when the app is being served from that origin. A dev build on localhost
 * cannot be fetched at all; a build served from anywhere else would be claiming
 * an identity whose document says someone else's redirect URIs.
 *
 * So this returns null everywhere but production, and those builds fall through
 * to dynamic registration — which is also why the DCR path cannot rot: it is
 * the one every developer uses every day.
 */
export function cimdUrl(): string | null {
  try {
    return window.location.origin === new URL(CIMD_URL).origin ? CIMD_URL : null
  } catch {
    return null
  }
}

/** Popup geometry: big enough for a real consent screen, centred on the window
 *  the user is actually looking at rather than on screen 0. */
function popupFeatures(w = 520, h = 720): string {
  const dx = window.screenX ?? 0
  const dy = window.screenY ?? 0
  const ow = window.outerWidth || window.innerWidth
  const oh = window.outerHeight || window.innerHeight
  const left = Math.max(0, dx + (ow - w) / 2)
  const top = Math.max(0, dy + (oh - h) / 2)
  return `popup=yes,width=${w},height=${h},left=${Math.round(left)},top=${Math.round(top)}`
}

export interface PopupResult {
  /** The full callback URL, for parseCallback. */
  href?: string
  error?: string
}

/**
 * Open the authorization page and wait for the callback to hand back its URL.
 *
 * Resolves with an error rather than rejecting, because every outcome here is
 * something to show the user, not an exception: they closed the window, the
 * browser blocked the popup, the server never redirected.
 */
export function authorizeInPopup(authorizeUrl: string, timeoutMs = 300_000): Promise<PopupResult> {
  const win = window.open(authorizeUrl, 'localmd-oauth', popupFeatures())
  if (!win) {
    return Promise.resolve({
      error: 'The browser blocked the sign-in window — allow popups for this site and try again.',
    })
  }
  return new Promise<PopupResult>((resolve) => {
    let done = false
    const finish = (r: PopupResult): void => {
      if (done) return
      done = true
      window.removeEventListener('message', onMessage)
      clearInterval(closedTimer)
      clearTimeout(timer)
      try {
        win.close()
      } catch {
        /* already gone */
      }
      resolve(r)
    }

    const onMessage = (e: MessageEvent): void => {
      // Same-origin only: the callback page posts to its own origin, so a frame
      // from anywhere else carrying a "code" is not ours.
      if (e.origin !== window.location.origin) return
      const d = e.data as { source?: unknown; href?: unknown } | null
      if (!d || d.source !== 'localmd-oauth' || typeof d.href !== 'string') return
      finish({ href: d.href })
    }
    window.addEventListener('message', onMessage)

    // A closed window is the ordinary "changed my mind", and there is no event
    // for it — polling is the only way to notice. One second is invisible to a
    // person and cheap enough to run for the length of a sign-in.
    const closedTimer = setInterval(() => {
      if (win.closed) finish({ error: 'Sign-in window was closed before it finished.' })
    }, 1000)

    const timer = setTimeout(
      () => finish({ error: 'Sign-in timed out.' }),
      timeoutMs,
    )
  })
}
