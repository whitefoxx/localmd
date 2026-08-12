/**
 * Shared pieces of the trial endpoint: signed session tokens and the counters
 * that bound what a session, and the whole day, may spend.
 *
 * The trial exists because the funnel asked for two commitments before showing
 * anything — pick a folder, then go get an API key. This lets someone ask the
 * demo a real question first. It is a customer-acquisition cost with a hard
 * ceiling, not a product: everything here is about making the ceiling real
 * without introducing the one thing the app promises not to have, an account.
 *
 * So sessions are anonymous and short-lived. A token carries only an opaque id
 * and an expiry, signed so it cannot be minted client-side; the budget itself
 * lives server-side under that id, because a budget the client holds is a
 * budget the client can edit.
 */

const enc = new TextEncoder()

/** Upstash REST: one fetch per command, no SDK, no bundling concerns. */
async function redis(command) {
  const url = process.env.UPSTASH_REDIS_REST_URL
  const token = process.env.UPSTASH_REDIS_REST_TOKEN
  if (!url || !token) throw new Error('trial store is not configured')
  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(command),
  })
  if (!res.ok) throw new Error(`upstash ${res.status}`)
  return (await res.json()).result
}

export async function redisPipeline(commands) {
  const url = process.env.UPSTASH_REDIS_REST_URL
  const token = process.env.UPSTASH_REDIS_REST_TOKEN
  if (!url || !token) throw new Error('trial store is not configured')
  const res = await fetch(`${url}/pipeline`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(commands),
  })
  if (!res.ok) throw new Error(`upstash ${res.status}`)
  return (await res.json()).map((r) => r.result)
}

export { redis }

async function key() {
  const secret = process.env.TRIAL_SIGNING_SECRET
  if (!secret) throw new Error('TRIAL_SIGNING_SECRET is not set')
  return crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, [
    'sign',
    'verify',
  ])
}

function b64url(bytes) {
  return btoa(String.fromCharCode(...new Uint8Array(bytes)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
}

/** Mint `<payload>.<sig>`; the payload is public, the signature is what stops
 *  anyone from writing their own. */
export async function signToken(payload) {
  const body = b64url(enc.encode(JSON.stringify(payload)))
  const sig = await crypto.subtle.sign('HMAC', await key(), enc.encode(body))
  return `${body}.${b64url(sig)}`
}

/** Verified payload, or null. Never throws on malformed input — a bad token is
 *  an ordinary thing to receive, not an exception. */
export async function verifyToken(token) {
  if (typeof token !== 'string' || !token.includes('.')) return null
  const [body, sig] = token.split('.')
  try {
    const raw = Uint8Array.from(
      atob(sig.replace(/-/g, '+').replace(/_/g, '/')),
      (c) => c.charCodeAt(0),
    )
    const ok = await crypto.subtle.verify('HMAC', await key(), raw, enc.encode(body))
    if (!ok) return null
    const payload = JSON.parse(atob(body.replace(/-/g, '+').replace(/_/g, '/')))
    if (typeof payload?.exp !== 'number' || payload.exp < Date.now() / 1000) return null
    return payload
  } catch {
    return null
  }
}

/** The client sends `Authorization: Bearer <token>` because that is where the
 *  AI SDK puts an API key; the trial's "key" is the session token. */
export function bearer(req) {
  const h = req.headers.get('authorization') || ''
  return h.startsWith('Bearer ') ? h.slice(7) : ''
}

function clientIp(req) {
  return (
    req.headers.get('x-real-ip') ||
    (req.headers.get('x-forwarded-for') || '').split(',')[0].trim() ||
    'unknown'
  )
}

/**
 * A stable, irreversible handle for one caller, for rate limiting only.
 *
 * The raw address would work just as well for counting, and that is exactly
 * why it is not used: an app whose front page says "no account, nothing
 * uploaded" should not keep a list of who visited, even for six hours, even in
 * a key nobody reads. HMAC with the signing secret gives the same counting
 * behaviour with nothing recoverable in the store.
 */
export async function callerId(req) {
  const mac = await crypto.subtle.sign('HMAC', await key(), enc.encode(clientIp(req)))
  return b64url(mac).slice(0, 22)
}

export function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  })
}

/** UTC day, so the budget resets at a time we can reason about wherever the
 *  edge happens to run. */
export function today() {
  return new Date().toISOString().slice(0, 10)
}
