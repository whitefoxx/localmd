/**
 * Turn extracted DOCX blocks into the on-disk index: section files split on
 * the document's own headings, a table of contents, and agent instructions.
 * Mirrors the EPUB index so the agent navigates every document the same way.
 */
import { pad, slugify, writeAll } from '../util'
import { BUILDER, INDEX_VERSION, type DocxBlock, type DocxIndexManifest, type DocxSectionMeta } from './types'

interface BuildInput {
  /** KB-relative path of the index directory to write into. */
  indexDir: string
  /** Source DOCX path, relative to the KB root. */
  source: string
  title: string
  contentHash: string
  blocks: DocxBlock[]
}

/** Build + write the whole index directory. Returns the manifest. */
export async function buildIndex(input: BuildInput): Promise<DocxIndexManifest> {
  const { indexDir, source, title, contentHash, blocks } = input

  const groups = splitIntoSections(blocks, title)
  const sections: DocxSectionMeta[] = groups.map((g, i) => ({
    index: i + 1,
    title: g.title,
    file: `sections/${pad(i + 1)}-${slugify(g.title)}.md`,
  }))

  const files: { path: string; content: string }[] = groups.map((g, i) => ({
    path: sections[i].file,
    content: renderSection(sections[i], g.blocks),
  }))
  files.push({ path: 'toc.md', content: renderToc(title, source, groups, sections) })
  files.push({ path: '_README.md', content: renderReadme(title, source) })

  const manifest: DocxIndexManifest = {
    version: INDEX_VERSION,
    builder: BUILDER,
    source,
    title,
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
 * Cut the block stream into section files at the shallowest heading level that
 * occurs often enough to be a real chapter break. A document with no headings
 * (or a short one) stays a single section.
 */
export function splitIntoSections(
  blocks: DocxBlock[],
  title: string,
): { title: string; blocks: DocxBlock[] }[] {
  const MAX_BLOCKS = 250
  if (blocks.length <= MAX_BLOCKS) return [{ title, blocks }]

  let splitLevel = 0
  for (let lvl = 1; lvl <= 6; lvl++) {
    if (blocks.filter((b) => b.kind === 'heading' && b.level === lvl).length >= 2) {
      splitLevel = lvl
      break
    }
  }
  if (splitLevel === 0) return [{ title, blocks }]

  const out: { title: string; blocks: DocxBlock[] }[] = []
  let cur: DocxBlock[] = []
  for (const b of blocks) {
    if (b.kind === 'heading' && b.level === splitLevel && cur.length > 0) {
      out.push({ title: sectionTitle(cur, title, out.length), blocks: cur })
      cur = []
    }
    cur.push(b)
  }
  if (cur.length > 0) out.push({ title: sectionTitle(cur, title, out.length), blocks: cur })
  return out
}

function sectionTitle(blocks: DocxBlock[], docTitle: string, index: number): string {
  const head = blocks.find((b) => b.kind === 'heading')
  return head ? head.text : index === 0 ? docTitle : `${docTitle} (part ${index + 1})`
}

/** Render one section file: a `#` title then every block, each tagged `[[id]]`. */
function renderSection(sec: DocxSectionMeta, blocks: DocxBlock[]): string {
  const out: string[] = [`<!-- section ${pad(sec.index)} -->`]
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
    } else if (b.kind === 'list') {
      out.push(`${'  '.repeat(Math.max(0, b.level - 1))}- [[${b.id}]] ${b.text}`, '')
    } else if (b.kind === 'quote') {
      out.push(`> [[${b.id}]] ${b.text}`, '')
    } else if (b.kind === 'table') {
      out.push(`[[${b.id}]] (table)`, ...b.text.split('\n').map((r) => `| ${r} |`), '')
    } else {
      out.push(`[[${b.id}]] ${b.text}`, '')
    }
  }
  if (body.length === 0 && blocks.length === 0) {
    out.push('_No extractable text in this section._', '')
  }
  return out.join('\n')
}

/** Render `toc.md` — the document's heading outline, linked to section files. */
function renderToc(
  title: string,
  source: string,
  groups: { title: string; blocks: DocxBlock[] }[],
  sections: DocxSectionMeta[],
): string {
  const out: string[] = [
    `# ${title} — contents`,
    '',
    `> Location-aware index of \`${source}\`. Read \`_README.md\` for how to`,
    '> navigate these files and how to cite passages back to the document.',
    '',
  ]
  const rows: string[] = []
  groups.forEach((g, i) => {
    for (const h of g.blocks) {
      if (h.kind !== 'heading') continue
      const indent = '  '.repeat(Math.max(0, Math.min(5, h.level - 1)))
      rows.push(`${indent}- [${h.text}](${sections[i].file})`)
    }
  })
  // A document with no headings still gets one line per section file.
  if (rows.length === 0) for (const s of sections) rows.push(`- [${s.title}](${s.file})`)
  out.push(...rows, '')
  return out.join('\n')
}

/** Render `_README.md` — instructions for the AI agent reading this index. */
function renderReadme(title: string, source: string): string {
  return `# DOCX index — ${title}

This folder is a **parsed, location-aware index** of the Word document
\`${source}\`, generated so an AI agent can read it like source code.

## Files

- \`toc.md\` — heading outline. **Start here.**
- \`sections/*.md\` — the document's text in reading order, one file per chapter.
- \`manifest.json\` — metadata (section list, content hash).

## How to navigate

Read \`toc.md\`, then open the section file(s) you need with your file tools.
To find a topic across the whole document, search within this directory. You do
**not** need to read every file — open only the sections relevant to the
question.

## How to cite (important)

Every paragraph, heading, list item, and table in the section files begins with
a block id in double square brackets:

    [[b1-12]] The strategy targets niche communities first.

When you answer a question using this document, cite it in two parts so the app
can jump to the passage.

1. At the **very top of your answer**, declare this document on its own line,
   with a number (start at 1; number each additional source you cite):

       [[docx1:${source}]]

2. After each claim, append \`[[N:blockid]]\` — the number from step 1 plus a
   block id copied **verbatim** from the section file:

       Community-first launches beat broad ad spend [[1:b1-12]].

Always include the number, even when this is the only source cited. The app
turns each \`[[N:blockid]]\` token into a clickable link that opens the document
and scrolls to that block. Never invent ids; prefer the most specific block,
and cite several if a claim spans multiple blocks.
`
}
