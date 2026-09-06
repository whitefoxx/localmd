/**
 * The confirm contract for localmd Connect's write surface.
 *
 * The extension does not gate writes: it trusts this app's UI, per "the agent
 * proposes; the user disposes". That makes this gate the front line — before a
 * call reaches the extension, three shapes of call must have the user's explicit
 * approval:
 *
 *   1. `eval_js` carrying `allow_write: true` — a snippet the agent flagged as
 *      writing on a real site. The extension's own guard refuses such a write
 *      without the flag; this gate turns the flag into an explicit confirmation,
 *      showing the exact code.
 *
 *   A write done through an INTERACTION whose intent only the extension can see —
 *   a `click` on a write control (a Post/Send/Submit/Delete button), a `press_key`
 *   Cmd/Ctrl+Enter (the post/send shortcut) — is gated too, but result-side
 *   rather than here: the dispatch seam strips allow_write on the first call so
 *   the extension's guard always evaluates, then confirms with the label the
 *   extension resolved (see `parseWriteBlockedControl` / `confirmWriteResult`).
 *   That keeps the label meaningful and stops the agent self-approving a write.
 *   2. `run_adapter` on an adapter whose marketplace row says `access: write` —
 *      the LEGACY marketplace path, kept gated only while the extension still
 *      exposes `run_adapter` (its retirement is web-agent P5-B). The prompt no
 *      longer steers the agent here, but the tool stays reachable via the
 *      deferred catalog, so the gate must stay until the tool itself is gone.
 *   3. `create_site_script` carrying `css` and/or `js` — persistent code
 *      injected into the user's pages on every visit. Hide-only rules
 *      (`hide_selectors`) are persistent too, so they confirm as well, just
 *      with lighter copy and no code block.
 *
 * Adapter access is learned from `find_adapters` results: every result that
 * passes through the dispatch seam feeds the cache (noteConnectResult), and a
 * `run_adapter` whose adapter is not in the cache runs its own `find_adapters`
 * lookup. An adapter whose access still cannot be determined is treated as
 * write — the gate fails closed, never open.
 *
 * The user's standing fallback lives in the extension popup (pause or delete
 * any script); this gate is the front line, not the only line.
 */
import { useSetupStore } from '@/stores/setup'
import { t } from '@/i18n'

const EVAL_JS = 'generic__eval_js'
const FIND_ADAPTERS = 'generic__find_adapters'
const RUN_ADAPTER = 'generic__run_adapter'
const CREATE_SITE_SCRIPT = 'generic__create_site_script'

type AdapterAccess = 'read' | 'write'

/** serverId + site + name → access, learned from find_adapters rows. Never
 *  cleared on its own: adapters are sha-pinned per session on the extension
 *  side, and a stale 'write' only over-asks, never under-asks. */
const accessCache = new Map<string, AdapterAccess>()

function accessKey(serverId: string, site: unknown, name: unknown): string {
  const norm = (v: unknown): string => String(v ?? '').trim().toLowerCase()
  return `${serverId}\u0000${norm(site)}\u0000${norm(name)}`
}

export function clearAdapterAccessCache(): void {
  accessCache.clear()
}

export interface AdapterRow {
  site: string
  name: string
  access: AdapterAccess
}

/**
 * Pull adapter rows out of a find_adapters result, whatever JSON shape it
 * chose: a bare array of rows, or rows nested under any key. A result that is
 * not JSON (an error line, prose) yields nothing — the gate then falls back to
 * its own lookup, and past that to fail-closed.
 */
