/**
 * Declarative HTTP tools — an agent tool described as DATA, not code.
 *
 * A spec carries everything the runtime needs: the model-facing name and
 * description, the parameters (rendered into a JSON Schema), a request template,
 * and how to shape the response down to something worth spending tokens on.
 * That single format serves three callers: the recommended-tool catalog
 * (`toolCatalog.ts`), the Settings editor where a user hand-writes one, and the
 * agent itself when it authors one on request — none of which could exist if a
 * tool were a `defineTool` call compiled into the bundle.
 *
 * Two transports, because the browser can't reach most of the web on its own:
 *   - `direct` — plain fetch(); only works when the endpoint sends CORS headers.
 *   - `extension` — routed through localmd Connect's generic__fetch_url, which
 *     runs in a service worker with <all_urls> and the user's cookies: no CORS
 *     limit and a logged-in session. `auto` tries direct and falls back.
 *
 * Security invariants (a tool can be authored by a model, so these are load-
 * bearing, not hygiene):
 *   - The request ORIGIN is static. A placeholder may never appear in the
 *     scheme/host, so no argument can retarget a tool at another server.
 *   - https only.
 *   - Placeholders are substituted in ONE pass and the output is never
 *     re-scanned, so an argument's own text can't become a `{{secret:…}}`.
 *   - Argument values are escaped for the position they land in (URL-encoded in
 *     the URL, JSON- or form-escaped in the body, control chars stripped in
 *     headers).
 *   - Secrets are resolved from settings by id and never travel through args,
 *     tool results, or error messages (see `redactedUrl`).
 */
import { decodeDdgLinks } from '@/lib/webread'

export type HttpParamType = 'string' | 'number' | 'boolean'

export interface HttpToolParam {
  type: HttpParamType
  /** Shown to the model in the JSON Schema — the only hint it gets. */
  description?: string
  required?: boolean
  default?: string | number | boolean
}

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'

export interface HttpToolRequest {
  method: HttpMethod
  /** https URL with `{{param}}` / `{{secret:id}}` placeholders. Origin static. */
  url: string
  headers?: Record<string, string>
  /** Request body template; ignored for GET/HEAD. */
  body?: string
  /** How placeholders inside `body` are escaped. Default 'json'. */
  bodyType?: 'json' | 'form'
}

export interface HttpToolResponse {
  /** text: hand back the body (after `transform`). json/xml: parse → pick →
   *  render, both through the same path grammar. */
  mode: 'text' | 'json' | 'xml'
  /** Path to the interesting part, e.g. "results[]" or "data.items[]".
   *  Alternatives may be separated by "|"; the first that matches wins, which
   *  is how one feed tool serves both RSS and Atom. */
  pick?: string
  /** Per-item line template with `{{field}}` / `{{nested.field}}` lookups. */
  template?: string
  /** Named post-processor from TRANSFORMS, applied to the final text. */
  transform?: string
}

export interface HttpToolSpec {
  /** Stable identity for storage/UI; not shown to the model. */
  id: string
  /** Model-facing tool name: [a-z][a-z0-9_]*. */
  name: string
  description: string
  params: Record<string, HttpToolParam>
  request: HttpToolRequest
  response: HttpToolResponse
  /** Result budget in characters. Default DEFAULT_MAX_CHARS. */
  maxChars?: number
  transport?: 'direct' | 'extension' | 'auto'
  /** Marks a tool that reads arbitrary web content, so the system prompt knows
   *  the agent has web access at all. */
  web?: boolean
  /**
   * Groups the tools of one integration ("weread", "notion") so the user meets
   * them as the thing they asked for rather than as eight unrelated rows —
   * approved once, listed once, removed once. Free-form; the UI only groups by
   * equality.
   */
  bundle?: string
  /**
   * The destination is an argument, not a fixed host — a feed reader, where
   * naming one origin would defeat the point.
   *
   * FIRST-PARTY ONLY: normalizeHttpTool strips this, so a spec from the KB
   * file, the Settings editor or a model can never set it; only a catalog
   * literal can. It also may not combine with {{secret:…}}, so an open
   * destination can never carry the user's keys. The capability itself is not
   * new — web_fetch already takes any URL — but the static-origin rule stays
   * absolute exactly where it earns its keep: specs we did not write.
   */
  anyOrigin?: boolean
}

