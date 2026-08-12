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

/**
 * Where the counters live, whatever the platform decided to call it.
 *
 * Vercel's Marketplace Redis (Upstash) has injected credentials under two
 * different names across its life — `KV_REST_API_*` from the Vercel KV era it
 * grew out of, and `UPSTASH_REDIS_REST_*` from Upstash's own SDK convention.
 * Accepting both means the integration works whichever it provisions, instead
 * of failing in a way that looks like the trial is broken when it is only
 * named differently. It is the same REST protocol either way.
 */
export function redisCreds() {
  const url = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL
  const token = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN
  return url && token ? { url, token } : null
}

function requireCreds() {
  const creds = redisCreds()
  if (!creds) {
    throw new Error(
      'trial store is not configured: set UPSTASH_REDIS_REST_URL/_TOKEN or KV_REST_API_URL/_TOKEN',
    )
  }
  return creds
}

/** Upstash REST: one fetch per command, no SDK, no bundling concerns. */
async function redis(command) {
  const { url, token } = requireCreds()
  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(command),
  })
  if (!res.ok) throw new Error(`upstash ${res.status}`)
  return (await res.json()).result
}

export async function redisPipeline(commands) {
  const { url, token } = requireCreds()
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

/* ---------------------------------------------------------------------------
 * The trial itself. Routing lives in the two files under `trial/`, which exist
 * only to be the paths an OpenAI-compatible client asks for.
 * ------------------------------------------------------------------------- */

/**
 * Refuse to run, naming what is absent — names, never values. A silent 503
 * during setup is a long afternoon; "missing: TRIAL_SIGNING_SECRET" is a
 * minute, and these names are documented anyway.
 *
 * Refusing is the point: without the store there is no way to bound a session,
 * and an unbounded trial is worse than no trial.
 */
export function configProblem() {
  const missing = [
    !process.env.TRIAL_UPSTREAM_KEY && 'TRIAL_UPSTREAM_KEY',
    !process.env.TRIAL_SIGNING_SECRET && 'TRIAL_SIGNING_SECRET',
    !redisCreds() && 'UPSTASH_REDIS_REST_URL/_TOKEN (or KV_REST_API_URL/_TOKEN)',
  ].filter(Boolean)
  return missing.length ? json({ error: 'trial_off', missing }, 503) : null
}

const MODEL = 'deepseek-v4-flash'
const UPSTREAM = 'https://api.deepseek.com/v1/chat/completions'
const MAX_TOKENS = 1500

/**
 * Thinking is on by default on this model, at `high` effort, and its reasoning
 * tokens bill as output. A trial answer about a demo paper does not need it,
 * and the visitor deciding in thirty seconds whether this is interesting cares
 * more about the first token arriving. If tool loops turn out to wander
 * without it, the honest fix is `{ type: 'enabled' }` with
 * `reasoning_effort: 'low'` — one line, here.
 */
const THINKING = { type: 'disabled' }

/** What one session may spend before it is asked to bring its own key.
 *  At list price this is about $0.034 of upstream, worst case. */
const SESSION_STEPS = 24
const SESSION_INPUT_TOKENS = 220_000
const SESSION_OUTPUT_TOKENS = 12_000
const SESSION_TTL_S = 60 * 60

/**
 * deepseek-v4-flash list price, USD per million tokens (2026-08).
 *
 * Cached input is fifty times cheaper than uncached, which is far too big a
 * gap to average over: an agent loop re-sends its prefix every step, so most
 * of a session's input is cache hits, and charging those at the miss price
 * would close the day's budget while almost none of it had been spent.
 */
const USD_PER_M_CACHE_HIT = 0.0028
const USD_PER_M_CACHE_MISS = 0.14
const USD_PER_M_OUTPUT = 0.28

const DAILY_BUDGET_USD = Number(process.env.TRIAL_DAILY_BUDGET_USD || 10)
const IP_WINDOW_S = 6 * 60 * 60
/**
 * Sessions one address may mint per window.
 *
 * Deliberately loose. Carrier-grade NAT and campus networks put a great many
 * real people behind one address — a tight limit here does not stop a
 * determined abuser, who can change address, but it does turn away the fifth
 * person in an office who clicked the same link. The limits that actually
 * bound the bill are the per-session budget and the daily ceiling; this one
 * only stops a script minting in a loop from one place.
 */
const IP_SESSIONS_PER_WINDOW = 5

/** Big enough for a real question about the demo paper, small enough that
 *  nobody pastes a book into it. */
const MAX_BODY_BYTES = 400_000

export async function handleSession(req) {
  // Hashed, not the address itself — see callerId.
  const ipKey = `trial:ip:${today()}:${await callerId(req)}`
  const [minted] = await redisPipeline([
    ['INCR', ipKey],
    ['EXPIRE', ipKey, String(IP_WINDOW_S)],
  ])
  if (Number(minted) > IP_SESSIONS_PER_WINDOW) {
    return json({ error: 'trial_exhausted', reason: 'ip' }, 429)
  }
  if ((await spentToday()) >= DAILY_BUDGET_USD) {
    return json({ error: 'trial_exhausted', reason: 'daily' }, 402)
  }

  const jti = crypto.randomUUID()
  const exp = Math.floor(Date.now() / 1000) + SESSION_TTL_S
  await redisPipeline([
    [
      'HSET',
      `trial:sess:${jti}`,
      'steps',
      String(SESSION_STEPS),
      'in',
      String(SESSION_INPUT_TOKENS),
      'out',
      String(SESSION_OUTPUT_TOKENS),
    ],
    ['EXPIRE', `trial:sess:${jti}`, String(SESSION_TTL_S)],
  ])

  return json({
    token: await signToken({ jti, exp }),
    expiresAt: exp * 1000,
    model: MODEL,
    steps: SESSION_STEPS,
  })
}

export async function handleCompletion(req) {
  const payload = await verifyToken(bearer(req))
  if (!payload) return json({ error: 'trial_expired' }, 401)

  const sessKey = `trial:sess:${payload.jti}`
  const steps = Number(await redis(['HINCRBY', sessKey, 'steps', '-1']))
  if (steps < 0) return json({ error: 'trial_exhausted', reason: 'session' }, 402)

  const budget = await redisPipeline([
    ['HGET', sessKey, 'in'],
    ['HGET', sessKey, 'out'],
  ])
  if (Number(budget[0]) <= 0 || Number(budget[1]) <= 0) {
    return json({ error: 'trial_exhausted', reason: 'session' }, 402)
  }
  if ((await spentToday()) >= DAILY_BUDGET_USD) {
    return json({ error: 'trial_exhausted', reason: 'daily' }, 402)
  }

  const raw = await req.text()
  if (raw.length > MAX_BODY_BYTES) return json({ error: 'request too large' }, 413)
  let body
  try {
    body = JSON.parse(raw)
  } catch {
    return json({ error: 'invalid body' }, 400)
  }

  // The caller chooses the conversation; we choose everything that costs.
  // `include_usage` is what lets the counters below be real numbers rather
  // than a guess from body sizes.
  const upstreamBody = {
    ...body,
    model: MODEL,
    max_tokens: Math.min(Number(body.max_tokens) || MAX_TOKENS, MAX_TOKENS),
    thinking: THINKING,
    stream_options: body.stream ? { include_usage: true } : undefined,
  }

  const upstream = await fetch(UPSTREAM, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.TRIAL_UPSTREAM_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(upstreamBody),
  })

  if (!upstream.ok || !upstream.body) {
    const detail = await upstream.text().catch(() => '')
    console.error('[trial] upstream', upstream.status, detail.slice(0, 400))
    return json({ error: 'upstream_failed' }, 502)
  }

  return new Response(meterStream(upstream.body, sessKey), {
    status: 200,
    headers: {
      'Content-Type': upstream.headers.get('content-type') || 'text/event-stream',
      'Cache-Control': 'no-store',
      'X-Trial-Steps-Left': String(steps),
    },
  })
}

