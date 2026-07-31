/**
 * OAuth for MCP servers, from a page with no backend.
 *
 * MCP does not invent authentication: a server is an OAuth 2.0 resource server,
 * and we are a public client — no client secret, PKCE mandatory. What the spec
 * adds is a discovery chain, so a client can be pointed at any endpoint and find
 * its authorization server without per-service configuration:
 *
 *   401 + WWW-Authenticate → protected-resource metadata → authorization-server
 *   metadata → authorize / token / register
 *
 * Everything here is pure: it builds URLs and request bodies and reads
 * responses, but never fetches. That is not tidiness — the same OAuth exchange
 * has to be able to travel over either transport, because a server that refuses
 * browsers refuses them for its token endpoint too. The caller supplies an
 * McpWire (direct fetch, or WebCLI's proxy) and the whole flow follows it.
 *
 * Two ways to be a client, and we need both:
 *
 *   - CIMD (Client ID Metadata Document) — the client_id IS an https URL, and
 *     the authorization server fetches it to learn our name and redirect URIs.
 *     Nothing is registered, so there is no per-browser state to create, lose or
 *     clean up: a static JSON file is the entire client identity. The 2026-07-28
 *     revision deprecates DCR in favour of this, and it is what a static site
 *     should have wanted all along.
 *   - DCR (RFC 7591) — POST to /register, get a client_id back. Deprecated, but
 *     it is what the installed base implements: of the servers surveyed, 86 of
 *     103 offered registration and 17 offered CIMD. It is also the only path
 *     that works from a dev origin an authorization server cannot reach.
 *
 * So CIMD is preferred and DCR is the fallback, decided per authorization server
 * from its own metadata rather than by configuration.
 */

import type { McpWire } from '@/lib/mcp'

/* ── metadata shapes ─────────────────────────────────────────────────────── */

/** RFC 9728. Only the field we route on is required reading. */
export interface ProtectedResourceMetadata {
  resource?: string
  authorization_servers?: string[]
}

/** RFC 8414, plus the MCP-relevant capability flags. */
export interface AuthServerMetadata {
  issuer: string
  authorization_endpoint: string
  token_endpoint: string
  registration_endpoint?: string
  code_challenge_methods_supported?: string[]
  token_endpoint_auth_methods_supported?: string[]
  /** Whether an https URL may be used directly as client_id (CIMD). */
  client_id_metadata_document_supported?: boolean
  scopes_supported?: string[]
}

/* ── discovery ───────────────────────────────────────────────────────────── */

/**
 * Where to look for protected-resource metadata, best first.
 *
 * The spec's own answer is the `resource_metadata` parameter of the 401's
 * WWW-Authenticate header — but a browser can only read that header when the
 * server sends Access-Control-Expose-Headers, and almost none do (15 of 103
 * measured). Through WebCLI every header is readable, so the header path is
 * worth trying and the well-known paths are what actually carry the flow.
 *
 * The path-suffixed form is not decoration: an endpoint at /my/mcp advertises
 * its metadata at /.well-known/oauth-protected-resource/my/mcp, and Craft's
 * authorization server is only discoverable that way.
 */
export function prmCandidates(resourceUrl: string, wwwAuthenticate?: string | null): string[] {
  const out: string[] = []
  const fromHeader = /resource_metadata="([^"]+)"/.exec(wwwAuthenticate ?? '')?.[1]
  if (fromHeader) out.push(fromHeader)
  try {
    const u = new URL(resourceUrl)
    const path = u.pathname.replace(/\/+$/, '')
    if (path) out.push(`${u.origin}/.well-known/oauth-protected-resource${path}`)
    out.push(`${u.origin}/.well-known/oauth-protected-resource`)
  } catch {
    /* a malformed url yields whatever the header gave us, or nothing */
  }
  return [...new Set(out)]
}

/** Where to look for authorization-server metadata, best first. OpenID's
 *  discovery document is last: some servers publish only that one. */