export const DEFAULT_MAX_CHARS = 20_000
const MAX_DESCRIPTION = 1024

/** Named post-processors a spec may reference by name. Kept tiny and closed:
 *  first-party catalog entries occasionally need cleanup no template can express
 *  (DuckDuckGo's redirect wrappers and ad rows), and a name in the spec is far
 *  safer than letting a spec carry executable code. */
export const TRANSFORMS: Record<string, (s: string) => string> = {
  'ddg-links': decodeDdgLinks,
  'strip-html': stripHtml,
}

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—',
}

/** Decode the entities that actually survive into API text and XML feeds. */
export function decodeEntities(s: string): string {
  return String(s ?? '').replace(/&(#\d+|#x[0-9a-f]+|[a-z]+);/gi, (whole, ref: string) => {
    if (ref.startsWith('#')) {
      const code =
        ref[1] === 'x' || ref[1] === 'X' ? parseInt(ref.slice(2), 16) : parseInt(ref.slice(1), 10)
      return Number.isFinite(code) && code > 0 ? String.fromCodePoint(code) : whole
    }
    return NAMED_ENTITIES[ref.toLowerCase()] ?? whole
  })
}

/** Drop tags and decode entities (Wikipedia's search excerpts wrap matches in
 *  <span>, Crossref deposits abstracts as JATS XML). Markup the model can't use
 *  is markup the user pays for. */
export function stripHtml(s: string): string {
  return decodeEntities(String(s ?? '').replace(/<[^>]*>/g, ''))
}

/* ── validation / normalization ──────────────────────────────────────────── */

/** Model-facing tool names share a namespace with the built-ins, so keep them
 *  to the same shape and let the registry reject collisions. */
export function sanitizeToolName(raw: string): string {
  const s = String(raw ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 48)
  return /^[a-z]/.test(s) ? s : ''
}

/**
 * The request's fixed origin, or null when the template doesn't have one.
 * Rejects http://, and any placeholder in the scheme/host — that is the check
 * that keeps a tool pointed at the server it was approved for.
 */
export function staticOrigin(url: string): string | null {
  const m = /^https:\/\/([a-z0-9.-]+(?::\d+)?)(?=[/?#]|$)/i.exec(String(url ?? '').trim())
  return m ? `https://${m[1].toLowerCase()}` : null
}

function normalizeParams(raw: unknown): Record<string, HttpToolParam> {
  const out: Record<string, HttpToolParam> = {}
  if (!raw || typeof raw !== 'object') return out
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!/^[a-zA-Z][a-zA-Z0-9_]*$/.test(key)) continue
    const v = (value ?? {}) as Record<string, unknown>
    const type: HttpParamType =
      v.type === 'number' ? 'number' : v.type === 'boolean' ? 'boolean' : 'string'
    out[key] = {
      type,
      ...(v.description ? { description: String(v.description) } : {}),
      ...(v.required === true ? { required: true } : {}),
      ...(v.default !== undefined && v.default !== null
        ? { default: v.default as string | number | boolean }
        : {}),
    }
  }
  return out
}

function normalizeHeaders(raw: unknown): Record<string, string> | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    // A header name with a control char or separator would let a template split
    // the request; drop rather than sanitize so the author notices.
    if (!/^[A-Za-z0-9!#$%&'*+.^_`|~-]+$/.test(k)) continue
    out[k] = String(v ?? '')
  }
  return Object.keys(out).length ? out : undefined
}

const METHODS: HttpMethod[] = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE']

/**
 * Parse an untrusted spec (settings JSON, a KB file, or a model's proposal).
 * Returns null when the spec could never run — a missing name, a non-https or
 * templated origin — so callers can drop it without a separate validity pass.
 */