/**
 * Pass the stream through untouched while watching for the usage chunk at its
 * end, then charge both the session and the day.
 *
 * Deliberately after the fact. Charging up front would mean guessing, and a
 * guess big enough to be safe is a guess big enough to cut a real answer short;
 * the caps that actually bound the bill (steps, and the daily ceiling checked
 * before each call) do not depend on this being exact.
 */
function meterStream(body, sessKey) {
  const decoder = new TextDecoder()
  let tail = ''
  let usage = null

  return body.pipeThrough(
    new TransformStream({
      transform(chunk, controller) {
        controller.enqueue(chunk)
        tail = (tail + decoder.decode(chunk, { stream: true })).slice(-4000)
      },
      async flush() {
        for (const line of tail.split('\n')) {
          if (!line.startsWith('data: ')) continue
          try {
            const parsed = JSON.parse(line.slice(6))
            if (parsed?.usage) usage = parsed.usage
          } catch {
            /* partial or [DONE] */
          }
        }
        const inTok = Number(usage?.prompt_tokens || 0)
        const outTok = Number(usage?.completion_tokens || 0)
        if (!inTok && !outTok) return
        // Fall back to charging everything at the miss price when the split is
        // absent: over-counting closes the budget early, under-counting
        // overshoots the bill.
        const hit = Number(usage?.prompt_cache_hit_tokens || 0)
        const miss = Number(usage?.prompt_cache_miss_tokens ?? inTok - hit)
        const usd =
          (hit / 1e6) * USD_PER_M_CACHE_HIT +
          (miss / 1e6) * USD_PER_M_CACHE_MISS +
          (outTok / 1e6) * USD_PER_M_OUTPUT
        try {
          await redisPipeline([
            ['HINCRBY', sessKey, 'in', String(-inTok)],
            ['HINCRBY', sessKey, 'out', String(-outTok)],
            ['INCRBYFLOAT', `trial:spend:${today()}`, usd.toFixed(6)],
            ['EXPIRE', `trial:spend:${today()}`, '172800'],
          ])
        } catch (err) {
          console.error('[trial] metering failed', err)
        }
      },
    }),
  )
}

async function spentToday() {
  return Number((await redis(['GET', `trial:spend:${today()}`])) || 0)
}
