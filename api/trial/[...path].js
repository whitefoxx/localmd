/**
 * The trial endpoint: an anonymous, hard-capped way to ask the demo one real
 * question before committing to a folder and an API key.
 *
 *   POST /api/trial/session               → mint a short-lived session token
 *   POST /api/trial/v1/chat/completions   → proxy one call, on our key
 *
 * The second path is exactly what an OpenAI-compatible client asks for, which
 * is the point: the app reaches the trial through the same provider machinery
 * as any other endpoint (`createOpenAICompatible` with this base URL and the
 * session token as its key), so the agent loop, the tools and the streaming
 * are untouched by the trial's existence.
 *
 * Everything that could cost money is decided here, never by the caller:
 *
 * - the model and its max_tokens are written server-side, so a client cannot
 *   ask for something expensive;
 * - each session carries a step count and a token budget, both stored under
 *   the token's id, because a budget the client holds is one it can edit;
 * - a global daily ceiling stops the whole thing when the day's spend is gone,
 *   which is the only limit that actually bounds the bill;
 * - one session per IP per window, so a single visitor cannot mint budgets in
 *   a loop.
 *
 * When any of those is exhausted the answer is a plain 402 with a message the
 * chat surface can show, whose job is to say "bring your own key" — the trial
 * running out is the normal end of the trial, not an error.
 *
 * Environment (all set in Vercel; absent means the trial is simply off, and
 * `lendTrialModel` in the demo bootstrap treats "off" the same as "used up"):
 *
 *   TRIAL_UPSTREAM_KEY        provider key the trial spends. Give it a spend
 *                             cap at the provider too — that ceiling is the
 *                             one nothing here can talk its way past.
 *   TRIAL_SIGNING_SECRET      any long random string; signs session tokens.
 *   UPSTASH_REDIS_REST_URL    the counters. Without a store there is no way to
 *   UPSTASH_REDIS_REST_TOKEN  bound a session, so the endpoint refuses to run.
 *                             Vercel's Marketplace Redis may inject these as
 *                             KV_REST_API_URL/_TOKEN instead; both are read.
 *   TRIAL_DAILY_BUDGET_USD    optional; defaults to 10. This is the ceiling
 *                             for EVERYONE COMBINED on a given UTC day, not a
 *                             per-visitor allowance — per visitor is the
 *                             session budget above.
 */
import {
  bearer,
  callerId,
  json,
  redis,
  redisCreds,
  redisPipeline,
  signToken,
  today,
  verifyToken,
} from '../_trial.js'

export const config = { runtime: 'edge' }

/** Written here, never taken from the request. */
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
const IP_SESSIONS_PER_WINDOW = 2

/** Big enough for a real question about the demo paper, small enough that
 *  nobody pastes a book into it. */
const MAX_BODY_BYTES = 400_000

export default async function handler(req) {
  const url = new URL(req.url)
  const path = url.pathname.replace(/^\/api\/trial\/?/, '')

  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405)

  // Names, never values. Saying which variable is missing turns a silent 503
  // into a five-second fix during setup, and the names are documented anyway;
  // the secrets they hold never appear here.
  const missing = [
    !process.env.TRIAL_UPSTREAM_KEY && 'TRIAL_UPSTREAM_KEY',
    !process.env.TRIAL_SIGNING_SECRET && 'TRIAL_SIGNING_SECRET',
    !redisCreds() && 'UPSTASH_REDIS_REST_URL/_TOKEN (or KV_REST_API_URL/_TOKEN)',
  ].filter(Boolean)
  if (missing.length) return json({ error: 'trial_off', missing }, 503)

  try {
    if (path === 'session') return await mintSession(req)
    if (path === 'v1/chat/completions') return await proxyCompletion(req)
  } catch (err) {
    // Never leak the upstream key or store internals into a client error.
    console.error('[trial]', err)
    return json({ error: 'trial is unavailable' }, 502)
  }
  return json({ error: 'not found' }, 404)
}

async function mintSession(req) {
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

async function proxyCompletion(req) {
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
