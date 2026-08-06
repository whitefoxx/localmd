import { describe, it, expect } from 'vitest'
import {
  CATALOG,
  sortedCatalog,
  defaultInstalledIds,
  toolsForEntries,
  serversForEntries,
  missingSecrets,
  catalogEntryById,
} from './toolCatalog'
import { normalizeHttpTool, secretRefs, staticOrigin, httpToolJsonSchema } from './httpTools'
import { LOCALMD_CONNECT_RELAY_URL } from './connectRelay'
import settings from '@/i18n/locales/settings'

const httpEntries = CATALOG.filter((e) => e.kind === 'http')
const allTools = CATALOG.flatMap((e) => e.tools ?? [])

describe('catalog shape', () => {
  it('has unique entry ids and unique tool names', () => {
    expect(new Set(CATALOG.map((e) => e.id)).size).toBe(CATALOG.length)
    expect(new Set(allTools.map((t) => t.name)).size).toBe(allTools.length)
  })

  /** localmd Connect (the product's own companion) is the one featured entry —
   *  the install that makes everything else more likely to work. */
  it('features exactly localmd Connect', () => {
    expect(CATALOG.filter((e) => e.featured).map((e) => e.id)).toEqual(['localmd-connect'])
    expect(sortedCatalog()[0].id).toBe('localmd-connect')
  })

  it('installs only entries that exist by default', () => {
    for (const id of defaultInstalledIds()) expect(catalogEntryById(id)).toBeTruthy()
  })

  it('gives every entry the shape its kind implies', () => {
    for (const e of CATALOG) {
      if (e.kind === 'http') expect(e.tools?.length, e.id).toBeGreaterThan(0)
      else expect(e.server, e.id).toBeTruthy()
    }
  })

  /** An extension's id is supplied by its relay marker at runtime, so pinning
   *  one here would break the moment a dev build (different id) is what's
   *  installed — and reintroduce the "which id do I type?" question the relay
   *  removed. Every other server entry is a URL. */
  it('pins no extension id: the extension is reached through its relay', () => {
    expect(catalogEntryById('localmd-connect')?.server?.url).toBe(LOCALMD_CONNECT_RELAY_URL)
    for (const e of CATALOG.filter((x) => x.server && x.kind !== 'extension')) {
      expect(e.server!.url, e.id).toMatch(/^https:\/\//)
    }
  })

  /**
   * Entry copy is looked up by id at runtime (`settings.catalog.<id>.title`),
   * so the i18n suite's literal-key scan cannot see it: a new entry with no
   * copy ships as a blank row in both languages and nothing fails. This is the
   * only thing standing between "added an entry" and "added an entry someone
   * can read".
   */
  it('gives every entry a title and description in both languages', () => {
    for (const { id } of CATALOG) {
      for (const [lang, catalog] of [
        ['en', settings.en.catalog],
        ['zh', settings.zh.catalog],
      ] as const) {
        const copy = (catalog as Record<string, { title?: string; desc?: string }>)[id]
        expect(copy?.title, `${id} (${lang}) title`).toBeTruthy()
        expect(copy?.desc, `${id} (${lang}) desc`).toBeTruthy()
      }
    }
  })
})

describe('catalog tool specs', () => {
  it('every shipped spec survives normalization', () => {
    for (const tool of allTools.filter((t) => !t.anyOrigin)) {
      expect(normalizeHttpTool(tool), tool.name).not.toBeNull()
      expect(staticOrigin(tool.request.url), tool.name).toBeTruthy()
    }
  })

  /** anyOrigin is first-party only, and never alongside a key. */
  it('keeps open-destination tools out of untrusted specs and away from secrets', () => {
    for (const tool of allTools.filter((t) => t.anyOrigin)) {
      expect(secretRefs(tool), tool.name).toEqual([])
      expect(normalizeHttpTool(tool)?.anyOrigin, tool.name).toBeUndefined()
    }
  })

  /** No shipped pack may silently depend on the extension: a spec pinned to
   *  the extension transport would fail every call on a fresh profile. */
  it('never pins a shipped tool to the extension transport', () => {
    for (const entry of httpEntries) {
      for (const tool of entry.tools ?? []) {
        expect(tool.transport, tool.name).not.toBe('extension')
      }
    }
  })

  it('every spec carries a description the model can act on', () => {
    for (const tool of allTools) expect(tool.description.length, tool.name).toBeGreaterThan(40)
  })

  /**
   * A placeholder that names nothing renders as an empty string — a silently
   * broken tool, which is the one failure mode a shipped catalog must not have.
   */
  it('every placeholder names a declared parameter or a declared secret', () => {
    for (const entry of httpEntries) {
      const declaredSecrets = new Set((entry.secrets ?? []).map((s) => s.id))
      for (const tool of entry.tools ?? []) {
        const templates = [
          tool.request.url,
          tool.request.body ?? '',
          ...Object.values(tool.request.headers ?? {}),
        ]
        for (const template of templates) {
          for (const m of template.matchAll(/\{\{\s*([a-zA-Z0-9_.:-]+)\s*\}\}/g)) {
            const key = m[1]
            if (key.startsWith('secret:')) {
              expect(declaredSecrets, `${tool.name} → ${key}`).toContain(key.slice(7))
            } else {
              expect(Object.keys(tool.params), `${tool.name} → ${key}`).toContain(key)
            }
          }
        }
      }
    }
  })

  it('declares every secret its tools reference, and no more', () => {
    for (const entry of httpEntries) {
      const referenced = new Set((entry.tools ?? []).flatMap((t) => secretRefs(t)))
      const declared = (entry.secrets ?? []).map((s) => s.id)
      expect([...referenced].sort(), entry.id).toEqual([...declared].sort())
    }
  })

  it('caps every result so one call cannot flood the context', () => {
    for (const tool of allTools) {
      expect(tool.maxChars, tool.name).toBeGreaterThan(0)
      expect(tool.maxChars, tool.name).toBeLessThanOrEqual(60_000)
    }
  })

  it('produces a usable JSON Schema for each spec', () => {
    for (const tool of allTools) {
      const schema = httpToolJsonSchema(tool) as { properties: Record<string, unknown> }
      expect(Object.keys(schema.properties), tool.name).toEqual(Object.keys(tool.params))
    }
  })
})

describe('selection helpers', () => {
  it('collects tools and servers for the installed set only', () => {
    expect(toolsForEntries(['jina']).map((t) => t.name).sort()).toEqual(['web_fetch', 'web_search'])
    expect(toolsForEntries([])).toEqual([])
    // A retired id resolves to nothing here — settings adopts its tools once,
    // then drops the id (see migrateRetiredPacks).
    expect(toolsForEntries(['feeds'])).toEqual([])
    expect(serversForEntries(['localmd-connect'])).toEqual([
      { entryId: 'localmd-connect', name: 'localmd-connect', url: expect.any(String) },
    ])
    expect(serversForEntries(['jina'])).toEqual([])
  })

  it('reports which keys an installed entry is still missing', () => {
    const keyed = CATALOG.filter((e) => e.secrets?.length)
    for (const entry of keyed) {
      const ids = entry.secrets!.map((s) => s.id)
      expect(missingSecrets([entry.id], () => false).map((m) => m.secret.id)).toEqual(ids)
      expect(missingSecrets([entry.id], () => true)).toEqual([])
    }
    // An entry with no keys never asks for one.
    expect(missingSecrets(['jina'], () => false)).toEqual([])
  })
})
