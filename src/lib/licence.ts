/**
 * The paid tier's key, verified offline.
 *
 * A licence is a short string the buyer pastes into Settings. It carries its own
 * proof: an Ed25519 signature over its contents, checked here against a public
 * key compiled into the bundle. Nothing is fetched, nothing is phoned home, and
 * no account exists at either end.
 *
 * That is not a privacy flourish, it is the only design that fits the product.
 * The app is a static page; a licence that needed a server to confirm it would
 * hand the whole app a backend dependency, and would lock a paying customer out
 * of features they bought every time that server was slow, blocked, or gone.
 * Offline means the only thing standing between a buyer and their features is
 * the key itself.
 *
 * Deliberately absent: revocation, device binding, obfuscation, any check that
 * runs more than once. A determined person patches the bundle in a minute
 * whatever we do here, so every hour spent making that harder is an hour spent
 * degrading the experience of the people who paid. The signature is here to
 * make a key unforgeable, not to make the app untamperable.
 *
 * Two details that look small and are not:
 *
 *   - The signature covers the ENCODED payload segment, not the parsed object.
 *     There is therefore no question of how a verifier ought to canonicalise
 *     JSON before hashing it — the bytes that were signed are the bytes that
 *     travel.
 *   - `expired` is its own verdict, distinct from `bad-signature`. They are
 *     different conversations: one is "your early slot ran out, here is the
 *     returning price", the other is "this string is not a licence". Collapsing
 *     them would accuse a former customer of forgery.
 */

/** What a valid key entitles and describes. */
export interface Licence {
  /** Opaque order reference. For support and for matching a key to its buyer —
   *  never an entitlement in itself. */
  id: string
  /** `pro` is a purchase; `early` is a time-limited slot given out before the
   *  paid tier existed. The features are identical — the word only decides what
   *  the app says when it runs out. */
  kind: 'pro' | 'early'
  /** ISO `YYYY-MM-DD`. */
  issued: string
  /** ISO `YYYY-MM-DD`, valid through the end of that day in the reader's own
   *  timezone, or `null` for a licence that does not expire. */
  expires: string | null
}

export type LicenceVerdict =
  | { status: 'valid'; licence: Licence }
  | { status: 'expired'; licence: Licence }
  /** Not shaped like a key at all — a truncated paste, or the wrong string. */
  | { status: 'malformed'; reason: string }
  /** Well-formed, but not signed by us. */
  | { status: 'bad-signature' }
  /** We could not perform the check. Never report this as an invalid key: the
   *  key may be perfectly good and the fault entirely ours. */
  | { status: 'unverifiable'; reason: string }

/** Version prefix. It is part of the signed bytes, so a future format cannot be
 *  produced by re-labelling an old signature. */
const PREFIX = 'LMD1'

/**
 * The signing key's public half, base64url of the raw 32 bytes.
 *
 * Empty until `node scripts/sign-key.mjs --init` generates a keypair and prints
 * what to paste here. Empty is a handled state, not a broken one: verification
 * answers `unverifiable`, so a build without a key locks the paid features and
 * says why, rather than unlocking them for everyone.
 */
const PUBLIC_KEY = ''

/** The `<ArrayBuffer>` parameter is not decoration: WebCrypto's `BufferSource`
 *  excludes SharedArrayBuffer-backed views, and a bare `Uint8Array` is the
 *  union of both. Being precise here is what lets the verify call stay cast-free. */
function fromBase64url(s: string): Uint8Array<ArrayBuffer> | null {
  if (!/^[A-Za-z0-9_-]+$/.test(s)) return null
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/')
  try {
    const bin = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4))
    return Uint8Array.from(bin, (c) => c.charCodeAt(0))
  } catch {
    return null
  }
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

/** Reject anything that is not exactly the shape we issue. A key whose fields
 *  we do not recognise is not a lenient case to be tolerated — it is either a
 *  newer format this build cannot honour, or not ours. */