export function parseAdapterRows(out: string): AdapterRow[] {
  let parsed: unknown
  try {
    parsed = JSON.parse(out)
  } catch {
    return []
  }
  const rows: AdapterRow[] = []
  const visit = (node: unknown): void => {
    if (Array.isArray(node)) {
      for (const item of node) visit(item)
      return
    }
    if (!node || typeof node !== 'object') return
    const o = node as Record<string, unknown>
    if (typeof o.site === 'string' && typeof o.name === 'string' && typeof o.access === 'string') {
      const access = o.access.trim().toLowerCase()
      if (access === 'read' || access === 'write') {
        rows.push({ site: o.site, name: o.name, access })
        return
      }
    }
    for (const v of Object.values(o)) visit(v)
  }
  visit(parsed)
  return rows
}

/** Feed the access cache from a tool result on its way back to the model.
 *  Call for every localmd Connect result; anything but find_adapters is a
 *  no-op. */
export function noteConnectResult(serverId: string, tool: string, out: string): void {
  if (tool !== FIND_ADAPTERS) return
  for (const row of parseAdapterRows(out)) {
    accessCache.set(accessKey(serverId, row.site, row.name), row.access)
  }
}

function asList(v: unknown): string {
  if (Array.isArray(v)) return v.map((x) => String(x)).join(', ')
  return v === undefined || v === null ? '' : String(v)
}

/** Adapter args as the card shows them: pretty JSON when they parse, verbatim
 *  when they do not — what runs is what the user must see. */