export function normalizeHttpTool(raw: unknown, makeId?: () => string): HttpToolSpec | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const name = sanitizeToolName(String(r.name ?? ''))
  if (!name) return null

  const req = (r.request ?? {}) as Record<string, unknown>
  const url = String(req.url ?? '').trim()
  if (!staticOrigin(url)) return null

  const method = String(req.method ?? 'GET').toUpperCase() as HttpMethod
  const headers = normalizeHeaders(req.headers)
  const res = (r.response ?? {}) as Record<string, unknown>
  const transform = typeof res.transform === 'string' && res.transform in TRANSFORMS
    ? res.transform
    : undefined
  const maxChars = Number(r.maxChars)

  return {
    id: typeof r.id === 'string' && r.id ? r.id : (makeId?.() ?? name),
    name,
    description: String(r.description ?? '').slice(0, MAX_DESCRIPTION),
    params: normalizeParams(r.params),
    request: {
      method: METHODS.includes(method) ? method : 'GET',
      url,
      ...(headers ? { headers } : {}),
      ...(req.body ? { body: String(req.body) } : {}),
      ...(req.bodyType === 'form' ? { bodyType: 'form' as const } : {}),
    },
    response: {
      mode: res.mode === 'json' ? 'json' : res.mode === 'xml' ? 'xml' : 'text',
      ...(res.pick ? { pick: String(res.pick) } : {}),
      ...(res.template ? { template: String(res.template) } : {}),
      ...(transform ? { transform } : {}),
    },
    ...(Number.isFinite(maxChars) && maxChars > 0
      ? { maxChars: Math.min(200_000, Math.trunc(maxChars)) }
      : {}),
    ...(r.transport === 'extension' || r.transport === 'direct' || r.transport === 'auto'
      ? { transport: r.transport }
      : {}),
    ...(r.web === true ? { web: true } : {}),
    ...(typeof r.bundle === 'string' && r.bundle.trim()
      ? { bundle: r.bundle.trim().slice(0, 40) }
      : {}),
  }
}

/** Group specs by bundle, keeping ungrouped tools each in their own group so a
 *  caller can render one list. Order follows first appearance. */
export function groupByBundle(
  specs: readonly HttpToolSpec[],
): Array<{ bundle: string | null; tools: HttpToolSpec[] }> {
  const groups: Array<{ bundle: string | null; tools: HttpToolSpec[] }> = []
  const byName = new Map<string, { bundle: string | null; tools: HttpToolSpec[] }>()
  for (const spec of specs) {
    if (!spec.bundle) {
      groups.push({ bundle: null, tools: [spec] })
      continue
    }
    const existing = byName.get(spec.bundle)
    if (existing) {
      existing.tools.push(spec)
      continue
    }
    const group = { bundle: spec.bundle, tools: [spec] }
    byName.set(spec.bundle, group)
    groups.push(group)
  }
  return groups
}

/** KB-level tool file: tool-neutral location, travels with the KB via git —
 *  which is exactly why the store makes the user trust it once per KB. */
export const KB_TOOLS_CONFIG_PATH = '.agents/tools.json'

/** Parse a list of specs from settings storage or a KB file; invalid entries
 *  are dropped rather than failing the batch (a hand-edited file must never
 *  cost the user their working tools). */
export function normalizeHttpToolList(raw: unknown, makeId?: () => string): HttpToolSpec[] {
  if (!Array.isArray(raw)) return []
  const out: HttpToolSpec[] = []
  for (const item of raw) {
    const spec = normalizeHttpTool(item, makeId)
    if (spec) out.push(spec)
  }
  return out
}

/**
 * A change detector for a KB's tool file — NOT an integrity check. It answers
 * "is this the same set the user already approved?", so it covers exactly what
 * a re-approval should trigger on: which tools exist and where they send data.
 */
