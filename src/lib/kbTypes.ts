/**
 * Optional KB type schema — a git-tracked file at the KB root that maps a
 * knowledge `type` to a directory and a color. It is a browser-md convenience
 * on top of OKF (OKF itself has no type registry): a normative *suggestion*,
 * never a hard constraint.
 *
 * Absent → types come from each file's frontmatter `type:`, else untyped
 * (null — "untyped" is itself a kind of type). Present → it also lets a file
 * inherit a type from its directory and gives each type a stable color.
 *
 * Hand-editable, and maintained by the agent via /lint. Parsing is tolerant:
 * unparseable YAML and malformed entries are skipped rather than throwing,
 * because both humans and agents slip.
 */
import { parse } from 'yaml'

export const TYPE_SCHEMA_PATH = 'types.yaml'

export interface TypeSchemaEntry {
  name: string
  /** Files under this KB dir default to this type (optional). */
  dir?: string
  /** Display color, any CSS color (optional; else a stable auto color). */
  color?: string
}

export interface TypeSchema {
  entries: TypeSchemaEntry[]
}

/** Parse a `types.yaml` body. Returns null only when the YAML itself is
 *  unparseable; an empty/typeless doc yields an empty schema. Nameless or
 *  non-object entries are skipped; trailing slashes on `dir` are trimmed. */
export function parseTypeSchema(text: string): TypeSchema | null {
  let doc: unknown
  try {
    doc = parse(text)
  } catch {
    return null
  }
  const raw = (doc as { types?: unknown } | null)?.types
  if (!Array.isArray(raw)) return { entries: [] }
  const entries: TypeSchemaEntry[] = []
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const o = item as Record<string, unknown>
    const name = typeof o.name === 'string' ? o.name.trim() : ''
    if (!name) continue
    const entry: TypeSchemaEntry = { name }
    if (typeof o.dir === 'string' && o.dir.trim()) entry.dir = o.dir.trim().replace(/\/+$/, '')
    if (typeof o.color === 'string' && o.color.trim()) entry.color = o.color.trim()
    entries.push(entry)
  }
  return { entries }
}

/**
 * A page's type: an explicit frontmatter `type:` wins (OKF-compatible), else
 * the deepest matching schema `dir`, else null (untyped).
 */
export function resolveType(
  path: string,
  frontmatterType: string | null,
  schema: TypeSchema | null,
): string | null {
  if (frontmatterType) return frontmatterType
  if (!schema) return null
  let best: TypeSchemaEntry | null = null
  for (const e of schema.entries) {
    if (!e.dir) continue
    if (path === e.dir || path.startsWith(e.dir + '/')) {
      if (!best || e.dir.length > (best.dir?.length ?? 0)) best = e
    }
  }
  return best?.name ?? null
}

/** The schema-defined color for a type, or null when the schema doesn't set
 *  one (callers fall back to a stable auto color). */
export function schemaColor(type: string, schema: TypeSchema | null): string | null {
  if (!schema) return null
  return schema.entries.find((e) => e.name === type && e.color)?.color ?? null
}
