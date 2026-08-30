import { describe, it, expect } from 'vitest'
import {
  computeLint,
  declaredSourcePaths,
  formatLintReport,
  isEntryPage,
  isLogPage,
  parseLogEntries,
  type LintPage,
} from './lint'

function page(content: string, outgoing: string[] = [], broken: string[] = []): LintPage {
  return { content, outgoing, broken }
}

const FM = '---\ntitle: x\n---\n'
// A small KB: index → a → b; c is isolated; d only linked from index; e links out
// but nothing links to it; a has a broken link and a self-link.
const KB = new Map<string, LintPage>([
  ['wiki/index.md', page(FM + 'body', ['wiki/a.md', 'wiki/d.md'])],
  ['wiki/a.md', page(FM + 'a\n'.repeat(12), ['wiki/b.md', 'wiki/a.md'], ['missing-target'])],
  ['wiki/b.md', page(FM + 'b\n'.repeat(12), ['wiki/a.md'])],
  ['wiki/c.md', page(FM + 'lonely')], // orphan: no in, no out
  ['wiki/d.md', page(FM + 'd\n'.repeat(12))], // weakly-linked: only index inbound
  ['wiki/e.md', page('no frontmatter here', ['wiki/a.md'])], // weakly-linked + no-fm + unreachable
])

describe('computeLint', () => {
  const r = computeLint(KB)

  it('counts pages', () => expect(r.pageCount).toBe(6))

  it('finds broken links', () => {
    expect(r.brokenLinks).toEqual([{ path: 'wiki/a.md', targets: ['missing-target'] }])
  })

  it('separates orphans (no content in, no out) from weakly-linked (has outbound)', () => {
    // c: no in, no out. d: only index inbound + no outbound → also an island.
    expect(r.orphans).toEqual(['wiki/c.md', 'wiki/d.md'])
    // e: only index inbound but links out → weakly-linked, not an island.
    expect(r.weaklyLinked).toEqual(['wiki/e.md'])
  })

  it('flags pages unreachable from the index', () => {
    // index → a → b; d reachable via index; c and e are not linked from index.
    expect(r.unreachable).toEqual(['wiki/c.md', 'wiki/e.md'])
  })

  it('flags missing frontmatter, self-links, and thin pages', () => {
    expect(r.noFrontmatter).toEqual(['wiki/e.md'])
    expect(r.selfLinks).toEqual(['wiki/a.md'])
    // c (1 line), d body is 12 lines so not thin; e (1 line); index (1 line)…
    expect(r.thin.map((t) => t.path)).toContain('wiki/c.md')
    expect(r.thin.map((t) => t.path)).not.toContain('wiki/a.md')
  })

  it('detects placeholder wikilinks', () => {
    const withPlaceholder = new Map<string, LintPage>([
      ['wiki/index.md', page('see [[wiki/...]] later')],
    ])
    expect(computeLint(withPlaceholder).placeholders).toEqual(['wiki/index.md'])
  })
})