export function toolsFingerprint(specs: readonly HttpToolSpec[]): string {
  return specs
    .map((s) => `${s.name}|${s.request.method}|${staticOrigin(s.request.url) ?? '?'}`)
    .sort()
    .join('\n')
}

/** Keep the first tool of each name — callers pass the most specific scope
 *  first (KB over global over catalog), matching how MCP servers merge. */
export function dedupeByName(specs: readonly HttpToolSpec[]): HttpToolSpec[] {
  const seen = new Set<string>()
  return specs.filter((s) => (seen.has(s.name) ? false : (seen.add(s.name), true)))
}

/** Every `{{secret:id}}` a spec references — what the UI must collect and what
 *  a KB-scoped tool is allowed to name (never the value itself). */
export function secretRefs(spec: HttpToolSpec): string[] {
  const seen = new Set<string>()
  const scan = (s: string | undefined): void => {
    for (const m of String(s ?? '').matchAll(PLACEHOLDER)) {
      if (m[1].startsWith('secret:')) seen.add(m[1].slice('secret:'.length))
    }
  }
  scan(spec.request.url)
  scan(spec.request.body)
  for (const v of Object.values(spec.request.headers ?? {})) scan(v)
  return [...seen]
}

/** The tool's parameters as JSON Schema, for the model. */
export function httpToolJsonSchema(spec: HttpToolSpec): Record<string, unknown> {
  const properties: Record<string, unknown> = {}
  const required: string[] = []
  for (const [key, p] of Object.entries(spec.params)) {
    properties[key] = {
      type: p.type,
      ...(p.description ? { description: p.description } : {}),
    }
    if (p.required && p.default === undefined) required.push(key)
  }
  return {
    type: 'object',
    properties,
    ...(required.length ? { required } : {}),
    additionalProperties: false,
  }
}

/* ── templating ──────────────────────────────────────────────────────────── */

/** `{{param}}`, `{{secret:id}}`, and inside an item template the full pickPath
 *  grammar — `{{author[].family}}`, `{{issued.date-parts.0.0}}`. */
const PLACEHOLDER = /\{\{\s*([a-zA-Z0-9_.:[\]-]+)\s*\}\}/g

/**
 * Substitute placeholders in ONE pass. The result is never re-scanned, so a
 * value that itself contains `{{secret:x}}` stays literal text.
 */
export function renderTemplate(tpl: string, resolve: (key: string) => string): string {
  return String(tpl ?? '').replace(PLACEHOLDER, (_whole, key: string) => resolve(key))
}

function coerce(value: unknown, type: HttpParamType): string {
  if (value === undefined || value === null) return ''
  if (type === 'boolean') return value === true || value === 'true' ? 'true' : 'false'
  if (type === 'number') {
    const n = Number(value)
    return Number.isFinite(n) ? String(n) : ''
  }
  return typeof value === 'string' ? value : JSON.stringify(value)
}

export interface BuiltRequest {
  method: HttpMethod
  url: string
  headers: Record<string, string>
  body?: string
  /** Same URL with secret values masked — safe for errors and the UI. */
  redactedUrl: string
}

export class HttpToolError extends Error {}

type Slot = 'url' | 'urlwhole' | 'json' | 'form' | 'header'

