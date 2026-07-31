import { describe, it, expect } from 'vitest'
import {
  prmCandidates,
  asMetadataCandidates,
  supportsPublicPkce,
  pkceChallenge,
  randomToken,
  buildAuthorizeUrl,
  parseCallback,
  callbackFault,
  tokenRequestBody,
  parseTokenResponse,
  isExpired,
  clientMetadataDocument,
  registrationBody,
  discover,
  clientIdentity,
  type AuthServerMetadata,
} from './mcpOAuth'
import type { McpWire, McpWireReply } from './mcp'

const meta = (over: Partial<AuthServerMetadata> = {}): AuthServerMetadata => ({
  issuer: 'https://as.example',
  authorization_endpoint: 'https://as.example/authorize',
  token_endpoint: 'https://as.example/token',
  ...over,
})

/** A wire that answers from a url→reply map and records what it was asked. */
function fakeWire(routes: Record<string, Partial<McpWireReply>>) {
  const seen: string[] = []
  const wire: McpWire = async (req) => {
    seen.push(`${req.method} ${req.url}`)
    const hit = routes[req.url]
    if (!hit) return { status: 404, ok: false, headers: {}, body: '', contentType: '' }
    return {
      status: hit.status ?? 200,
      ok: hit.ok ?? true,
      headers: hit.headers ?? {},
      body: hit.body ?? '',
      contentType: hit.contentType ?? 'application/json',
    }
  }
  return { wire, seen }
}

describe('discovery candidates', () => {
  it('prefers the header, then the path-suffixed well-known, then the bare one', () => {
    expect(
      prmCandidates(
        'https://mcp.craft.do/my/mcp',
        'Bearer realm="OAuth", resource_metadata="https://mcp.craft.do/.well-known/oauth-protected-resource/my/mcp"',
      ),
    ).toEqual([
      'https://mcp.craft.do/.well-known/oauth-protected-resource/my/mcp',
      'https://mcp.craft.do/.well-known/oauth-protected-resource',
    ])
  })

  it('works with no header at all, which is the common case in a browser', () => {
    // Only 15 of 103 servers measured expose WWW-Authenticate to a page, so the
    // well-known paths carry the flow.
    expect(prmCandidates('https://mcp.notion.com/mcp')).toEqual([
      'https://mcp.notion.com/.well-known/oauth-protected-resource/mcp',
      'https://mcp.notion.com/.well-known/oauth-protected-resource',
    ])
  })

  it('offers openid-configuration last', () => {
    const out = asMetadataCandidates('https://as.example/tenant')
    expect(out[0]).toBe('https://as.example/.well-known/oauth-authorization-server/tenant')
    expect(out).toContain('https://as.example/tenant/.well-known/openid-configuration')
    expect(out.at(-1)).toBe('https://as.example/.well-known/openid-configuration')
  })
})

describe('server capability', () => {
  it('accepts an explicit public client with S256', () => {
    expect(
      supportsPublicPkce(
        meta({
          token_endpoint_auth_methods_supported: ['client_secret_basic', 'none'],
          code_challenge_methods_supported: ['S256'],
        }),
      ),
    ).toBe(true)
  })

  it('accepts a server that omits the optional auth-methods list', () => {
    // The spec default is client_secret_basic, but every measured server that
    // omits the field still takes a public client — refusing them would be
    // pedantry that costs real integrations.
    expect(supportsPublicPkce(meta({ code_challenge_methods_supported: ['S256'] }))).toBe(true)
  })

  it('refuses a server that lists methods without none, or lacks S256', () => {
    expect(
      supportsPublicPkce(meta({ token_endpoint_auth_methods_supported: ['client_secret_basic'] })),
    ).toBe(false)
    expect(supportsPublicPkce(meta({ code_challenge_methods_supported: ['plain'] }))).toBe(false)
  })
})

describe('PKCE', () => {
  it('derives the documented challenge for the RFC 7636 test vector', async () => {
    // From RFC 7636 appendix B — proves the digest and base64url encoding, not
    // just that the function returns something.
    expect(await pkceChallenge('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk')).toBe(
      'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
    )
  })

  it('produces url-safe tokens with no padding', () => {
    const t = randomToken()
    expect(t).toMatch(/^[A-Za-z0-9_-]+$/)
    expect(randomToken()).not.toBe(t)
  })
})