describe('computeLint — file-aware checks', () => {
  const FILES = [
    'wiki/index.md',
    'raw/papers/read.pdf',
    'raw/papers/never opened.pdf',
    'raw/assets/shot.png',
    'raw/papers/read.pdf.annotations.json',
    '.localmd/pdf-index/read/manifest.json',
    '.obsidian/workspace.json',
  ]
  const kb = new Map<string, LintPage>([
    [
      'wiki/index.md',
      page(
        FM +
          'Cites [[pdf1:raw/papers/read.pdf]] and [[pdf2:raw/papers/gone.pdf]].\n' +
          'Screenshot: ![](raw/assets/shot.png)\n',
        [],
      ),
    ],
  ])

  it('flags only sources nothing mentions, ignoring dot-dirs, sidecars and notes', () => {
    // read.pdf is cited, shot.png is embedded as an image; the .localmd/ and
    // .obsidian/ files are plumbing; the .annotations.json is our own sidecar
    // (visible in the tree on purpose); index.md is a note (orphans own it).
    expect(computeLint(kb, FILES).unreferencedSources).toEqual(['raw/papers/never opened.pdf'])
  })

  it('matches a percent-encoded href against the real filename', () => {
    const encoded = new Map<string, LintPage>([
      ['wiki/index.md', page(FM + '[paper](raw/papers/never%20opened.pdf)')],
    ])
    expect(computeLint(encoded, FILES).unreferencedSources).not.toContain(
      'raw/papers/never opened.pdf',
    )
  })

  it('flags a source declaration with no such file', () => {
    expect(computeLint(kb, FILES).danglingCitations).toEqual([
      { path: 'wiki/index.md', targets: ['raw/papers/gone.pdf'] },
    ])
  })

  it('does not call a moved-but-unique source dangling', () => {
    // The declared dir is wrong but the basename is unique — resolveCitePath
    // repairs it, so moving a file must not light up every page citing it.
    const moved = new Map<string, LintPage>([
      ['wiki/a.md', page(FM + '[[pdf1:raw/old/read.pdf]]')],
    ])
    expect(computeLint(moved, FILES).danglingCitations).toEqual([])
  })

  it('returns nothing for the file-aware checks when given no file list', () => {
    const r = computeLint(kb)
    expect(r.unreferencedSources).toEqual([])
    expect(r.danglingCitations).toEqual([])
  })
})

describe('computeLint — pages their sources moved on from', () => {
  const FILES = ['wiki/a.md', 'wiki/b.md', 'raw/papers/read.pdf']
  const DAY = 86_400_000
  const cites = (mtime: number): LintPage => ({
    ...page(FM + 'Cites [[pdf1:raw/papers/read.pdf]].'),
    mtime,
  })
  const sourceAt = (mtime: number): Map<string, number> =>
    new Map([['raw/papers/read.pdf', mtime]])

  it('flags a page whose cited source was revised after it', () => {
    const kb = new Map<string, LintPage>([['wiki/a.md', cites(0)]])
    expect(computeLint(kb, FILES, sourceAt(DAY)).stalePages).toEqual([
      { path: 'wiki/a.md', sources: ['raw/papers/read.pdf'] },
    ])
  })

  it('says nothing when the page is the newer of the two', () => {
    const kb = new Map<string, LintPage>([['wiki/a.md', cites(DAY)]])
    expect(computeLint(kb, FILES, sourceAt(0)).stalePages).toEqual([])
  })

  /** A checkout or a sync stamps a whole folder at once, and the order within
   *  the batch is arbitrary — treating that as drift would fire on every fresh
   *  clone, which is the fastest way to teach someone to ignore a check. */
  it('ignores a gap small enough to be one checkout writing both files', () => {
    const kb = new Map<string, LintPage>([['wiki/a.md', cites(0)]])
    expect(computeLint(kb, FILES, sourceAt(5_000)).stalePages).toEqual([])
  })

  /** Naming a file is not claiming to have read it — only a declaration is. */
  it('does not flag a page that merely mentions the source', () => {
    const kb = new Map<string, LintPage>([
      ['wiki/a.md', { ...page(FM + 'See raw/papers/read.pdf for more.'), mtime: 0 }],
    ])
    expect(computeLint(kb, FILES, sourceAt(DAY)).stalePages).toEqual([])
  })

  it('stays quiet when either mtime is missing', () => {
    const noPageMtime = new Map<string, LintPage>([
      ['wiki/a.md', page(FM + 'Cites [[pdf1:raw/papers/read.pdf]].')],
    ])
    expect(computeLint(noPageMtime, FILES, sourceAt(DAY)).stalePages).toEqual([])
    const kb = new Map<string, LintPage>([['wiki/a.md', cites(0)]])
    expect(computeLint(kb, FILES).stalePages).toEqual([])
  })

  /** The caller stats what this returns, so a source it forgets can never be
   *  compared — and a dangling declaration must not become a stat attempt. */
  it('lists the resolved sources a caller has to stat, and only those', () => {
    const kb = new Map<string, LintPage>([
      ['wiki/a.md', cites(0)],
      ['wiki/b.md', page(FM + 'Cites [[pdf1:read.pdf]] and [[pdf2:raw/papers/gone.pdf]].')],
    ])
    expect(declaredSourcePaths(kb, FILES)).toEqual(['raw/papers/read.pdf'])
  })
})