/** Escape a value for the slot it lands in. */
function escapeFor(where: Slot, v: string): string {
  if (where === 'url' || where === 'form') return encodeURIComponent(v)
  if (where === 'json') return JSON.stringify(v).slice(1, -1)
  // urlwhole: the argument IS the destination (anyOrigin), so percent-encoding
  // it would destroy the URL. Strip only what could smuggle in another request;
  // the result is validated as https by buildRequest.
  if (where === 'urlwhole') return v.trim().replace(/[\s\r\n\0"'<>\\^`{}|]/g, '')
  return v.replace(/[\r\n\0]/g, '') // header: no request splitting
}

/**
 * Render a spec + arguments into a concrete request. Throws HttpToolError for
 * anything the caller should surface to the model (missing argument, unresolved
 * secret) rather than retry.
 */
export function buildRequest(
  spec: HttpToolSpec,
  args: Record<string, unknown>,
  resolveSecret: (id: string) => string | undefined,
): BuiltRequest {
  const origin = staticOrigin(spec.request.url)
  if (!origin && !spec.anyOrigin) {
    throw new HttpToolError(`tool "${spec.name}" has no fixed https origin`)
  }
  if (spec.anyOrigin && secretRefs(spec).length) {
    throw new HttpToolError(
      `tool "${spec.name}" may not combine an open destination with a stored key`,
    )
  }
  const urlSlot: Slot = spec.anyOrigin ? 'urlwhole' : 'url'

  // One resolver, several escapings. `redact` swaps secret values for *** so the
  // same template renders a loggable twin of the real URL.
  const make =
    (where: Slot, redact: boolean) =>
    (key: string): string => {
      if (key.startsWith('secret:')) {
        const id = key.slice('secret:'.length)
        const value = resolveSecret(id)
        if (value === undefined || value === '') {
          throw new HttpToolError(
            `tool "${spec.name}" needs the "${id}" key — add it in Settings → Tools`,
          )
        }
        return redact ? '***' : escapeFor(where, value)
      }
      const param = spec.params[key]
      if (!param) return ''
      const raw = args[key] ?? param.default
      if ((raw === undefined || raw === '') && param.required) {
        throw new HttpToolError(`tool "${spec.name}" requires the "${key}" argument`)
      }
      return escapeFor(where, coerce(raw, param.type))
    }

  const url = renderTemplate(spec.request.url, make(urlSlot, false))
  if (spec.anyOrigin) {
    // The caller chose the host, so the only guarantee left is the scheme.
    let parsed: URL | null = null
    try {
      parsed = new URL(url)
    } catch {
      /* handled below */
    }
    if (parsed?.protocol !== 'https:') {
      throw new HttpToolError(`tool "${spec.name}" needs a full https:// URL (got "${url.slice(0, 80)}")`)
    }
  } else if (staticOrigin(url) !== origin) {
    // Belt and braces: arguments are URL-encoded, so they cannot introduce a
    // host, but a template typo could. Verify what we actually built.
    throw new HttpToolError(`tool "${spec.name}" resolved to a different origin`)
  }

  const headers: Record<string, string> = {}
  for (const [k, v] of Object.entries(spec.request.headers ?? {})) {
    headers[k] = renderTemplate(v, make('header', false))
  }

  const bodyless = spec.request.method === 'GET' || spec.request.method === 'DELETE'
  const body =
    bodyless || !spec.request.body
      ? undefined
      : renderTemplate(spec.request.body, make(spec.request.bodyType === 'form' ? 'form' : 'json', false))
  if (body !== undefined && !headers['Content-Type'] && !headers['content-type']) {
    headers['Content-Type'] =
      spec.request.bodyType === 'form' ? 'application/x-www-form-urlencoded' : 'application/json'
  }

  return {
    method: spec.request.method,
    url,
    headers,
    ...(body !== undefined ? { body } : {}),
    redactedUrl: renderTemplate(spec.request.url, make(urlSlot, true)),
  }
}

/* ── XML → plain values ──────────────────────────────────────────────────── */

/**
 * Parse XML into the same plain objects `pick`/`template` already walk, so a
 * feed is shaped with the grammar JSON uses rather than a second one.
 *
 * Deliberately tolerant rather than conformant: this exists for Atom, RSS and
 * the handful of XML APIs that never got a JSON endpoint (arXiv), and a parse
 * that goes wrong degrades to the raw body — the same fallback a malformed JSON
 * response takes. That is why it is ~70 lines here instead of a DOM dependency
 * the browser bundle would have to carry.
 *
 * Namespace prefixes are dropped (`arxiv:primary_category` → `primary_category`)
 * for two reasons: paths stay readable, and a `:` in a placeholder would collide
 * with the `{{secret:…}}` form.
 */
interface XmlNode {
  name: string
  attrs: Record<string, string>
  children: XmlNode[]
  text: string
}

const localName = (raw: string): string => raw.slice(raw.indexOf(':') + 1)

function parseAttrs(source: string): Record<string, string> {
  const attrs: Record<string, string> = {}
  for (const m of source.matchAll(/([A-Za-z_:][-\w.:]*)\s*=\s*("([^"]*)"|'([^']*)')/g)) {
    attrs[localName(m[1])] = decodeEntities(m[3] ?? m[4] ?? '')
  }
  return attrs
}

export function parseXml(xml: string): XmlNode | null {
  const source = String(xml ?? '')
  const root: XmlNode = { name: '#root', attrs: {}, children: [], text: '' }
  const stack: XmlNode[] = [root]
  let i = 0
  while (i < source.length) {
    const lt = source.indexOf('<', i)
    if (lt < 0) break
    if (lt > i) stack[stack.length - 1].text += source.slice(i, lt)

    // Declarations, comments and CDATA: skip, except CDATA whose payload is text.
    if (source.startsWith('<![CDATA[', lt)) {
      const end = source.indexOf(']]>', lt)
      if (end < 0) break
      stack[stack.length - 1].text += source.slice(lt + 9, end)
      i = end + 3
      continue
    }
    if (source.startsWith('<!--', lt)) {
      const end = source.indexOf('-->', lt)
      i = end < 0 ? source.length : end + 3
      continue
    }
    if (source.startsWith('<?', lt) || source.startsWith('<!', lt)) {
      const end = source.indexOf('>', lt)
      i = end < 0 ? source.length : end + 1
      continue
    }

    const gt = source.indexOf('>', lt)
    if (gt < 0) break
    const inner = source.slice(lt + 1, gt)
    i = gt + 1

    if (inner.startsWith('/')) {
      // Close the matching element; an unmatched tag is ignored rather than fatal.
      const name = localName(inner.slice(1).trim())
      for (let d = stack.length - 1; d > 0; d--) {
        if (stack[d].name === name) {
          stack.length = d
          break
        }
      }
      continue
    }

    const selfClosing = inner.endsWith('/')
    const body = selfClosing ? inner.slice(0, -1) : inner
    const space = body.search(/\s/)
    const node: XmlNode = {
      name: localName((space < 0 ? body : body.slice(0, space)).trim()),
      attrs: space < 0 ? {} : parseAttrs(body.slice(space)),
      children: [],
      text: '',
    }
    stack[stack.length - 1].children.push(node)
    if (!selfClosing) stack.push(node)
  }
  return root.children.length ? root.children[0] : null
}

/** A node becomes its text when it is a plain leaf, else an object of children
 *  and attributes — so `{{title}}` reads a leaf directly while `{{link.0.href}}`
 *  still reaches an attribute. Repeated children collapse into arrays. */
export function xmlNodeToValue(node: XmlNode): unknown {
  const text = decodeEntities(node.text).trim()
  if (!node.children.length && !Object.keys(node.attrs).length) return text

  const out: Record<string, unknown> = { ...node.attrs }
  const seen = new Map<string, unknown[]>()
  for (const child of node.children) {
    const list = seen.get(child.name) ?? []
    list.push(xmlNodeToValue(child))
    seen.set(child.name, list)
  }
  // Children win over an attribute of the same name — the nested value is the
  // one a template almost certainly meant.
  for (const [name, values] of seen) out[name] = values.length === 1 ? values[0] : values
  if (text && !('value' in out)) out.value = text
  return out
}

/** Parsed XML as `{ <rootName>: … }`, so a pick reads like the document does
 *  (`feed.entry[]`, `rss.channel.item[]`). */
export function xmlToValue(xml: string): unknown {
  const root = parseXml(xml)
  return root ? { [root.name]: xmlNodeToValue(root) } : null
}

/* ── response shaping ────────────────────────────────────────────────────── */

/**
 * Resolve a dotted path, where a `[]` suffix on a segment means "map the rest
 * over this array" and an all-digits segment indexes into one. `results[]`,
 * `data.items[].title`, `issued.date-parts.0.0` and `[]` all work — the numeric
 * form is what makes APIs that box every field in an array (Crossref) readable.
 */
export function pickPath(data: unknown, path: string): unknown {
  const segments = String(path ?? '')
    .split('.')
    .map((s) => s.trim())
    .filter(Boolean)
  let current: unknown = data
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i]
    const isArray = seg.endsWith('[]')
    const key = isArray ? seg.slice(0, -2) : seg
    if (key) {
      if (current === null || typeof current !== 'object') return undefined
      current = /^\d+$/.test(key)
        ? (Array.isArray(current) ? current[Number(key)] : undefined)
        : (current as Record<string, unknown>)[key]
    }
    if (isArray) {
      if (current === undefined || current === null) return undefined
      // A lone element is a list of one. XML carries no arity — a feed with a
      // single <entry> must shape the same as a feed with twenty — and JSON
      // APIs that collapse one-element arrays get the same courtesy.
      const list = Array.isArray(current) ? current : [current]
      const rest = segments.slice(i + 1).join('.')
      if (!rest) return list
      return list.flatMap((item) => {
        const v = pickPath(item, rest)
        if (v === undefined) return []
        // A nested [] flattens rather than nesting: `results[].books[].info`
        // should be one list of infos, which is what a per-item template can
        // actually render. Real APIs group results (WeRead groups by scope,
        // and it is the shape that caught this).
        return Array.isArray(v) ? v : [v]
      })
    }
  }
  return current
}

