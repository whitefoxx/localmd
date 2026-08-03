import { describe, it, expect, beforeAll } from 'vitest'
import {
  parseLicenceKey,
  verifyLicenceKey,
  hasExpired,
  daysLeft,
  unlocks,
  type Licence,
} from './licence'

/* A throwaway keypair per run, so these tests never need — and can never be
 * broken by — the real signing key. */
let priv: CryptoKey
let publicKey: string
let otherPublicKey: string

function b64url(bytes: ArrayBuffer | Uint8Array): string {
  const a = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)
  let s = ''
  for (const b of a) s += String.fromCharCode(b)
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

async function keypair() {
  const k = (await crypto.subtle.generateKey({ name: 'Ed25519' }, true, [
    'sign',
    'verify',
  ])) as CryptoKeyPair
  return { priv: k.privateKey, pub: b64url(await crypto.subtle.exportKey('raw', k.publicKey)) }
}

/** What `scripts/sign-key.mjs` does, in miniature. */
async function mint(licence: Licence, key = priv): Promise<string> {
  const payload = b64url(new TextEncoder().encode(JSON.stringify(licence)))
  const signed = new TextEncoder().encode(`LMD1.${payload}`)
  const sig = await crypto.subtle.sign('Ed25519', key, signed)
  return `LMD1.${payload}.${b64url(sig)}`
}

const PRO: Licence = { id: 'ord_1', kind: 'pro', issued: '2026-08-03', expires: null }
const EARLY: Licence = { id: 'ord_2', kind: 'early', issued: '2026-08-03', expires: '2026-11-01' }

beforeAll(async () => {
  const a = await keypair()
  priv = a.priv
  publicKey = a.pub
  otherPublicKey = (await keypair()).pub
})

describe('verifyLicenceKey', () => {
  it('accepts a key we signed', async () => {
    const v = await verifyLicenceKey(await mint(PRO), { publicKey })
    expect(v).toEqual({ status: 'valid', licence: PRO })
  })

  it('rejects a key signed by someone else', async () => {
    const v = await verifyLicenceKey(await mint(PRO), { publicKey: otherPublicKey })
    expect(v.status).toBe('bad-signature')
  })

  it('rejects an edited payload carrying a real signature', async () => {
    const key = await mint(EARLY)
    const [prefix, , sig] = key.split('.')
    const forged = b64url(
      new TextEncoder().encode(JSON.stringify({ ...EARLY, expires: '2099-01-01' })),
    )
    const v = await verifyLicenceKey(`${prefix}.${forged}.${sig}`, { publicKey })
    expect(v.status).toBe('bad-signature')
  })

  it('will not honour a signature relabelled as another format', async () => {
    // The prefix is inside the signed bytes, so swapping it invalidates the key
    // rather than silently reinterpreting it.
    const [, payload, sig] = (await mint(PRO)).split('.')
    const v = await verifyLicenceKey(`LMD2.${payload}.${sig}`, { publicKey })
    expect(v).toEqual({ status: 'malformed', reason: 'unknown format "LMD2"' })
  })

  it('reports expiry as its own verdict, and hands back the licence', async () => {
    const v = await verifyLicenceKey(await mint(EARLY), {
      publicKey,
      now: new Date('2026-11-02T09:00:00'),
    })
    expect(v).toEqual({ status: 'expired', licence: EARLY })
  })

  it('is still valid on the last day', async () => {
    const v = await verifyLicenceKey(await mint(EARLY), {
      publicKey,
      now: new Date('2026-11-01T23:30:00'),
    })
    expect(v.status).toBe('valid')
  })

  it('says unverifiable — not bad-signature — when the build has no key', async () => {
    const v = await verifyLicenceKey(await mint(PRO), { publicKey: '' })
    expect(v.status).toBe('unverifiable')
  })

  it('says unverifiable when the configured key is the wrong size', async () => {
    const v = await verifyLicenceKey(await mint(PRO), { publicKey: b64url(new Uint8Array(31)) })
    expect(v.status).toBe('unverifiable')
  })
})

describe('parseLicenceKey', () => {
  const bad: [string, string][] = [
    ['', 'not three dot-separated parts'],
    ['LMD1.abc', 'not three dot-separated parts'],
    ['NOPE.abc.def', 'unknown format "NOPE"'],
    ['LMD1.!!!.def', 'payload is not base64url'],
  ]
  it.each(bad)('rejects %j', (key, reason) => {
    expect(parseLicenceKey(key)).toEqual({ error: reason })
  })

  it('rejects a signature of the wrong length', async () => {
    const [p, payload] = (await mint(PRO)).split('.')
    expect(parseLicenceKey(`${p}.${payload}.${b64url(new Uint8Array(32))}`)).toEqual({
      error: 'signature is the wrong length',
    })
  })

  it('rejects a payload that is not a licence', async () => {
    const payload = b64url(new TextEncoder().encode(JSON.stringify({ id: 'x', kind: 'gold' })))
    const sig = b64url(new Uint8Array(64))
    expect(parseLicenceKey(`LMD1.${payload}.${sig}`)).toEqual({
      error: 'payload is not a licence',
    })
  })

  it('rejects a payload that is not JSON', () => {
    const payload = b64url(new TextEncoder().encode('not json'))
    expect(parseLicenceKey(`LMD1.${payload}.${b64url(new Uint8Array(64))}`)).toEqual({
      error: 'payload is not JSON',
    })
  })
})

describe('expiry arithmetic', () => {
  it('never expires without an expiry date', () => {
    expect(hasExpired(PRO, new Date('2099-01-01'))).toBe(false)
    expect(daysLeft(PRO)).toBeNull()
  })

  it('counts whole calendar days, and floors at zero', () => {
    expect(daysLeft(EARLY, new Date('2026-10-30T23:00:00'))).toBe(2)
    expect(daysLeft(EARLY, new Date('2026-11-01T00:01:00'))).toBe(0)
    expect(daysLeft(EARLY, new Date('2026-12-25T00:00:00'))).toBe(0)
  })

  it('does not lose a day across a daylight-saving change', () => {
    // 2026-11-01 is the US DST fallback; a millisecond subtraction would give
    // 30.04 days here and round to the wrong number.
    const l: Licence = { ...EARLY, expires: '2026-11-30' }
    expect(daysLeft(l, new Date('2026-10-31T12:00:00'))).toBe(30)
  })
})

describe('unlocks', () => {
  it('is true only for a valid verdict', async () => {
    expect(unlocks(await verifyLicenceKey(await mint(PRO), { publicKey }))).toBe(true)
    expect(
      unlocks(
        await verifyLicenceKey(await mint(EARLY), {
          publicKey,
          now: new Date('2026-11-02T09:00:00'),
        }),
      ),
    ).toBe(false)
    expect(unlocks({ status: 'unverifiable', reason: 'x' })).toBe(false)
    expect(unlocks(null)).toBe(false)
  })
})