describe('declaredSourcePaths as the "has a source note" test', () => {
  const FILES2 = ['raw/papers/read.pdf', 'raw/books/b.epub']

  /** The viewer's badge asks this question, so the distinction it rests on
   *  needs a test of its own: naming a file claims nothing, declaring it
   *  claims to have read it. */
  it('a page that merely names the file does not count as citing it', () => {
    const kb = new Map<string, LintPage>([
      ['wiki/a.md', page(FM + 'I should get around to raw/papers/read.pdf one day.')],
    ])
    expect(declaredSourcePaths(kb, FILES2)).toEqual([])
    // …while unreferencedSources, which matches any mention, is satisfied.
    expect(computeLint(kb, FILES2).unreferencedSources).not.toContain('raw/papers/read.pdf')
  })

  it('a declaration counts, whatever the page is called or where it lives', () => {
    const kb = new Map<string, LintPage>([
      ['notes/deep/whatever.md', page(FM + 'Notes. [[pdf1:raw/papers/read.pdf]]')],
    ])
    expect(declaredSourcePaths(kb, FILES2)).toEqual(['raw/papers/read.pdf'])
  })

  it('counts an epub declaration too, and de-duplicates across pages', () => {
    const kb = new Map<string, LintPage>([
      ['wiki/a.md', page(FM + '[[epub1:raw/books/b.epub]]')],
      ['wiki/b.md', page(FM + 'also [[epub1:raw/books/b.epub]]')],
    ])
    expect(declaredSourcePaths(kb, FILES2)).toEqual(['raw/books/b.epub'])
  })

  it('a declaration in frontmatter does not count — declarations live in the body', () => {
    const kb = new Map<string, LintPage>([
      ['wiki/a.md', page('---\nsources: [[pdf1:raw/papers/read.pdf]]\n---\nbody')],
    ])
    expect(declaredSourcePaths(kb, FILES2)).toEqual([])
  })
})

describe('computeLint — tag hygiene', () => {
  const tagged = (tags: string): LintPage => page(`---\ntags: ${tags}\n---\nbody`)

  it('groups spellings that differ only in case, separator, or plural', () => {
    const kb = new Map<string, LintPage>([
      ['wiki/a.md', tagged('[machine-learning, note]')],
      ['wiki/b.md', tagged('[Machine Learning, notes]')],
      ['wiki/c.md', tagged('[machine_learnings]')],
    ])
    const groups = computeLint(kb).similarTags
    expect(groups).toHaveLength(2)
    expect(groups[0].variants.map((v) => v.tag).sort()).toEqual([
      'Machine Learning',
      'machine-learning',
      'machine_learnings',
    ])
    expect(groups[1].variants.map((v) => v.tag).sort()).toEqual(['note', 'notes'])
  })

  it('puts the most-used spelling first — the one to standardise on', () => {
    const kb = new Map<string, LintPage>([
      ['wiki/a.md', tagged('[Notes]')],
      ['wiki/b.md', tagged('[note]')],
      ['wiki/c.md', tagged('[note]')],
    ])
    expect(computeLint(kb).similarTags[0].variants).toEqual([
      { tag: 'note', count: 2 },
      { tag: 'Notes', count: 1 },
    ])
  })

  it('leaves genuinely different tags alone', () => {
    const kb = new Map<string, LintPage>([
      ['wiki/a.md', tagged('[ml, machine-learning, 机器学习]')],
    ])
    expect(computeLint(kb).similarTags).toEqual([])
  })
})

describe('isEntryPage', () => {
  it('matches index/log at any depth', () => {
    expect(isEntryPage('index.md')).toBe(true)
    expect(isEntryPage('wiki/projects/x/index.md')).toBe(true)
    expect(isEntryPage('wiki/log.md')).toBe(true)
    expect(isEntryPage('wiki/a.md')).toBe(false)
  })
})