/** Try each `|`-separated alternative, first match wins — one feed tool can
 *  then serve RSS (`rss.channel.item[]`) and Atom (`feed.entry[]`) alike. */
export function pickFirst(data: unknown, pick: string): unknown {
  for (const candidate of String(pick ?? '').split('|')) {
    const path = candidate.trim()
    if (!path) continue
    const value = pickPath(data, path)
    if (value !== undefined && value !== null && !(Array.isArray(value) && !value.length)) {
      return value
    }
  }
  return undefined
}

const MISS_SAMPLE = 600

/** Readable shape hint for a failed pick. */
function topKeys(value: unknown): string {
  if (Array.isArray(value)) return `(array of ${value.length})`
  if (value && typeof value === 'object') return Object.keys(value).slice(0, 20).join(', ') || '(none)'
  return `(${typeof value})`
}

function scalar(v: unknown): string {
  if (v === null || v === undefined) return ''
  if (Array.isArray(v)) return v.map(scalar).filter(Boolean).join(', ')
  if (typeof v === 'object') return JSON.stringify(v)
  return String(v)
}

/** Render one result item through a `{{field}}` template. */
export function renderItem(template: string, item: unknown): string {
  return renderTemplate(template, (key) => scalar(pickPath(item, key)))
}

/** Trim to the tool's budget, telling the model the cut happened. */
export function clip(text: string, maxChars = DEFAULT_MAX_CHARS): string {
  return text.length > maxChars
    ? `${text.slice(0, maxChars)}\n\n[truncated: ${text.length} chars total]`
    : text
}

