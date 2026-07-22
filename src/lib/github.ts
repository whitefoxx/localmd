/**
 * GitHub sync over the REST Git Data API — the CORS-friendly path (github.com
 * git-over-HTTP endpoints reject browser origins; api.github.com allows them).
 *
 * Design: mirror git objects through the API so shas stay IDENTICAL on both
 * sides — push uploads blobs/trees/commits reconstructing each local commit
 * remotely, pull downloads remote objects and rewrites them locally
 * (writeBlob/writeTree/writeCommit). Git objects are content-addressed, so a
 * faithful reconstruction reproduces the sha; every step VERIFIES the sha and
 * aborts on mismatch. Fast-forward only — divergence is resolved in a real
 * terminal, not here.
 *
 * Pure helpers (parseGithubRemote, isoToGitTime, gitTimeToIso, apiTreeMode,
 * localTreeMode) are exported for unit tests.
 */
import { raw, hasObject, isAncestor, headOid, currentBranch, resetGitCache } from '@/lib/git'

const API = 'https://api.github.com'

export interface GithubRepo {
  owner: string
  repo: string
}

/** Parse a GitHub remote URL in ssh / https / ssh-protocol forms. */
export function parseGithubRemote(url: string): GithubRepo | null {
  const m =
    /^git@github\.com:([^/]+)\/(.+?)(?:\.git)?$/.exec(url) ??
    /^ssh:\/\/git@github\.com\/([^/]+)\/(.+?)(?:\.git)?$/.exec(url) ??
    /^https:\/\/github\.com\/([^/]+)\/(.+?)(?:\.git)?\/?$/.exec(url)
  if (!m) return null
  return { owner: m[1], repo: m[2] }
}

/** ISO8601 with offset ("2026-07-11T10:00:00+08:00") → git author time.
 *  timezoneOffset follows the JS getTimezoneOffset() sign convention
 *  (minutes to ADD to local time to reach UTC: UTC+8 → -480). */
export function isoToGitTime(iso: string): { timestamp: number; timezoneOffset: number } {
  const timestamp = Math.floor(new Date(iso).getTime() / 1000)
  const m = /([+-])(\d{2}):?(\d{2})$/.exec(iso)
  if (!m || iso.endsWith('Z')) return { timestamp, timezoneOffset: 0 }
  const minutes = Number(m[2]) * 60 + Number(m[3])
  return { timestamp, timezoneOffset: m[1] === '+' ? -minutes : minutes }
}

/** git author time → ISO8601 in the author's own timezone (sha-faithful). */
export function gitTimeToIso(timestamp: number, timezoneOffset: number): string {
  const local = new Date((timestamp - timezoneOffset * 60) * 1000)
  const pad = (n: number) => String(n).padStart(2, '0')
  const sign = timezoneOffset <= 0 ? '+' : '-'
  const abs = Math.abs(timezoneOffset)
  return (
    `${local.getUTCFullYear()}-${pad(local.getUTCMonth() + 1)}-${pad(local.getUTCDate())}` +
    `T${pad(local.getUTCHours())}:${pad(local.getUTCMinutes())}:${pad(local.getUTCSeconds())}` +
    `${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`
  )
}

/** Local tree modes → API form: trees need the leading zero ("040000"). */
export function apiTreeMode(mode: string): string {
  return mode === '40000' ? '040000' : mode
}

/** API tree modes → git canonical on-disk form ("40000"). */
export function localTreeMode(mode: string): string {
  return mode === '040000' ? '40000' : mode
}

/* ── API client ──────────────────────────────────────────────────────────── */

class GithubError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message)
  }
}

export type Progress = (msg: string) => void

interface Ctx extends GithubRepo {
  token: string
}

async function api(
  ctx: Ctx,
  method: string,
  path: string,
  body?: unknown,
): Promise<Record<string, unknown>> {
  const resp = await fetch(`${API}/repos/${ctx.owner}/${ctx.repo}${path}`, {
    method,
    headers: {
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      ...(ctx.token ? { Authorization: `Bearer ${ctx.token}` } : {}),
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  })
  if (!resp.ok) {
    let detail = ''
    try {
      detail = ((await resp.json()) as { message?: string }).message ?? ''
    } catch {
      /* non-json error body */
    }
    throw new GithubError(resp.status, `GitHub API ${resp.status}: ${detail || resp.statusText}`)
  }
  return (await resp.json()) as Record<string, unknown>
}

async function apiExists(ctx: Ctx, path: string): Promise<boolean> {
  try {
    await api(ctx, 'GET', path)
    return true
  } catch (e) {
    if (e instanceof GithubError && (e.status === 404 || e.status === 422)) return false
    throw e
  }
}

function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64.replace(/\n/g, ''))
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

function bytesToB64(bytes: Uint8Array): string {
  let bin = ''
  const CHUNK = 0x8000
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK))
  }
  return btoa(bin)
}

