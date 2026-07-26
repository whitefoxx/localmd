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

const httpEntries = CATALOG.filter((e) => e.kind === 'http')
const allTools = CATALOG.flatMap((e) => e.tools ?? [])

describe('catalog shape', () => {
  it('has unique entry ids and unique tool names', () => {
    expect(new Set(CATALOG.map((e) => e.id)).size).toBe(CATALOG.length)
    expect(new Set(allTools.map((t) => t.name)).size).toBe(allTools.length)
  })

  it('features exactly one entry, and it is WebCLI', () => {
    const featured = CATALOG.filter((e) => e.featured)
    expect(featured).toHaveLength(1)
    expect(featured[0].id).toBe('webcli')
    expect(sortedCatalog()[0].id).toBe('webcli')
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

  it('routes tools through WebCLI exactly when their entry says they need it', () => {
    for (const entry of httpEntries) {
      for (const tool of entry.tools ?? []) {
        if (entry.requiresWebcli) expect(tool.transport, tool.name).toBe('webcli')
        else expect(tool.transport, tool.name).not.toBe('webcli')
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
    expect(toolsForEntries(['feeds']).map((t) => t.name).sort()).toEqual(['atom_feed', 'rss_feed'])
    expect(toolsForEntries([])).toEqual([])
    expect(serversForEntries(['webcli'])).toEqual([
      { entryId: 'webcli', name: 'webcli', url: expect.any(String) },
    ])
    expect(serversForEntries(['jina'])).toEqual([])
  })

  it('reports which keys an installed entry is still missing', () => {
    expect(missingSecrets(['zotero'], () => false).map((m) => m.secret.id)).toEqual([
      'zotero_user',
      'zotero_key',
    ])
    expect(missingSecrets(['zotero'], () => true)).toEqual([])
    expect(missingSecrets(['research'], () => false)).toEqual([])
  })
})