function prettyArgs(v: unknown): string {
  const value = typeof v === 'string' ? safeParse(v) ?? v : v
  if (value === undefined) return '{}'
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

function safeParse(s: string): unknown {
  try {
    return JSON.parse(s)
  } catch {
    return undefined
  }
}

export interface ScriptGate {
  /** 'code' = injects css/js: full-strength confirm, exact code shown.
   *  'hide' = selectors only: still persistent, so still confirmed — lighter. */
  level: 'code' | 'hide'
  detail: string
}

/** What a create_site_script call must show the user before it runs. */
export function siteScriptGate(args: Record<string, unknown>): ScriptGate {
  const css = typeof args.css === 'string' ? args.css.trim() : ''
  const js = typeof args.js === 'string' ? args.js.trim() : ''
  const hide = asList(args.hide_selectors)
  const lines = [`matches: ${asList(args.matches) || '(none)'}`]
  if (hide) lines.push(`hide: ${hide}`)
  if (css) lines.push('', 'css:', css)
  if (js) lines.push('', 'js:', js)
  return { level: css || js ? 'code' : 'hide', detail: lines.join('\n') }
}

export interface ConnectCallContext {
  sessionId: string
  serverId: string
  /** The tool's bare name on the server (no mcp__ prefix). */
  tool: string
  args: Record<string, unknown>
  /** Runs a tool on the same server — the gate's own access lookup. */
  callTool: (tool: string, args: Record<string, unknown>) => Promise<string>
}

/**
 * The gate itself. Returns null when the call may proceed (read tools, a read
 * eval_js, a read adapter, or the user confirmed) and the model-facing refusal
 * when the user declined. A decline is a choice, not a failure, so it does not
 * read as an Error — but it does forbid a retry.
 */
export async function confirmConnectCall(ctx: ConnectCallContext): Promise<string | null> {
  if (ctx.tool === CREATE_SITE_SCRIPT) return confirmSiteScript(ctx)
  if (ctx.tool === EVAL_JS) return confirmEvalWrite(ctx)
  if (ctx.tool === RUN_ADAPTER) return confirmRunAdapter(ctx)
  return null
}

async function confirmSiteScript(ctx: ConnectCallContext): Promise<string | null> {
  const gate = siteScriptGate(ctx.args)
  const code = gate.level === 'code'
  const outcome = await useSetupStore().ask({
    id: crypto.randomUUID(),
    sessionId: ctx.sessionId,
    kind: 'confirm',
    label: t(code ? 'chat.connectScriptCode' : 'chat.connectScriptHide'),
    help: t(code ? 'chat.connectScriptCodeHelp' : 'chat.connectScriptHideHelp'),
    detail: gate.detail,
  })
  if (outcome === 'confirmed') return null
  return 'The user declined to install this site script. Do not retry it — say what stays undone, and ask what they would prefer.'
}

/**
 * A read eval_js (no `allow_write`) passes untouched — the perception half of
 * reaching a site must stay friction-free. A snippet flagged `allow_write:true`
 * is a real write on the user's logged-in session: show the exact code and make
 * the user approve it before it runs.
 */
async function confirmEvalWrite(ctx: ConnectCallContext): Promise<string | null> {
  if (ctx.args.allow_write !== true) return null
  const code = typeof ctx.args.code === 'string' ? ctx.args.code : String(ctx.args.code ?? '')
  const outcome = await useSetupStore().ask({
    id: crypto.randomUUID(),
    sessionId: ctx.sessionId,
    kind: 'confirm',
    label: t('chat.connectEvalWrite'),
    help: t('chat.connectEvalWriteHelp'),
    detail: code,
  })
  if (outcome === 'confirmed') return null
  return 'The user declined to run this write. Do not retry it — continue with read-only work, or ask what they would prefer.'
}

/**
 * A write-guarded interaction (a `click` on a write control, a `press_key`
 * Cmd/Ctrl+Enter) the extension refused comes back `write_blocked` with a human
 * label only the extension could name. Returns that label, or null for an
 * ordinary result. The seam uses it to confirm with a MEANINGFUL card, then
 * re-runs with allow_write — the opaque locator the agent passed never reaches
 * the user.
 */
export function parseWriteBlockedControl(out: string): string | null {
  try {
    const o = JSON.parse(out)
    if (o && typeof o === 'object' && (o as Record<string, unknown>).write_blocked === true) {
      const control = (o as Record<string, unknown>).control
      return typeof control === 'string' && control.trim() ? control.trim() : 'the control'
    }
  } catch {
    /* not JSON — an ordinary string result */
  }
  return null
}

/** Confirm a write the extension flagged, showing the label IT resolved (the
 *  "Post" control, "Cmd+Enter (submit)"). null = proceed (re-run with
 *  allow_write); a message = the user declined. */
export async function confirmWriteResult(sessionId: string, control: string): Promise<string | null> {
  const outcome = await useSetupStore().ask({
    id: crypto.randomUUID(),
    sessionId,
    kind: 'confirm',
    label: t('chat.connectWriteAction'),
    help: t('chat.connectWriteActionHelp'),
    detail: control,
  })
  if (outcome === 'confirmed') return null
  return 'The user declined this action. Do not retry it — continue with read-only work, or ask what they would prefer.'
}

async function confirmRunAdapter(ctx: ConnectCallContext): Promise<string | null> {
  const site = String(ctx.args.site ?? '')
  const name = String(ctx.args.name ?? '')
  const key = accessKey(ctx.serverId, site, name)
  let access = accessCache.get(key)
  if (!access && site) {
    // The agent skipped find_adapters, or its result never parsed: look the
    // adapter up ourselves rather than bothering the user about a read.
    try {
      noteConnectResult(ctx.serverId, FIND_ADAPTERS, await ctx.callTool(FIND_ADAPTERS, { query: site }))
    } catch {
      /* unknown stays unknown — and unknown confirms */
    }
    access = accessCache.get(key)
  }
  if (access === 'read') return null
  const outcome = await useSetupStore().ask({
    id: crypto.randomUUID(),
    sessionId: ctx.sessionId,
    kind: 'confirm',
    label: t('chat.connectRunAdapter', { site, name }),
    help: t(access === 'write' ? 'chat.connectRunAdapterHelp' : 'chat.connectRunAdapterUnknownHelp'),
    detail: `run_adapter ${site}/${name}\nargs: ${prettyArgs(ctx.args.args)}`,
  })
  if (outcome === 'confirmed') return null
  return 'The user declined to run this adapter. Do not retry it — continue with read-only work, or ask what they would prefer.'
}