describe('authorize URL', () => {
  it('carries PKCE, state and the resource indicator', () => {
    const url = new URL(
      buildAuthorizeUrl({
        meta: meta(),
        clientId: 'https://localmd.app/oauth-client.json',
        redirectUri: 'https://localmd.app/oauth/callback.html',
        challenge: 'CHAL',
        state: 'STATE',
        resource: 'https://mcp.notion.com/mcp',
        scope: 'default',
      }),
    )
    expect(url.origin + url.pathname).toBe('https://as.example/authorize')
    expect(Object.fromEntries(url.searchParams)).toEqual({
      response_type: 'code',
      client_id: 'https://localmd.app/oauth-client.json',
      redirect_uri: 'https://localmd.app/oauth/callback.html',
      code_challenge: 'CHAL',
      code_challenge_method: 'S256',
      state: 'STATE',
      // Without this a token minted for one server could be replayed against
      // another sharing the same authorization server.
      resource: 'https://mcp.notion.com/mcp',
      scope: 'default',
    })
  })

  it('keeps query parameters the endpoint already had', () => {
    const url = buildAuthorizeUrl({
      meta: meta({ authorization_endpoint: 'https://as.example/authorize?tenant=acme' }),
      clientId: 'c',
      redirectUri: 'r',
      challenge: 'x',
      state: 's',
      resource: 'res',
    })
    expect(url).toContain('tenant=acme')
  })
})

describe('callback validation', () => {
  const expected = { state: 'STATE', issuer: 'https://as.example' }

  it('reads code and state from the query', () => {
    expect(parseCallback('https://app/cb?code=C&state=S&iss=https%3A%2F%2Fas.example')).toEqual({
      code: 'C',
      state: 'S',
      error: undefined,
      errorDescription: undefined,
      iss: 'https://as.example',
    })
  })

  it('also reads them from the fragment', () => {
    expect(parseCallback('https://app/cb#code=C&state=S').code).toBe('C')
  })

  it('passes a well-formed callback', () => {
    expect(callbackFault({ code: 'C', state: 'STATE' }, expected)).toBeNull()
    expect(
      callbackFault({ code: 'C', state: 'STATE', iss: 'https://as.example' }, expected),
    ).toBeNull()
  })

  it('rejects a mismatched state — that is a code injection, not a login', () => {
    expect(callbackFault({ code: 'C', state: 'OTHER' }, expected)).toMatch(/state did not match/)
  })

  it('rejects a code minted by a different issuer (RFC 9207)', () => {
    expect(callbackFault({ code: 'C', state: 'STATE', iss: 'https://evil' }, expected)).toMatch(
      /issuer mismatch/,
    )
  })

  it('tolerates an absent iss, which most deployed servers still omit', () => {
    expect(callbackFault({ code: 'C', state: 'STATE' }, expected)).toBeNull()
  })

  it('surfaces a server-reported error with its description', () => {
    expect(
      callbackFault({ error: 'access_denied', errorDescription: 'user said no' }, expected),
    ).toBe('access_denied: user said no')
  })
})

describe('token requests', () => {
  it('sends the verifier, never the challenge, when redeeming a code', () => {
    const body = new URLSearchParams(
      tokenRequestBody({
        grant: 'authorization_code',
        clientId: 'CID',
        code: 'CODE',
        verifier: 'VERIFIER',
        redirectUri: 'https://app/cb',
        resource: 'https://mcp/x',
      }),
    )
    expect(Object.fromEntries(body)).toEqual({
      grant_type: 'authorization_code',
      client_id: 'CID',
      resource: 'https://mcp/x',
      code: 'CODE',
      code_verifier: 'VERIFIER',
      redirect_uri: 'https://app/cb',
    })
  })

  it('spends a refresh token without carrying the code fields', () => {
    const body = new URLSearchParams(
      tokenRequestBody({
        grant: 'refresh_token',
        clientId: 'CID',
        refreshToken: 'RT',
        resource: 'https://mcp/x',
      }),
    )
    expect(body.get('refresh_token')).toBe('RT')
    expect(body.get('code')).toBeNull()
    expect(body.get('code_verifier')).toBeNull()
  })

  it('reads a token response and dates the expiry a minute early', () => {
    expect(
      parseTokenResponse(
        { access_token: 'AT', refresh_token: 'RT', expires_in: 3600, scope: 'default' },
        1_000_000,
      ),
    ).toEqual({
      accessToken: 'AT',
      refreshToken: 'RT',
      expiresAt: 1_000_000 + 3540 * 1000,
      scope: 'default',
    })
  })

  it('treats a token without expires_in as not expiring on a schedule', () => {
    const t = parseTokenResponse({ access_token: 'AT' }, 0)
    expect('error' in t).toBe(false)
    expect(isExpired(t as { accessToken: string }, 9e15)).toBe(false)
  })

  it('reports an OAuth error response rather than pretending to have a token', () => {
    expect(
      parseTokenResponse({ error: 'invalid_grant', error_description: 'code expired' }),
    ).toEqual({ error: 'invalid_grant: code expired' })
    expect(parseTokenResponse({ token_type: 'bearer' })).toEqual({
      error: 'token response had no access_token',
    })
  })

  it('knows when a stored token is due for refresh', () => {
    expect(isExpired({ accessToken: 'a', expiresAt: 100 }, 99)).toBe(false)
    expect(isExpired({ accessToken: 'a', expiresAt: 100 }, 100)).toBe(true)
  })
})

