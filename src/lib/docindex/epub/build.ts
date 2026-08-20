/**
 * Turn extracted EPUB blocks into the on-disk index: section files (one per
 * spine item, large items sub-split on headings), a table of contents, a
 * block→CFI map, and agent-facing instructions. Ported from trace-app.
 */
import { pad, slugify, writeAll } from '../util'
import type { SpineItemInfo } from './extract'
import {
  BUILDER,
  INDEX_VERSION,
  type EpubBlock,
  type EpubIndexManifest,
  type SectionMeta,
  type TocNode,
} from './types'

interface BuildInput {
  /** KB-relative path of the index directory to write into. */
  indexDir: string
  /** Source EPUB path, relative to the KB root. */
  source: string
  title: string
  author: string
  contentHash: string
  blocks: EpubBlock[]
  spineItems: SpineItemInfo[]
  toc: TocNode[]
}

/** Build + write the whole index directory. Returns the manifest. */
export async function buildIndex(input: BuildInput): Promise<EpubIndexManifest> {
  const { indexDir, source, title, author, contentHash, blocks, spineItems, toc } = input

  // One section per spine item, sub-split when an item is too large to be a
  // useful single file (e.g. a whole book packed into one XHTML document).
  const groups: { spine: number; href: string; title: string; blocks: EpubBlock[] }[] = []
  for (const item of spineItems) {
    const own = blocks.filter((b) => b.spine === item.spine)
    splitSpineItem(own).forEach((chunk, i, all) => {
      const head = chunk[0]
      const secTitle =
        all.length === 1
          ? item.title
          : head && head.kind === 'heading'
            ? head.text
            : `${item.title} (part ${i + 1})`
      groups.push({ spine: item.spine, href: item.href, title: secTitle, blocks: chunk })
    })
  }

  const sections: SectionMeta[] = groups.map((g, i) => ({
    index: i + 1,
    spine: g.spine,
    title: g.title,
    href: g.href,
    file: `sections/${pad(i + 1)}-${slugify(g.title)}.md`,
  }))

  const files: { path: string; content: string }[] = []
  groups.forEach((g, i) => {
    files.push({ path: sections[i].file, content: renderSection(sections[i], g.blocks) })
  })
  files.push({ path: 'toc.md', content: renderToc(title, source, toc, sections) })
  files.push({ path: '_README.md', content: renderReadme(title, source) })

  const locations: Record<string, { spine: number; cfi: string }> = {}
  for (const b of blocks) locations[b.id] = { spine: b.spine, cfi: b.cfi }
  files.push({
    path: 'locations.json',
    content: JSON.stringify({ version: 1, blocks: locations }),
  })

  const manifest: EpubIndexManifest = {
    version: INDEX_VERSION,
    builder: BUILDER,
    source,
    title,
    author,
    spineCount: spineItems.length,
    blockCount: blocks.length,
    contentHash,
    parsedAt: new Date().toISOString(),
    sections,
  }
  files.push({ path: 'manifest.json', content: JSON.stringify(manifest, null, 2) })

  await writeAll(indexDir, files)
  return manifest
}

/**
 * Split one spine item's blocks into chapter-sized chunks. Returns a single
 * chunk unless the item is large AND has a heading level to split on.
 */
function splitSpineItem(blocks: EpubBlock[]): EpubBlock[][] {
  const MAX_BLOCKS = 250
  if (blocks.length <= MAX_BLOCKS) return [blocks]
  // Shallowest heading level that occurs at least twice — the split points.
  let splitLevel = 0
  for (let lvl = 1; lvl <= 6; lvl++) {
    if (blocks.filter((b) => b.kind === 'heading' && b.level === lvl).length >= 2) {
      splitLevel = lvl
      break
    }
  }
  if (splitLevel === 0) return [blocks]
  const chunks: EpubBlock[][] = []
  let cur: EpubBlock[] = []
  for (const b of blocks) {
    if (b.kind === 'heading' && b.level === splitLevel && cur.length > 0) {
      chunks.push(cur)
      cur = []
    }
    cur.push(b)
  }
  if (cur.length > 0) chunks.push(cur)
  return chunks
}