/**
 * Turn a raw response body into the string the model sees. JSON mode without a
 * usable template falls back to the raw body rather than failing — a tool that
 * returns something is more useful than one that errors on an unexpected shape.
 */
export function shapeResponse(spec: HttpToolSpec, body: string): string {
  const max = spec.maxChars ?? DEFAULT_MAX_CHARS
  const transform = spec.response.transform ? TRANSFORMS[spec.response.transform] : undefined
  const raw = (): string => clip((transform ? transform(body) : body).trim(), max)
  if (spec.response.mode === 'text') return raw()

  let parsed: unknown
  try {
    parsed = spec.response.mode === 'xml' ? xmlToValue(body) : JSON.parse(body)
  } catch {
    return raw()
  }
  if (parsed === null || parsed === undefined) return raw()

  const picked = spec.response.pick ? pickFirst(parsed, spec.response.pick) : parsed
  if (picked === undefined || picked === null) {
    // Dumping the whole payload here used to cost thousands of tokens and still
    // not say what went wrong. Name the miss and show the shape instead.
    return `No match for pick "${spec.response.pick}". Top-level keys: ${topKeys(parsed)}\n\nFirst ${MISS_SAMPLE} chars of the response:\n${JSON.stringify(parsed, null, 1).slice(0, MISS_SAMPLE)}`
  }
  const tpl = spec.response.template
  let out: string
  if (!tpl) {
    out = typeof picked === 'string' ? picked : JSON.stringify(picked, null, 1)
  } else if (Array.isArray(picked)) {
    out = picked.map((item) => renderItem(tpl, item)).join('\n')
  } else {
    out = renderItem(tpl, picked)
  }
  return clip((transform ? transform(out) : out).trim(), max)
}

