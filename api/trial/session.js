/**
 * POST /api/trial/session — mint a short-lived, budgeted trial session.
 *
 * A route file and nothing else. The trial lives in `../_trial.js`; this exists
 * because the path has to exist as a file. An earlier version routed both trial
 * paths through one `[...path].js` catch-all, which answered this path and
 * 404ed the deeper one — real files match what a client actually asks for, with
 * no routing rules to be wrong about.
 */
import { configProblem, handleSession, json } from '../_trial.js'

export const config = { runtime: 'edge' }

export default async function handler(req) {
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405)
  const off = configProblem()
  if (off) return off
  try {
    return await handleSession(req)
  } catch (err) {
    // Never leak the upstream key or store internals into a client error.
    console.error('[trial:session]', err)
    return json({ error: 'trial is unavailable' }, 502)
  }
}