export function asMetadataCandidates(issuer: string): string[] {
  const out: string[] = []
  try {
    const u = new URL(issuer)
    const path = u.pathname.replace(/\/+$/, '')
    if (path) out.push(`${u.origin}/.well-known/oauth-authorization-server${path}`)
    out.push(`${u.origin}/.well-known/oauth-authorization-server`)
    if (path) out.push(`${u.origin}${path}/.well-known/openid-configuration`)
    out.push(`${u.origin}/.well-known/openid-configuration`)
  } catch {
    /* nothing to try */
  }
  return [...new Set(out)]
}

/** True when the metadata describes a server this client can actually use. */
export function supportsPublicPkce(meta: AuthServerMetadata): boolean {
  const methods = meta.token_endpoint_auth_methods_supported
  // Absent means the spec default, `client_secret_basic` — but every MCP server
  // measured that omits it still accepts a public client, and rejecting on a
  // missing optional field would refuse servers that work. Only an explicit
  // list without `none` is treated as a refusal.
  const publicOk = !methods || methods.includes('none')
  return publicOk && (meta.code_challenge_methods_supported ?? ['S256']).includes('S256')
}

/* ── PKCE ────────────────────────────────────────────────────────────────── */

function base64url(bytes: ArrayBuffer | Uint8Array): string {
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)
  let s = ''
  for (const b of arr) s += String.fromCharCode(b)
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/** A random URL-safe string, used for both the PKCE verifier and `state`. */
export function randomToken(bytes = 32): string {
  return base64url(crypto.getRandomValues(new Uint8Array(bytes)))
}

/**
 * The verifier never leaves this page; only its SHA-256 goes to the
 * authorization server. That is what makes an authorization code useless to
 * anyone who intercepts it — a public client has no secret to prove itself
 * with, so possession of the verifier is the proof.
 */
export async function pkceChallenge(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))
  return base64url(digest)
}

/* ── client identity ─────────────────────────────────────────────────────── */

export interface ClientIdentity {
  clientId: string
  /** How we came by it — CIMD needs no storage, a registration does. */
  via: 'cimd' | 'dcr'
}

/** The JSON a CIMD document must contain. Served as a static file; the
 *  authorization server fetches it by client_id. */
export function clientMetadataDocument(clientIdUrl: string, redirectUris: string[]) {
  return {
    client_id: clientIdUrl,
    client_name: 'localmd',
    client_uri: new URL(clientIdUrl).origin,
    redirect_uris: redirectUris,
    grant_types: ['authorization_code', 'refresh_token'],
    response_types: ['code'],
    token_endpoint_auth_method: 'none',
    application_type: 'web',
  }
}

/** The body for a dynamic client registration. `application_type` is required
 *  as of 2026-07-28, to stop OpenID servers guessing `web` and then rejecting
 *  the redirect URI. */
export function registrationBody(clientName: string, redirectUris: string[]) {
  return {
    client_name: clientName,
    redirect_uris: redirectUris,
    grant_types: ['authorization_code', 'refresh_token'],
    response_types: ['code'],
    token_endpoint_auth_method: 'none',
    application_type: 'web',
  }
}

/* ── authorize ───────────────────────────────────────────────────────────── */

export interface AuthorizeParams {
  meta: AuthServerMetadata
  clientId: string
  redirectUri: string
  challenge: string
  state: string
  /** RFC 8707. MCP requires it so a token minted for one server cannot be
   *  replayed against another sharing the same authorization server. */
  resource: string
  scope?: string
}

export function buildAuthorizeUrl(p: AuthorizeParams): string {
  const u = new URL(p.meta.authorization_endpoint)
  const q = u.searchParams
  q.set('response_type', 'code')
  q.set('client_id', p.clientId)
  q.set('redirect_uri', p.redirectUri)
  q.set('code_challenge', p.challenge)
  q.set('code_challenge_method', 'S256')
  q.set('state', p.state)
  q.set('resource', p.resource)
  if (p.scope) q.set('scope', p.scope)
  return u.toString()
}

