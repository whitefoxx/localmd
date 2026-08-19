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
    // 404/422: object absent. 409 "Git Repository is empty": no commits yet —
    // the object can't exist, so an existence check is safely "not present".
    if (e instanceof GithubError && (e.status === 404 || e.status === 422 || e.status === 409)) {
      return false
    }
    throw e
  }
}

export interface CreatedRepo extends GithubRepo {
  private: boolean
  htmlUrl: string
  cloneUrl: string
}

/** Create a repository owned by the authenticated user (the token's owner) and
 *  return its identity + URLs. `auto_init: false` keeps it empty so a first
 *  push mirrors the local history verbatim (see push()). Requires a token whose
 *  scope allows repo creation (fine-grained: "Administration" write). */
export async function createRepo(
  token: string,
  name: string,
  opts: { private?: boolean; description?: string } = {},
): Promise<CreatedRepo> {
  const resp = await fetch(`${API}/user/repos`, {
    method: 'POST',
    headers: {
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      name,
      private: opts.private ?? true,
      auto_init: false,
      ...(opts.description ? { description: opts.description } : {}),
    }),
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
  const data = (await resp.json()) as {
    name: string
    private: boolean
    owner: { login: string }
    html_url: string
    clone_url: string
  }
  return {
    owner: data.owner.login,
    repo: data.name,
    private: data.private,
    htmlUrl: data.html_url,
    cloneUrl: data.clone_url,
  }
}

export type GithubOp = 'create' | 'push' | 'pull'

/** Turn a failed GitHub API call into an actionable message: the base error plus
 *  guidance about the fine-grained-token settings that usually cause it. GitHub
 *  returns 404 (not 403) for repos outside a fine-grained token's Repository
 *  access, so a "not found" on push is almost always a token-scope problem. */
export function explainGithubError(err: unknown, op: GithubOp, repo?: string): string {
  const base = err instanceof Error ? err.message : String(err)
  const raw = (err as { status?: unknown })?.status
  const status = typeof raw === 'number' ? raw : null
  const named = repo ? `“${repo}”` : 'this repo'
  let hint = ''
  if (status === 401) {
    hint =
      'The token is invalid or expired — create a new fine-grained token on GitHub (Settings → Developer settings → Fine-grained tokens) and paste it into Settings → Git & GitHub.'
  } else if (status === 403 && op === 'create') {
    hint =
      'The token isn’t allowed to create repositories. Give it Administration: Read and write, and set Repository access to “All repositories” (a token limited to “Only select repositories” can’t create a new one, since it isn’t in the list yet).'
  } else if (status === 403) {
    hint = `The token can’t write to ${named}. Grant Contents: Read and write, and make sure Repository access includes it — either “All repositories”, or add ${named} under “Only select repositories”.`
  } else if (status === 404) {
    hint = `GitHub can’t see ${named} with this token. Fine-grained tokens return 404 (not 403) for repos outside their Repository access, so add ${named} under “Only select repositories” (or switch to “All repositories”) and grant Contents + Metadata: Read${op === 'pull' ? '' : ' and write'}.`
  } else if (status === 422 && op === 'create') {
    hint =
      'A repository with that name already exists on your account — pick a different name, or attach the existing one with git_remote_add instead of creating it.'
  }
  return hint ? `${base}\n${hint}` : base
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

/** The remote branch's head sha, or null when the branch (or the repo) is
 *  empty. Exported so the git panel can say WHICH commits a push would send —
 *  the answer is only knowable from the remote, so it costs one API call and
 *  is asked at panel-open and after a commit, never on the routine refresh
 *  that follows every write. */
export async function remoteHead(ctx: Ctx, branch: string): Promise<string | null> {
  try {
    const ref = await api(ctx, 'GET', `/git/ref/${encodeURIComponent(`heads/${branch}`)}`)
    return (ref.object as { sha: string }).sha
  } catch (e) {
    // 404 = branch absent; 409 = repository is entirely empty (no commits yet).
    if (e instanceof GithubError && (e.status === 404 || e.status === 409)) return null
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

/** GitHub's Git Data API refuses to create objects (blob/tree/commit) in a
 *  repository with no commits — it returns 409 "Git Repository is empty". Seed
 *  such a repo with one throwaway commit via the Contents API so the object
 *  endpoints work; push() then force-moves the branch onto the reconstructed
 *  local history, leaving the seed commit dangling (never in the branch). */
async function seedEmptyRepo(ctx: Ctx, progress: Progress): Promise<void> {
  progress('Initializing the empty repository…')
  await api(ctx, 'PUT', '/contents/.git-init', {
    message: 'chore: initialize repository',
    content: bytesToB64(new TextEncoder().encode('placeholder — replaced by the initial push\n')),
  })
}

/** Fast-forward push (mirrors local commits through the API). */
export async function push(ctx: Ctx, progress: Progress = () => {}): Promise<string> {
  const { git, base } = raw
  const branch = (await currentBranch()) ?? 'main'
  const local = await headOid()
  if (!local) throw new Error('No local commits yet')
  const remote = await remoteHead(ctx, branch)
  if (remote === local) return 'Already up to date'
  // First push to an empty repo (no remote branch): upload the whole history
  // and CREATE the ref, instead of bouncing the user to a terminal.
  const firstPush = remote === null
  if (!firstPush) {
    if (!(await hasObject(remote))) {
      throw new Error('Remote has commits unknown locally — pull first')
    }
    if (!(await isAncestor(remote, local))) {
      throw new Error('Local and remote have diverged — please resolve in a terminal')
    }
  }

  // Commits to upload: remote-exclusive..local for a normal fast-forward, or the
  // entire history back to the root commit for a first push. Merge commits are
  // allowed on a normal push when their other parents are already on the remote;
  // a first push only supports linear history (bail to a terminal otherwise).
  const chain: string[] = []
  let cursor: string | undefined = local
  while (cursor && cursor !== remote) {
    chain.push(cursor)
    const { commit } = await git.readCommit({ ...base(), oid: cursor })
    if (commit.gpgsig) {
      throw new Error("Commits with a GPG signature can't be mirrored via the API — please push in a terminal")
    }
    const [first, ...rest] = commit.parent
    if (firstPush) {
      if (rest.length) {
        throw new Error('History has a merge commit — please run the first push to this repo in a terminal')
      }
    } else {
      for (const p of rest) {
        if (!(await isAncestor(p, remote))) {
          throw new Error('History contains a complex merge — please push in a terminal')
        }
      }
      if (!first) throw new Error("Reached the root commit without encountering the remote HEAD — please push in a terminal")
    }
    cursor = first
    if (chain.length > 200) throw new Error('Too many commits to push (>200) — please push in a terminal')
  }

  // An empty repo must be made non-empty before the Git Data API accepts any
  // object writes (see seedEmptyRepo). Do it up front, before the upload loop.
  if (firstPush) await seedEmptyRepo(ctx, progress)

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
  if (firstPush) {
    // Seeding created the repo's default branch. If it's our branch, force it
    // onto the reconstructed history (dropping the seed commit); otherwise our
    // branch doesn't exist yet, so create it.
    const seeded = await remoteHead(ctx, branch)
    if (seeded) {
      await api(ctx, 'PATCH', `/git/refs/${encodeURIComponent(`heads/${branch}`)}`, {
        sha: local,
        force: true,
      })
    } else {
      await api(ctx, 'POST', '/git/refs', { ref: `refs/heads/${branch}`, sha: local })
    }
  } else {
    await api(ctx, 'PATCH', `/git/refs/${encodeURIComponent(`heads/${branch}`)}`, {
      sha: local,
      force: false,
    })
  }
  await git.writeRef({ ...base(), ref: `refs/remotes/origin/${branch}`, value: local, force: true })
  return firstPush
    ? `Pushed ${chain.length} commit(s) to a new ${branch} branch (${local.slice(0, 7)})`
    : `Pushed ${chain.length} commit(s) (${local.slice(0, 7)})`
}
