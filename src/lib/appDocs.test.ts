import { describe, it, expect } from 'vitest'
import { listAppDocs, appDoc, appDocLocales, listAppDocsForAgent, appDocForAgent } from './appDocs'

const LOCALES = ['en', 'zh']

describe('app docs', () => {
  const docs = listAppDocsForAgent()

  it('ships a non-empty manual', () => {
    expect(docs.length).toBeGreaterThan(0)
  })

  it('gives every topic an id, a title and a summary', () => {
    for (const d of docs) {
      expect(d.id, `id of ${JSON.stringify(d)}`).toMatch(/^[a-z][a-z0-9-]*$/)
      expect(d.title.length, `title of ${d.id}`).toBeGreaterThan(0)
      // The summary is the only thing seen when picking a topic — in the agent's
      // index and on the Help contents page alike.
      expect(d.summary.length, `summary of ${d.id}`).toBeGreaterThan(20)
    }
  })

  it('strips frontmatter from every body', () => {
    for (const d of docs) {
      for (const locale of LOCALES) {
        const body = appDoc(d.id, locale)!.body
        expect(body.startsWith('---'), `${d.id}.${locale} kept its frontmatter`).toBe(false)
        expect(body.length, `${d.id}.${locale} body`).toBeGreaterThan(100)
      }
    }
  })

  // A topic the user can read in one language and not the other is the failure
  // mode this whole split invites, so it fails the build rather than silently
  // serving English to a Chinese reader.
  it('translates every topic into every locale', () => {
    const missing = docs
      .map((d) => ({ id: d.id, has: appDocLocales(d.id) }))
      .filter((x) => LOCALES.some((l) => !x.has.includes(l)))
      .map((x) => `${x.id} has only [${x.has.join(', ')}]`)
    expect(missing).toEqual([])
  })

  it('gives each locale its own title and summary', () => {
    for (const d of docs) {
      const zh = appDoc(d.id, 'zh')!
      expect(zh.title, `${d.id} zh title is untranslated`).not.toBe(d.title)
    }
  })

  it('resolves every cross-reference to a real topic', () => {
    // Docs close with a "Related" line naming sibling ids in backticks; a stale
    // one sends the reader — or the agent — to a topic that does not exist.
    const ids = new Set(docs.map((d) => d.id))
    const dangling: string[] = []
    for (const d of docs) {
      for (const locale of LOCALES) {
        const body = appDoc(d.id, locale)!.body
        const related = /\n#+ (?:Related|相关)\n([\s\S]*)$/.exec(body)?.[1] ?? ''
        for (const m of related.matchAll(/`([a-z][a-z0-9-]*)`/g)) {
          if (!ids.has(m[1])) dangling.push(`${d.id}.${locale} → ${m[1]}`)
        }
      }
    }
    expect(dangling).toEqual([])
  })

  it('puts the introduction first', () => {
    expect(docs[0].id).toBe('getting-started')
  })

  it('falls back to English for an unknown locale, and returns undefined for an unknown topic', () => {
    expect(appDoc('tools', 'de')!.body).toBe(appDocForAgent('tools')!.body)
    expect(appDoc('nope')).toBeUndefined()
    expect(listAppDocs('zh').map((d) => d.id)).toEqual(docs.map((d) => d.id))
  })
})