export interface CallbackParams {
  code?: string
  state?: string
  error?: string
  errorDescription?: string
  /** RFC 9207. */
  iss?: string
}

/** Read the redirect back. Accepts query or fragment, because servers differ
 *  and reading both costs nothing. */
export function parseCallback(url: string): CallbackParams {
  const u = new URL(url)
  const q = new URLSearchParams(u.search)
  const f = new URLSearchParams(u.hash.replace(/^#/, ''))
  const pick = (k: string): string | undefined => q.get(k) ?? f.get(k) ?? undefined
  return {
    code: pick('code'),
    state: pick('state'),
    error: pick('error'),
    errorDescription: pick('error_description'),
    iss: pick('iss'),
  }
}

/**
 * What must be true before an authorization code is redeemed.
 *
 * `state` is the CSRF check — a code arriving with someone else's state is an
 * injection attempt, not a login. `iss` is RFC 9207: when the server names the
 * issuer, a mismatch means the code came from a different authorization server
 * than the one we started with, and 2026-07-28 makes validating it mandatory.
 * Absent `iss` is allowed, because most deployed servers still omit it.
 */
export function callbackFault(
  cb: CallbackParams,
  expected: { state: string; issuer: string },
): string | null {
  if (cb.error) return cb.errorDescription ? `${cb.error}: ${cb.errorDescription}` : cb.error
  if (!cb.code) return 'no authorization code in the redirect'
  if (cb.state !== expected.state) return 'state did not match — the redirect is not ours'
  if (cb.iss && cb.iss !== expected.issuer) {
    return `issuer mismatch: the code came from ${cb.iss}`
  }
  return null
}

/* ── token ───────────────────────────────────────────────────────────────── */

export interface TokenSet {
  accessToken: string
  refreshToken?: string
  /** Epoch ms. Absent when the server did not say. */
  expiresAt?: number
  scope?: string
}

export function tokenRequestBody(p: {
  grant: 'authorization_code' | 'refresh_token'
  clientId: string
  code?: string
  verifier?: string
  redirectUri?: string
  refreshToken?: string
  resource: string
}): string {
  const b = new URLSearchParams()
  b.set('grant_type', p.grant)
  b.set('client_id', p.clientId)
  b.set('resource', p.resource)
  if (p.grant === 'authorization_code') {
    b.set('code', p.code ?? '')
    b.set('code_verifier', p.verifier ?? '')
    if (p.redirectUri) b.set('redirect_uri', p.redirectUri)
  } else {
    b.set('refresh_token', p.refreshToken ?? '')
  }
  return b.toString()
}

/** Read a token response. `now` is injected so expiry maths is testable. */
export function parseTokenResponse(raw: unknown, now = Date.now()): TokenSet | { error: string } {
  const r = raw as Record<string, unknown> | null
  if (!r || typeof r !== 'object') return { error: 'token endpoint returned no JSON' }
  if (typeof r.error === 'string') {
    const desc = typeof r.error_description === 'string' ? `: ${r.error_description}` : ''
    return { error: `${r.error}${desc}` }
  }
  const access = r.access_token
  if (typeof access !== 'string' || !access) return { error: 'token response had no access_token' }
  const expiresIn = typeof r.expires_in === 'number' ? r.expires_in : undefined
  return {
    accessToken: access,
    ...(typeof r.refresh_token === 'string' ? { refreshToken: r.refresh_token } : {}),
    // A minute of slack: a token that expires while in flight reads to the user
    // as a random failure, and refreshing early costs nothing.
    ...(expiresIn ? { expiresAt: now + Math.max(0, expiresIn - 60) * 1000 } : {}),
    ...(typeof r.scope === 'string' ? { scope: r.scope } : {}),
  }
}

/** True when a stored token should be refreshed before the next request. */
export function isExpired(t: TokenSet, now = Date.now()): boolean {
  return t.expiresAt !== undefined && now >= t.expiresAt
}

/* ── the wire-driven half ────────────────────────────────────────────────── */

/** JSON GET over whichever transport the row uses. Returns null on any failure,
 *  because every caller here is trying candidates in order. */
async function getJson(wire: McpWire, url: string): Promise<unknown | null> {
  try {
    const r = await wire({ url, method: 'GET', headers: { Accept: 'application/json' } })
    if (!r.ok) return null
    return JSON.parse(r.body) as unknown
  } catch {
    return null
  }
}

export interface Discovery {
  resource: string
  issuer: string
  meta: AuthServerMetadata
}

/**
 * Walk the chain for one MCP endpoint. `wwwAuthenticate` is the header from the
 * 401 that triggered this, when the transport could read it.
 *
 * Falls back to treating the resource's own origin as the authorization server:
 * a few servers publish authorization-server metadata without publishing
 * protected-resource metadata, and refusing them would be pedantry.
 */
export async function discover(
  wire: McpWire,
  resourceUrl: string,
  wwwAuthenticate?: string | null,
): Promise<Discovery | { error: string }> {
  let issuer: string | null = null
  for (const url of prmCandidates(resourceUrl, wwwAuthenticate)) {
    const prm = (await getJson(wire, url)) as ProtectedResourceMetadata | null
    const first = prm?.authorization_servers?.[0]
    if (first) {
      issuer = first
      break
    }
  }
  if (!issuer) {
    try {
      issuer = new URL(resourceUrl).origin
    } catch {
      return { error: 'not a valid server URL' }
    }
  }
  for (const url of asMetadataCandidates(issuer)) {
    const meta = (await getJson(wire, url)) as AuthServerMetadata | null
    if (meta?.token_endpoint && meta.authorization_endpoint) {
      return { resource: resourceUrl, issuer: meta.issuer || issuer, meta }
    }
  }
  return { error: `no authorization-server metadata found for ${issuer}` }
}

/**
 * Decide how to identify ourselves to this authorization server.
 *
 * CIMD when it is advertised — nothing to store, nothing to expire. Otherwise
 * register, and let the caller persist the id: a registration is per
 * authorization server and survives, so re-registering on every sign-in would
 * litter the provider with dead clients.
 */
export async function clientIdentity(
  wire: McpWire,
  meta: AuthServerMetadata,
  opts: { cimdUrl?: string; clientName: string; redirectUris: string[]; known?: string },
): Promise<ClientIdentity | { error: string }> {
  if (opts.known) return { clientId: opts.known, via: 'dcr' }
  if (meta.client_id_metadata_document_supported && opts.cimdUrl) {
    return { clientId: opts.cimdUrl, via: 'cimd' }
  }
  if (!meta.registration_endpoint) {
    return {
      error: opts.cimdUrl
        ? 'this server supports neither client metadata documents nor registration'
        : 'this server needs dynamic registration, which it does not offer',
    }
  }
  try {
    const r = await wire({
      url: meta.registration_endpoint,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(registrationBody(opts.clientName, opts.redirectUris)),
    })
    const body = JSON.parse(r.body) as { client_id?: string; error?: string }
    if (!r.ok || !body.client_id) {
      return { error: `registration failed (HTTP ${r.status})${body.error ? `: ${body.error}` : ''}` }
    }
    return { clientId: body.client_id, via: 'dcr' }
  } catch (err) {
    return { error: `registration failed: ${(err as Error).message}` }
  }
}

/** Redeem a code, or spend a refresh token. */
export async function requestToken(
  wire: McpWire,
  meta: AuthServerMetadata,
  body: string,
): Promise<TokenSet | { error: string }> {
  try {
    const r = await wire({
      url: meta.token_endpoint,
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body,
    })
    let parsed: unknown = null
    try {
      parsed = JSON.parse(r.body)
    } catch {
      return { error: `token endpoint returned HTTP ${r.status}` }
    }
    return parseTokenResponse(parsed)
  } catch (err) {
    return { error: `token request failed: ${(err as Error).message}` }
  }
}