describe('the synthesis log', () => {
  const DAY = 86_400_000
  const MAR_1 = Date.UTC(2026, 2, 1)
  /** Anything after the END of the entry's day counts as movement — see
   *  `parseLogEntries` on why midnight would make every entry report itself. */
  const AFTER_MAR_1 = MAR_1 + DAY + 1
  const SAME_DAY = MAR_1 + 3600_000

  const LOG =
    '# Log\n\n' +
    '## 2026-03-01 — [[a]] and [[b]] disagree about the threshold\n' +
    'One says 10B, the other says 100B.\n\n' +
    '## 2026-03-01 — [[c]] needs a source\n' +
    'No citation for the headline number.\n'

  const kb = (aMtime: number, cMtime: number): Map<string, LintPage> =>
    new Map<string, LintPage>([
      ['wiki/log.md', { content: LOG, outgoing: ['wiki/a.md', 'wiki/b.md', 'wiki/c.md'], broken: [] }],
      ['wiki/a.md', { ...page(FM + 'a\n'.repeat(12)), mtime: aMtime }],
      ['wiki/b.md', { ...page(FM + 'b\n'.repeat(12)), mtime: MAR_1 }],
      ['wiki/c.md', { ...page(FM + 'c\n'.repeat(12)), mtime: cMtime }],
    ])

  it('recognizes a log at any depth', () => {
    expect(isLogPage('log.md')).toBe(true)
    expect(isLogPage('wiki/LOG.md')).toBe(true)
    expect(isLogPage('wiki/changelog.md')).toBe(false)
    expect(isEntryPage('wiki/log.md')).toBe(true)
  })

  it('reads dated entries and the pages each one names', () => {
    const entries = parseLogEntries(LOG)
    expect(entries.map((e) => e.targets)).toEqual([['a', 'b'], ['c']])
    expect(entries[0].title).toBe('2026-03-01 — [[a]] and [[b]] disagree about the threshold')
    // End of the entry's day, not its midnight.
    expect(entries[0].after).toBe(MAR_1 + DAY)
  })

  it('ignores headings that are not dated', () => {
    expect(parseLogEntries('## Open questions\n[[a]]\n')).toEqual([])
  })

  /** Settling a disagreement means editing one side, not both. */
  it('flags an entry when any page it names has moved since', () => {
    const r = computeLint(kb(AFTER_MAR_1, MAR_1))
    expect(r.staleLogEntries).toEqual([
      {
        path: 'wiki/log.md',
        entry: '2026-03-01 — [[a]] and [[b]] disagree about the threshold',
        pages: ['wiki/a.md'],
      },
    ])
  })

  /** Writing an entry about two pages usually happens on a day those pages
   *  were touched — an entry that reports itself the moment it is written is
   *  a check nobody would keep on. */
  it('does not flag an entry over an edit on its own day', () => {
    expect(computeLint(kb(SAME_DAY, SAME_DAY)).staleLogEntries).toEqual([])
  })

  it('says nothing about a log whose pages have not moved', () => {
    expect(computeLint(kb(MAR_1, MAR_1)).staleLogEntries).toEqual([])
  })

  it('leaves an unparseable log alone rather than guessing', () => {
    const freeform = new Map<string, LintPage>([
      ['wiki/log.md', { content: '# Log\n\nJust prose about [[a]].\n', outgoing: ['wiki/a.md'], broken: [] }],
      ['wiki/a.md', { ...page(FM + 'a\n'.repeat(12)), mtime: AFTER_MAR_1 }],
    ])
    expect(computeLint(freeform).staleLogEntries).toEqual([])
  })
})