function readLicence(json: unknown): Licence | null {
  if (typeof json !== 'object' || json === null) return null
  const o = json as Record<string, unknown>
  const { id, kind, issued, expires } = o
  if (typeof id !== 'string' || !id) return null
  if (kind !== 'pro' && kind !== 'early') return null
  if (typeof issued !== 'string' || !ISO_DATE.test(issued)) return null
  if (expires !== null && (typeof expires !== 'string' || !ISO_DATE.test(expires))) return null
  return { id, kind, issued, expires }
}

interface ParsedKey {
  licence: Licence
  /** The exact bytes the signature covers. */
  signed: Uint8Array<ArrayBuffer>
  signature: Uint8Array<ArrayBuffer>
}

/** Split and decode a key without checking its signature. Exported because the
 *  signing script round-trips through it, and because "is this even a key?" is
 *  a useful question on its own. */
export function parseLicenceKey(key: string): ParsedKey | { error: string } {
  const parts = key.trim().split('.')
  if (parts.length !== 3) return { error: 'not three dot-separated parts' }
  const [prefix, payload, sig] = parts
  if (prefix !== PREFIX) return { error: `unknown format "${prefix}"` }

  const raw = fromBase64url(payload)
  const signature = fromBase64url(sig)
  if (!raw) return { error: 'payload is not base64url' }
  if (!signature) return { error: 'signature is not base64url' }
  if (signature.length !== 64) return { error: 'signature is the wrong length' }

  let json: unknown
  try {
    json = JSON.parse(new TextDecoder().decode(raw))
  } catch {
    return { error: 'payload is not JSON' }
  }
  const licence = readLicence(json)
  if (!licence) return { error: 'payload is not a licence' }

  return {
    licence,
    signed: new TextEncoder().encode(`${PREFIX}.${payload}`),
    signature,
  }
}

/** Local calendar date, so "expires 2026-11-01" means the whole of the buyer's
 *  1 November wherever they are, rather than a moment in UTC. */
function today(now: Date): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`
}

export function hasExpired(licence: Licence, now = new Date()): boolean {
  return licence.expires !== null && today(now) > licence.expires
}

/** Whole days remaining, 0 on the final day; `null` when it never expires.
 *  Counted on the calendar rather than in milliseconds so a daylight-saving
 *  change cannot make a licence look a day shorter. */
export function daysLeft(licence: Licence, now = new Date()): number | null {
  if (licence.expires === null) return null
  const [y, m, d] = licence.expires.split('-').map(Number)
  const end = Date.UTC(y, m - 1, d)
  const start = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate())
  return Math.max(0, Math.round((end - start) / 86_400_000))
}

export interface VerifyOptions {
  now?: Date
  /** Base64url of the raw 32-byte public key. Defaults to the one compiled in;
   *  tests supply their own so they never depend on a real signing key. */
  publicKey?: string
}

export async function verifyLicenceKey(
  key: string,
  { now = new Date(), publicKey = PUBLIC_KEY }: VerifyOptions = {},
): Promise<LicenceVerdict> {
  const parsed = parseLicenceKey(key)
  if ('error' in parsed) return { status: 'malformed', reason: parsed.error }

  if (!publicKey) return { status: 'unverifiable', reason: 'no signing key in this build' }
  const rawKey = fromBase64url(publicKey)
  if (!rawKey || rawKey.length !== 32) {
    return { status: 'unverifiable', reason: 'signing key is not 32 bytes' }
  }

  let ok: boolean
  try {
    const pub = await crypto.subtle.importKey('raw', rawKey, { name: 'Ed25519' }, false, [
      'verify',
    ])
    ok = await crypto.subtle.verify('Ed25519', pub, parsed.signature, parsed.signed)
  } catch (e) {
    // Ed25519 reached WebCrypto in Chrome 137. This app is Chromium-only, so
    // the realistic cause is an exotic build rather than a bad key — which is
    // exactly why it must not come back as `bad-signature`.
    return { status: 'unverifiable', reason: `Ed25519 unavailable: ${(e as Error).message}` }
  }
  if (!ok) return { status: 'bad-signature' }

  return hasExpired(parsed.licence, now)
    ? { status: 'expired', licence: parsed.licence }
    : { status: 'valid', licence: parsed.licence }
}

/** The single question the gate asks. Everything else is for what to say. */
export function unlocks(verdict: LicenceVerdict | null): boolean {
  return verdict?.status === 'valid'
}