/** Render one section file: a `#` title then every block, each tagged `[[id]]`. */
function renderSection(sec: SectionMeta, blocks: EpubBlock[]): string {
  const out: string[] = [`<!-- section ${pad(sec.index)} · ${sec.href} -->`]
  let body = blocks
  if (blocks.length > 0 && blocks[0].kind === 'heading') {
    out.push(`# [[${blocks[0].id}]] ${blocks[0].text}`, '')
    body = blocks.slice(1)
  } else {
    out.push(`# ${sec.title}`, '')
  }
  for (const b of body) {
    if (b.kind === 'heading') {
      const hashes = '#'.repeat(Math.min(6, Math.max(2, b.level + 1)))
      out.push(`${hashes} [[${b.id}]] ${b.text}`, '')
    } else if (b.kind === 'code') {
      out.push(`[[${b.id}]]`, '```', b.text, '```', '')
    } else {
      out.push(`[[${b.id}]] ${b.text}`, '')
    }
  }
  if (blocks.length === 0) {
    out.push('_No extractable text in this section (likely a cover or image page)._', '')
  }
  return out.join('\n')
}

/** Render `toc.md` — the EPUB's table of contents, linked to section files. */
function renderToc(
  title: string,
  source: string,
  toc: TocNode[],
  sections: SectionMeta[],
): string {
  const out: string[] = [
    `# ${title} — contents`,
    '',
    `> Location-aware index of \`${source}\`. Read \`_README.md\` for how to`,
    '> navigate these files and how to cite passages back to the EPUB.',
    '',
  ]
  const baseOf = (href: string): string => href.split('#')[0].split('/').pop() ?? ''
  const fileForHref = (href: string): string | null => {
    const base = baseOf(href)
    const hit = sections.find((s) => baseOf(s.href) === base)
    return hit ? hit.file : null
  }
  if (toc.length > 0) {
    const walk = (nodes: TocNode[], depth: number): void => {
      for (const n of nodes) {
        const indent = '  '.repeat(depth)
        const file = n.href ? fileForHref(n.href) : null
        out.push(file ? `${indent}- [${n.title}](${file})` : `${indent}- ${n.title}`)
        walk(n.children, depth + 1)
      }
    }
    walk(toc, 0)
  } else {
    for (const s of sections) out.push(`- [${s.title}](${s.file})`)
  }
  out.push('')
  return out.join('\n')
}

/** Render `_README.md` — instructions for the AI agent reading this index. */
function renderReadme(title: string, source: string): string {
  return `# EPUB index — ${title}

This folder is a **parsed, location-aware index** of the EPUB \`${source}\`,
generated so an AI agent can read the book like source code.

## Files

- \`toc.md\` — table of contents. **Start here.**
- \`sections/*.md\` — the book's text, in reading order, one file per chapter.
- \`manifest.json\` — metadata (chapter list, content hash).
- \`locations.json\` — block id → EPUB location. The app uses this to
  navigate and highlight; you do not need to read it.

## How to navigate

Read \`toc.md\`, then open the section file(s) you need with your file tools.
To find a topic across the whole book, search within this directory. You do
**not** need to read every file — open only the sections relevant to the
question.

## How to cite (important)

Every paragraph and heading in the section files begins with a block id in
double square brackets:

    [[b3-12]] The author argues attention is all you need.

When you answer a question using this EPUB, cite it in two parts so the app
can jump to the passage.

1. At the **very top of your answer**, declare this EPUB on its own line, with
   a number (start at 1; number each additional source you cite):

       [[epub1:${source}]]

2. After each claim, append \`[[N:blockid]]\` — the number from step 1 plus a
   block id copied **verbatim** from the section file:

       Attention replaced recurrence in sequence models [[1:b3-12]].

Always include the number, even when this is the only source cited. The app
turns each \`[[N:blockid]]\` token into a clickable link that opens the EPUB
and scrolls to that block. Never invent ids; prefer the most specific block,
and cite several if a claim spans multiple blocks.
`
}