describe('kb-role — frontmatter overrides the name defaults', () => {
  const role = (r: string, extra = ''): string => `---\nkb-role: ${r}\n${extra}---\n`

  it('a declared index becomes the reachability root, un-trapping a repurposed index.md', () => {
    const kb = new Map<string, LintPage>([
      // The user's own index.md — an unrelated file that links nothing.
      // Without the declared root below, every content page would be flagged
      // unreachable off the back of it.
      ['index.md', page(FM + 'my old bookmarks dump')],
      ['notes/map.md', page(role('index') + 'the real map', ['notes/a.md'])],
      ['notes/a.md', page(FM + 'a\n'.repeat(12))],
      ['notes/b.md', page(FM + 'b\n'.repeat(12), ['notes/a.md'])],
    ])
    const r = computeLint(kb)
    expect(r.unreachable).toEqual(['notes/b.md'])
  })

  it('keeps the name defaults when nothing declares a role', () => {
    expect(computeLint(KB).unreachable).toEqual(['wiki/c.md', 'wiki/e.md'])
  })

  it('a kb-role: log page under any name is the synthesis log', () => {
    const DAY = 86_400_000
    const MAR_1 = Date.UTC(2026, 2, 1)
    const kb = new Map<string, LintPage>([
      [
        'notes/kb-journal.md',
        {
          content: role('log') + '## 2026-03-01 — [[a]] needs a source\nstill open\n',
          outgoing: ['notes/a.md'],
          broken: [],
        },
      ],
      ['notes/a.md', { ...page(FM + 'a\n'.repeat(12)), mtime: MAR_1 + DAY + 1 }],
    ])
    const r = computeLint(kb)
    expect(r.staleLogEntries.map((e) => e.path)).toEqual(['notes/kb-journal.md'])
    // …and, as a structural page, it is exempt from the quality checks.
    expect(r.orphans).not.toContain('notes/kb-journal.md')
    expect(r.thin.map((t) => t.path)).not.toContain('notes/kb-journal.md')
  })

  it('two declared indexes tie-break to the lexicographically first', () => {
    const kb = new Map<string, LintPage>([
      ['b-map.md', page(role('index') + 'later', ['x.md'])],
      ['a-map.md', page(role('index') + 'first', ['y.md'])],
      ['x.md', page(FM + 'x\n'.repeat(12))],
      ['y.md', page(FM + 'y\n'.repeat(12))],
    ])
    // Root is a-map.md: y reachable, x not.
    expect(computeLint(kb).unreachable).toEqual(['x.md'])
  })

  it('an index.md whose own frontmatter says log is not picked as root', () => {
    const kb = new Map<string, LintPage>([
      ['index.md', page(role('log') + '## 2026-03-01 — nothing\n')],
      ['a.md', page(FM + 'a\n'.repeat(12))],
    ])
    // No root at all → the unreachable check stays silent instead of flooding.
    expect(computeLint(kb).unreachable).toEqual([])
  })
})