async function remoteHead(ctx: Ctx, branch: string): Promise<string | null> {
  try {
    const ref = await api(ctx, 'GET', `/git/ref/${encodeURIComponent(`heads/${branch}`)}`)
    return (ref.object as { sha: string }).sha
  } catch (e) {
    if (e instanceof GithubError && e.status === 404) return null
    throw e
  }
}

/* ── pull ────────────────────────────────────────────────────────────────── */

interface ApiPerson {
  name: string
  email: string
  date: string
}

interface ApiCommit {
  sha: string
  message: string
  tree: { sha: string }
  parents: { sha: string }[]
  author: ApiPerson
  committer: ApiPerson
  verification?: { signature: string | null }
}

function toGitPerson(p: ApiPerson): {
  name: string
  email: string
  timestamp: number
  timezoneOffset: number
} {
  return { name: p.name, email: p.email, ...isoToGitTime(p.date) }
}

async function fetchTreeInto(ctx: Ctx, treeSha: string, progress: Progress): Promise<void> {
  if (await hasObject(treeSha)) return
  const { git, base } = raw
  const data = await api(ctx, 'GET', `/git/trees/${treeSha}`)
  const entries = data.tree as { path: string; mode: string; type: string; sha: string }[]
  for (const e of entries) {
    if (e.type === 'tree') {
      await fetchTreeInto(ctx, e.sha, progress)
    } else if (e.type === 'blob') {
      if (await hasObject(e.sha)) continue
      progress(`Downloading ${e.path}`)
      const blob = await api(ctx, 'GET', `/git/blobs/${e.sha}`)
      const bytes = b64ToBytes(blob.content as string)
      const oid = await git.writeBlob({ ...base(), blob: bytes })
      if (oid !== e.sha) throw new Error(`blob sha mismatch: expected ${e.sha}, got ${oid}`)
    } else {
      throw new Error(`Unsupported tree entry type ${e.type} (${e.path}) — please handle it in a terminal`)
    }
  }
  const oid = await git.writeTree({
    ...base(),
    tree: entries.map((e) => ({
      mode: localTreeMode(e.mode),
      path: e.path,
      oid: e.sha,
      type: e.type as 'blob' | 'tree',
    })),
  })
  if (oid !== treeSha) throw new Error(`tree sha mismatch: expected ${treeSha}, got ${oid}`)
}

/** Fast-forward pull. Returns a summary line. */
export async function pull(ctx: Ctx, progress: Progress = () => {}): Promise<string> {
  const { git, base } = raw
  const branch = (await currentBranch()) ?? 'main'
  const remote = await remoteHead(ctx, branch)
  if (!remote) throw new Error(`Remote has no branch ${branch}`)
  const local = await headOid()
  if (remote === local) return 'Already up to date'

  // Walk remote history back to a commit we already have.
  progress('Fetching remote commits…')
  const chain: ApiCommit[] = []
  const queue = [remote]
  const seen = new Set<string>()
  while (queue.length) {
    const sha = queue.shift()!
    if (seen.has(sha) || (await hasObject(sha))) continue
    seen.add(sha)
    const commit = (await api(ctx, 'GET', `/git/commits/${sha}`)) as unknown as ApiCommit
    chain.push(commit)
    for (const p of commit.parents) queue.push(p.sha)
    if (chain.length > 500) throw new Error('Too many diverging commits (>500) — please pull in a terminal')
  }

  // Oldest-first so parents exist before children. (The fast-forward check
  // runs after objects are written — writing extra objects is harmless, and
  // ancestry can only be computed once the commits exist locally.)
  chain.reverse()
  for (let i = 0; i < chain.length; i++) {
    const c = chain[i]
    progress(`Syncing commit ${i + 1}/${chain.length}`)
    await fetchTreeInto(ctx, c.tree.sha, progress)
    const oid = await git.writeCommit({
      ...base(),
      commit: {
        message: c.message.endsWith('\n') ? c.message : `${c.message}\n`,
        tree: c.tree.sha,
        parent: c.parents.map((p) => p.sha),
        author: toGitPerson(c.author),
        committer: toGitPerson(c.committer),
        ...(c.verification?.signature ? { gpgsig: c.verification.signature } : {}),
      },
    })
    if (oid !== c.sha) {
      throw new Error(
        `commit sha mismatch (expected ${c.sha.slice(0, 7)}, got ${oid.slice(0, 7)}) — this commit can't be reconstructed via the API, please pull in a terminal`,
      )
    }
  }

  if (local && !(await isAncestor(local, remote))) {
    throw new Error('Local and remote have diverged — please resolve in a terminal (git pull --rebase or merge)')
  }

  progress('Updating working tree…')
  await git.writeRef({ ...base(), ref: `refs/heads/${branch}`, value: remote, force: true })
  await git.writeRef({ ...base(), ref: `refs/remotes/origin/${branch}`, value: remote, force: true })
  resetGitCache()
  await git.checkout({ ...base(), ref: branch, force: false })
  return `Pulled ${chain.length} commit(s) (${remote.slice(0, 7)})`
}