/** One-line summary of a call for the chat transcript. */
export function describeHttpCall(spec: HttpToolSpec, args: Record<string, unknown>): string {
  const first = Object.keys(spec.params)[0]
  const value = first ? args[first] : undefined
  return value === undefined || value === '' ? spec.name : `${spec.name}: ${scalar(value).slice(0, 80)}`
}

/* ── execution ───────────────────────────────────────────────────────────── */

export interface HttpReply {
  status: number
  ok: boolean
  body: string
}

export type HttpTransport = (req: BuiltRequest, signal?: AbortSignal) => Promise<HttpReply>

export interface RunHttpToolDeps {
  resolveSecret: (id: string) => string | undefined
  direct: HttpTransport
  /** Present only while the localmd Connect extension is connected. */
  extension?: HttpTransport | null
  signal?: AbortSignal
}

/**
 * Run a tool and return the model-facing string. Never throws: a failure comes
 * back as `Error: …` text, which is what the runner treats as a failed call.
 *
 * `auto` exists because CORS failures are indistinguishable from network
 * failures in the browser (both a bare TypeError) — so rather than guess, we
 * retry once through the extension when it's connected.
 */
export async function runHttpTool(
  spec: HttpToolSpec,
  args: Record<string, unknown>,
  deps: RunHttpToolDeps,
): Promise<string> {
  let req: BuiltRequest
  try {
    req = buildRequest(spec, args, deps.resolveSecret)
  } catch (err) {
    return `Error: ${(err as Error).message}`
  }

  const transport = spec.transport ?? 'auto'
  const viaExtension = transport === 'extension'
  if (viaExtension && !deps.extension) {
    return `Error: ${spec.name} needs the browser extension, and none is connected — install or enable localmd Connect in Settings → Tools.`
  }

  const attempt = async (send: HttpTransport): Promise<string> => {
    const reply = await send(req, deps.signal)
    if (!reply.ok) {
      return `Error: ${spec.name} — ${req.redactedUrl} returned HTTP ${reply.status}${
        reply.body ? `: ${reply.body.slice(0, 300)}` : ''
      }`
    }
    const out = shapeResponse(spec, reply.body)
    return out || `(${spec.name} returned an empty result)`
  }

  try {
    return await attempt(viaExtension ? deps.extension! : deps.direct)
  } catch (err) {
    const message = (err as Error).message || String(err)
    if (transport === 'auto' && deps.extension) {
      try {
        return await attempt(deps.extension)
      } catch (err2) {
        return `Error: ${spec.name} failed directly (${message}) and through the browser extension (${(err2 as Error).message})`
      }
    }
    if (transport === 'direct' || !deps.extension) {
      // The overwhelmingly common cause, and the one the user can act on.
      return `Error: ${spec.name} could not reach ${req.redactedUrl} — ${message}. If this endpoint doesn't allow browser (CORS) access, install the localmd Connect extension in Settings → Tools and set this tool's transport to "extension".`
    }
    return `Error: ${spec.name} — ${message}`
  }
}