describe('formatLintReport', () => {
  it('summarizes and always appends the semantic-check reminder', () => {
    const out = formatLintReport(computeLint(KB))
    expect(out).toContain('KB structural health — 6 pages')
    expect(out).toContain('Broken wikilinks')
    expect(out).toMatch(/confirm scope with the user|ask the user/i)
  })

  /** The rendered line is the only place the agent learns what to do with a
   *  stale page — and "rewrite it from memory" is the one wrong answer, since
   *  that replaces stale content with invented content. */
  it('tells the agent to re-read the source rather than rewrite the page', () => {
    const files = ['wiki/a.md', 'raw/papers/read.pdf']
    const kb = new Map<string, LintPage>([
      [
        'wiki/a.md',
        { ...page(FM + 'Cites [[pdf1:raw/papers/read.pdf]].'), mtime: 0 },
      ],
    ])
    const out = formatLintReport(computeLint(kb, files, new Map([['raw/papers/read.pdf', 86_400_000]])))
    expect(out).toContain('1 behind their sources')
    expect(out).toContain('wiki/a.md → raw/papers/read.pdf')
    expect(out).toMatch(/never rewrite a page from memory/i)
  })

  /** The rendered line is where the agent learns the limit of this finding:
   *  something moved, which is not the same as the entry being settled. */
  it('offers a log entry for rechecking without declaring it closed', () => {
    const DAY = 86_400_000
    const kb = new Map<string, LintPage>([
      [
        'wiki/log.md',
        {
          content: '## 2026-03-01 — [[a]] and [[b]] disagree\nunresolved\n',
          outgoing: ['wiki/a.md', 'wiki/b.md'],
          broken: [],
        },
      ],
      ['wiki/a.md', { ...page(FM + 'a\n'.repeat(12)), mtime: Date.UTC(2026, 2, 9) }],
      ['wiki/b.md', { ...page(FM + 'b\n'.repeat(12)), mtime: Date.UTC(2026, 2, 1) + DAY }],
    ])
    const out = formatLintReport(computeLint(kb))
    expect(out).toContain('1 to recheck in the log')
    expect(out).toContain('wiki/log.md · 2026-03-01 — [[a]] and [[b]] disagree → wiki/a.md')
    expect(out).toMatch(/close an entry only when the user agrees/i)
    // b was edited exactly at the boundary, not past it, so the entry names
    // only a. (b appears elsewhere in the report as an orphan — hence the
    // assertion is on the entry's own line, not on the whole document.)
    expect(out).not.toContain('disagree → wiki/a.md, wiki/b.md')
  })

  it('reports a clean KB', () => {
    // index links both; a and b cross-link each other → each has content inbound.
    const clean = new Map<string, LintPage>([
      ['wiki/index.md', page(FM + 'i\n'.repeat(12), ['wiki/a.md', 'wiki/b.md'])],
      ['wiki/a.md', page(FM + 'a\n'.repeat(12), ['wiki/b.md'])],
      ['wiki/b.md', page(FM + 'b\n'.repeat(12), ['wiki/a.md'])],
    ])
    expect(formatLintReport(computeLint(clean))).toContain('No structural issues found.')
  })
})

/**
 * A page citing `[[1:b10-62]]` with no `[[epub1:…]]` of its own. It reads as
 * precise and is not: the number names nothing on the page, so the chip has
 * only the block id left, and a block id is a name inside ONE document —
 * every book has a `b10-62`. This is the check that offers the line which
 * would end the guessing.
 */
describe('undeclaredCitations', () => {
  const SOURCE_PAGE = `${FM}# The book\n\n[[epub1:raw/books/politics.epub]]\n`

  it('reports the number and the line the linked source page implies', () => {
    const kb = new Map<string, LintPage>([
      ['wiki/sources/book.md', page(SOURCE_PAGE)],
      [
        'wiki/concepts/salt.md',
        page(`${FM}Per [[wiki/sources/book]] it says so at [[1:b10-62]].`, [
          'wiki/sources/book.md',
        ]),
      ],
    ])
    const r = computeLint(kb, ['raw/books/politics.epub'])
    expect(r.undeclaredCitations).toEqual([
      {
        path: 'wiki/concepts/salt.md',
        numbers: ['1'],
        suggested: [{ num: '1', source: { kind: 'epub', path: 'raw/books/politics.epub' } }],
      },
    ])
    expect(formatLintReport(r)).toContain('add [[epub1:raw/books/politics.epub]]')
  })

  it('says nothing about a page that declares its own source', () => {
    const kb = new Map<string, LintPage>([
      ['wiki/a.md', page(`${FM}[[pdf1:raw/x.pdf]] and [[1:b1-1]]`)],
    ])
    expect(computeLint(kb, ['raw/x.pdf']).undeclaredCitations).toEqual([])
  })

  // A bare [[b1-1]] declares no number to be missing. It has the same problem,
  // but nothing here can name the fix, and a check that cannot say what to do
  // is a nag.
  it('ignores the numberless form', () => {
    const kb = new Map<string, LintPage>([['wiki/a.md', page(`${FM}see [[b1-1]]`)]])
    expect(computeLint(kb).undeclaredCitations).toEqual([])
  })

  it('suggests nothing when no linked page declares that number', () => {
    const kb = new Map<string, LintPage>([
      ['wiki/other.md', page(`${FM}nothing declared here`)],
      ['wiki/a.md', page(`${FM}[[wiki/other]] says [[2:b1-1]]`, ['wiki/other.md'])],
    ])
    const r = computeLint(kb)
    expect(r.undeclaredCitations).toEqual([
      { path: 'wiki/a.md', numbers: ['2'], suggested: [] },
    ])
    expect(formatLintReport(r)).toContain('ask the user which document')
  })

  // Two linked source pages both calling their own book "1" is normal —
  // numbering is per page — so the number means nothing here and inventing an
  // answer would be the original bug wearing a better hat.
  it('suggests nothing when two linked pages disagree about the number', () => {
    const kb = new Map<string, LintPage>([
      ['wiki/s1.md', page(`${FM}[[epub1:raw/books/one.epub]]`)],
      ['wiki/s2.md', page(`${FM}[[pdf1:raw/books/two.pdf]]`)],
      [
        'wiki/a.md',
        page(`${FM}[[wiki/s1]] [[wiki/s2]] — [[1:b1-1]]`, ['wiki/s1.md', 'wiki/s2.md']),
      ],
    ])
    expect(computeLint(kb).undeclaredCitations[0].suggested).toEqual([])
  })
})