/* ── push ────────────────────────────────────────────────────────────────── */

async function pushTree(ctx: Ctx, treeOid: string, progress: Progress): Promise<void> {
  const { git, base } = raw
  if (await apiExists(ctx, `/git/trees/${treeOid}`)) return
  const { tree } = await git.readTree({ ...base(), oid: treeOid })
  for (const e of tree) {
    if (e.type === 'tree') {
      await pushTree(ctx, e.oid, progress)
    } else if (e.type === 'blob') {
      progress(`Uploading ${e.path}`)
      const { blob } = await git.readBlob({ ...base(), oid: e.oid })
      if (blob.length > 100 * 1024 * 1024) {
        throw new Error(`${e.path} exceeds the GitHub API's 100MB per-file limit — please push in a terminal`)
      }
      const res = await api(ctx, 'POST', '/git/blobs', {
        content: bytesToB64(blob),
        encoding: 'base64',
      })
      if (res.sha !== e.oid) throw new Error(`blob sha mismatch (${e.path})`)
    } else {
      throw new Error(`Unsupported object type ${e.type} (${e.path}) — please push in a terminal`)
    }
  }
  const res = await api(ctx, 'POST', '/git/trees', {
    tree: tree.map((e) => ({
      path: e.path,
      mode: apiTreeMode(e.mode),
      type: e.type,
      sha: e.oid,
    })),
  })
  if (res.sha !== treeOid) throw new Error(`tree sha mismatch: expected ${treeOid}, got ${res.sha}`)
}

/** Fast-forward push (mirrors local commits through the API). */
export async function push(ctx: Ctx, progress: Progress = () => {}): Promise<string> {
  const { git, base } = raw
  const branch = (await currentBranch()) ?? 'main'
  const local = await headOid()
  if (!local) throw new Error('No local commits yet')
  const remote = await remoteHead(ctx, branch)
  if (!remote) throw new Error(`Remote has no branch ${branch} — run the first push in a terminal`)
  if (remote === local) return 'Already up to date'
  if (!(await hasObject(remote))) {
    throw new Error('Remote has commits unknown locally — pull first')
  }
  if (!(await isAncestor(remote, local))) {
    throw new Error('Local and remote have diverged — please resolve in a terminal')
  }

  // Linear chain remote..local (merge commits allowed when their other
  // parents are already on the remote).
  const chain: string[] = []
  let cursor = local
  while (cursor !== remote) {
    chain.push(cursor)
    const { commit } = await git.readCommit({ ...base(), oid: cursor })
    if (commit.gpgsig) {
      throw new Error("Commits with a GPG signature can't be mirrored via the API — please push in a terminal")
    }
    const [first, ...rest] = commit.parent
    for (const p of rest) {
      if (!(await isAncestor(p, remote))) {
        throw new Error('History contains a complex merge — please push in a terminal')
      }
    }
    if (!first) throw new Error("Reached the root commit without encountering the remote HEAD — please push in a terminal")
    cursor = first
    if (chain.length > 200) throw new Error('Too many commits to push (>200) — please push in a terminal')
  }

  chain.reverse()
  for (let i = 0; i < chain.length; i++) {
    const oid = chain[i]
    progress(`Pushing commit ${i + 1}/${chain.length}`)
    const { commit } = await git.readCommit({ ...base(), oid })
    await pushTree(ctx, commit.tree, progress)
    const res = await api(ctx, 'POST', '/git/commits', {
      message: commit.message,
      tree: commit.tree,
      parents: commit.parent,
      author: {
        name: commit.author.name,
        email: commit.author.email,
        date: gitTimeToIso(commit.author.timestamp, commit.author.timezoneOffset),
      },
      committer: {
        name: commit.committer.name,
        email: commit.committer.email,
        date: gitTimeToIso(commit.committer.timestamp, commit.committer.timezoneOffset),
      },
    })
    if (res.sha !== oid) {
      throw new Error(
        `commit sha mismatch (expected ${oid.slice(0, 7)}, got ${String(res.sha).slice(0, 7)}) — please push in a terminal`,
      )
    }
  }

  progress('Updating remote ref…')
  await api(ctx, 'PATCH', `/git/refs/${encodeURIComponent(`heads/${branch}`)}`, {
    sha: local,
    force: false,
  })
  await git.writeRef({ ...base(), ref: `refs/remotes/origin/${branch}`, value: local, force: true })
  return `Pushed ${chain.length} commit(s) (${local.slice(0, 7)})`
}