describe('client identity', () => {
  it('declares a public client with both redirect URIs', () => {
    const doc = clientMetadataDocument('https://localmd.app/oauth-client.json', [
      'https://localmd.app/oauth/callback.html',
      'http://localhost:5173/oauth/callback.html',
    ])
    expect(doc.client_id).toBe('https://localmd.app/oauth-client.json')
    expect(doc.token_endpoint_auth_method).toBe('none')
    expect(doc.redirect_uris).toHaveLength(2)
  })

  it('states application_type when registering, as 2026-07-28 requires', () => {
    expect(registrationBody('localmd', ['https://app/cb']).application_type).toBe('web')
  })

  it('uses the metadata document when the server advertises it, and registers nothing', async () => {
    const { wire, seen } = fakeWire({})
    const out = await clientIdentity(wire, meta({ client_id_metadata_document_supported: true }), {
      cimdUrl: 'https://localmd.app/oauth-client.json',
      clientName: 'localmd',
      redirectUris: ['https://localmd.app/oauth/callback.html'],
    })
    expect(out).toEqual({ clientId: 'https://localmd.app/oauth-client.json', via: 'cimd' })
    expect(seen).toEqual([])
  })

  it('falls back to registration when the server does not do CIMD', async () => {
    const { wire, seen } = fakeWire({
      'https://as.example/register': { body: JSON.stringify({ client_id: 'GENERATED' }) },
    })
    const out = await clientIdentity(
      wire,
      meta({ registration_endpoint: 'https://as.example/register' }),
      {
        cimdUrl: 'https://localmd.app/oauth-client.json',
        clientName: 'localmd',
        redirectUris: ['https://localmd.app/oauth/callback.html'],
      },
    )
    expect(out).toEqual({ clientId: 'GENERATED', via: 'dcr' })
    expect(seen).toEqual(['POST https://as.example/register'])
  })

  it('reuses a known registration instead of creating another', async () => {
    const { wire, seen } = fakeWire({})
    const out = await clientIdentity(
      wire,
      meta({ registration_endpoint: 'https://as.example/register' }),
      { clientName: 'localmd', redirectUris: [], known: 'STORED' },
    )
    expect(out).toEqual({ clientId: 'STORED', via: 'dcr' })
    expect(seen).toEqual([])
  })

  it('says so when a server offers neither route', async () => {
    const { wire } = fakeWire({})
    const out = await clientIdentity(wire, meta(), {
      cimdUrl: 'https://localmd.app/oauth-client.json',
      clientName: 'localmd',
      redirectUris: [],
    })
    expect(out).toEqual({ error: expect.stringContaining('neither') })
  })
})

describe('discover', () => {
  it('walks 401 header → protected resource → authorization server', async () => {
    const { wire, seen } = fakeWire({
      'https://mcp.notion.com/.well-known/oauth-protected-resource/mcp': {
        body: JSON.stringify({ authorization_servers: ['https://mcp.notion.com'] }),
      },
      'https://mcp.notion.com/.well-known/oauth-authorization-server/mcp': {
        status: 404,
        ok: false,
      },
      'https://mcp.notion.com/.well-known/oauth-authorization-server': {
        body: JSON.stringify(meta({ issuer: 'https://mcp.notion.com' })),
      },
    })
    const out = await discover(wire, 'https://mcp.notion.com/mcp')
    expect(out).toMatchObject({ issuer: 'https://mcp.notion.com' })
    // The path-suffixed candidate is tried before the bare one.
    expect(seen[0]).toContain('/.well-known/oauth-protected-resource/mcp')
  })

  it('falls back to the resource origin when no protected-resource metadata exists', async () => {
    const { wire } = fakeWire({
      'https://plain.example/.well-known/oauth-authorization-server': {
        body: JSON.stringify(meta({ issuer: 'https://plain.example' })),
      },
    })
    const out = await discover(wire, 'https://plain.example/mcp')
    expect(out).toMatchObject({ issuer: 'https://plain.example' })
  })

  it('reports a server with no discoverable authorization server', async () => {
    const { wire } = fakeWire({})
    expect(await discover(wire, 'https://nowhere.example/mcp')).toEqual({
      error: expect.stringContaining('no authorization-server metadata'),
    })
  })
})