/**
 * An index outlives the document it was built from — rename the PDF and
 * `.localmd/pdf-index/<slug>/` stays, still holding its block ids. Nothing
 * read a manifest to notice, so a citation went on resolving into a book that
 * was no longer in the folder.
 */
describe('orphanedIndexes', () => {
  const KB_FILES = ['raw/books/mao.pdf', 'raw/books/other.epub']

  it('says nothing while every index has its source', () => {
    const indexes = new Map([['.localmd/pdf-index/mao-abc', { source: 'raw/books/mao.pdf' }]])
    expect(computeLint(new Map(), KB_FILES, new Map(), indexes).orphanedIndexes).toEqual([])
  })

  it('names an index whose document is gone', () => {
    const indexes = new Map([
      ['.localmd/pdf-index/old-def', { source: 'raw/books/deleted.pdf' }],
      ['.localmd/pdf-index/mao-abc', { source: 'raw/books/mao.pdf' }],
    ])
    const r = computeLint(new Map(), KB_FILES, new Map(), indexes)
    expect(r.orphanedIndexes).toEqual([
      { dir: '.localmd/pdf-index/old-def', source: 'raw/books/deleted.pdf' },
    ])
    expect(formatLintReport(r)).toContain('raw/books/deleted.pdf (missing)')
  })

  // The same bytes under a new name. Worth saying — it explains where the file
  // went — but the two indexes numbered their passages independently, so the
  // report must not promise the old citations now land in the new one.
  it('recognises a rename by content hash without promising the ids transfer', () => {
    const indexes = new Map([
      [
        '.localmd/pdf-index/old-def',
        { source: 'raw/books/mao (7 vols).pdf', contentHash: 'sha-1' },
      ],
      ['.localmd/pdf-index/mao-abc', { source: 'raw/books/mao.pdf', contentHash: 'sha-1' }],
    ])
    const r = computeLint(new Map(), KB_FILES, new Map(), indexes)
    expect(r.orphanedIndexes).toEqual([
      {
        dir: '.localmd/pdf-index/old-def',
        source: 'raw/books/mao (7 vols).pdf',
        renamedTo: 'raw/books/mao.pdf',
      },
    ])
    const text = formatLintReport(r)
    expect(text).toContain('same bytes as raw/books/mao.pdf')
    expect(text).toContain('number their passages independently')
  })

  it('does not call a hash a rename when the other source is also gone', () => {
    const indexes = new Map([
      ['.localmd/pdf-index/a', { source: 'raw/books/gone-a.pdf', contentHash: 'sha-1' }],
      ['.localmd/pdf-index/b', { source: 'raw/books/gone-b.pdf', contentHash: 'sha-1' }],
    ])
    const r = computeLint(new Map(), KB_FILES, new Map(), indexes)
    expect(r.orphanedIndexes.every((o) => o.renamedTo === undefined)).toBe(true)
  })
})
