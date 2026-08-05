/**
 * The app's own manual — one set of markdown files serving two readers.
 *
 * The agent reads it through `app_help` so it can answer "where are my keys
 * stored?" from the product's actual decisions instead of guessing. The user
 * reads the same files in the Help panel. One source, so an answer in chat and
 * a page in Help can never disagree.
 *
 * Distinct from skills on purpose. A skill is a WORKFLOW — do this, then that —
 * and the system prompt carries a one-line listing of every one so the agent
 * knows when to reach for it. These are REFERENCE: what a thing is, where it is
 * stored, why it behaves the way it does. Nobody "runs" a fact.
 *
 * So the index is not in the prompt either. `app_help` with no topic returns
 * the list, `app_help` with one returns the body — the always-on cost is the
 * tool's own description and nothing else, however many topics we add.
 *
 * Files live in `docs/app/` and are imported at build time, so they ship in the
 * bundle: the user's KB folder stays untouched and a doc is never something
 * they have to install or sync. `<id>.md` is English and canonical; `<id>.zh.md`
 * is its translation. The agent always reads English (prompts are English, and
 * one language is one thing to keep true); the Help panel follows the user's
 * interface language and falls back to English for a topic not yet translated.
 */
import { getLocale } from '@/i18n'
import { hashDocSource, SOURCE_HASH_FIELD } from '@/lib/docHash'

export interface AppDocMeta {
  id: string
  title: string
  /** One line, shown in the index the agent reads before picking a topic and
   *  on the Help panel's contents page. */
  summary: string
}

export interface AppDoc extends AppDocMeta {
  body: string
  /** Translations only: the English source's fingerprint at the time this was
   *  written. Absent on the English file, which is the source. */
  sourceHash?: string
}

/** `title:` / `summary:` frontmatter, the same shape as SKILL.md so the two
 *  formats don't diverge for no reason. */
function parseDoc(md: string, id: string): AppDoc {
  let title = id
  let summary = ''
  let sourceHash: string | undefined
  let body = md
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(md)
  if (m) {
    body = md.slice(m[0].length)
    for (const line of m[1].split('\n')) {
      const kv = /^([A-Za-z_-]+)\s*:\s*(.*)$/.exec(line.trim())
      if (!kv) continue
      const value = kv[2].trim().replace(/^["']|["']$/g, '')
      const key = kv[1].toLowerCase()
      if (key === 'title' && value) title = value
      if (key === 'summary') summary = value
      if (key === SOURCE_HASH_FIELD && value) sourceHash = value
    }
  }
  if (!summary) {
    summary = body.split('\n').find((l) => l.trim() && !l.startsWith('#'))?.trim().slice(0, 160) ?? ''
  }
  return { id, title, summary, body: body.trim(), ...(sourceHash ? { sourceHash } : {}) }
}

const MODULES = import.meta.glob('../../docs/app/*.md', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>

/**
 * `ORDER` is the reading order, not alphabetical: someone opening Help for the
 * first time should meet the app before its git integration. Anything not
 * listed still loads, sorted after — a new doc appears without being wired up,
 * it just lands at the end until it earns a place.
 */
const ORDER = [
  'getting-started',
  'knowledge-base',
  'writing-notes',
  'working-with-the-agent',
  'models',
  'tools',
  'keys',
  'documents',
  'skills',
  'memory-and-sessions',
  'git-and-github',
  'storage-and-privacy',
]

function rank(id: string): number {
  const i = ORDER.indexOf(id)
  return i === -1 ? ORDER.length : i
}

/** id → { en, zh? }. A `.zh.md` file registers as a translation of its base id
 *  rather than as a topic of its own. */
const BY_ID = new Map<string, Partial<Record<string, AppDoc>>>()
/** The English source's current fingerprint, to compare a translation against. */
const EXPECTED_HASH = new Map<string, string>()

for (const [path, md] of Object.entries(MODULES)) {
  const file = path.slice(path.lastIndexOf('/') + 1, -3)
  const dot = file.lastIndexOf('.')
  const locale = dot === -1 ? 'en' : file.slice(dot + 1)
  const id = dot === -1 ? file : file.slice(0, dot)
  const bucket = BY_ID.get(id) ?? {}
  bucket[locale] = parseDoc(md, id)
  if (locale === 'en') EXPECTED_HASH.set(id, hashDocSource(md))
  BY_ID.set(id, bucket)
}

const IDS = [...BY_ID.keys()].sort((a, b) => rank(a) - rank(b) || a.localeCompare(b))

/** English is canonical: a topic exists if it has an English file. */
function pick(id: string, locale: string): AppDoc | undefined {
  const bucket = BY_ID.get(id)
  if (!bucket?.en) return undefined
  return bucket[locale] ?? bucket.en
}

/** Topic list in the user's interface language, for the Help panel. */
export function listAppDocs(locale: string = getLocale()): AppDocMeta[] {
  return IDS.map((id) => {
    const d = pick(id, locale)!
    return { id: d.id, title: d.title, summary: d.summary }
  })
}

export function appDoc(id: string, locale: string = getLocale()): AppDoc | undefined {
  return pick(id, locale)
}

/** The agent's view: always English, whatever the interface is set to. */
export function listAppDocsForAgent(): AppDocMeta[] {
  return listAppDocs('en')
}

export function appDocForAgent(id: string): AppDoc | undefined {
  return pick(id, 'en')
}

/** Which languages a topic has a file for — used by the parity test. */
export function appDocLocales(id: string): string[] {
  return Object.keys(BY_ID.get(id) ?? {}).sort()
}

export interface TranslationState {
  id: string
  locale: string
  /** The fingerprint the translation records, or null if it records none. */
  recorded: string | null
  /** The English source's fingerprint now. */
  expected: string
  /** False when the English text has changed since this was translated. */
  fresh: boolean
}

/**
 * Every translation, and whether it still matches the English it was made from.
 *
 * This is the mechanism that makes "one source of truth" true rather than
 * merely intended: without it, editing an English doc and forgetting its
 * translation leaves a page confidently stating something that stopped being
 * so, with nothing to notice. The agent is unaffected — it only ever reads
 * English — which is exactly why nobody would catch it by hand.
 */
export function translationStatus(): TranslationState[] {
  const out: TranslationState[] = []
  for (const id of IDS) {
    const expected = EXPECTED_HASH.get(id)
    if (!expected) continue
    for (const [locale, doc] of Object.entries(BY_ID.get(id) ?? {})) {
      if (locale === 'en' || !doc) continue
      const recorded = doc.sourceHash ?? null
      out.push({ id, locale, recorded, expected, fresh: recorded === expected })
    }
  }
  return out
}
