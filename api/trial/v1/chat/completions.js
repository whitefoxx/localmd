/**
 * POST /api/trial/v1/chat/completions — one proxied call, on our key.
 *
 * The path is not a choice: it is what an OpenAI-compatible client appends to
 * its base URL. Matching it with a real file is what lets the app reach the
 * trial through the same provider machinery as any other endpoint, so the agent
 * loop, the tools and the streaming never learn that the trial exists.
 */
import { configProblem, handleCompletion, json } from '../../../_trial.js'

export const config = { runtime: 'edge' }

export default async function handler(req) {
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405)
  const off = configProblem()
  if (off) return off
  try {
    return await handleCompletion(req)
  } catch (err) {
    console.error('[trial:completions]', err)
    return json({ error: 'trial is unavailable' }, 502)
  }
}
