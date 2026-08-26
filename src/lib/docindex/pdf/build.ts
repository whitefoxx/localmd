/**
 * Turn extracted blocks into the on-disk PDF index: a section tree (from the
 * embedded outline, detected headings, or one-file-per-page), a table of
 * contents, a block→coordinates map, and agent-facing instructions. The
 * on-disk format is the one existing KBs already hold.
 */
import { pad, slugify, writeAll, type IndexProgress } from '../util'
import {
  BUILDER,
  INDEX_VERSION,
  type OutlineNode,
  type PdfBlock,
  type PdfIndexManifest,
  type SectionMeta,
} from './types'

interface BuildInput {
  /** KB-relative path of the index directory to write into. */
  indexDir: string
  /** Source PDF path, relative to the KB root. */
  source: string
  title: string
  contentHash: string
  pageCount: number
  pageSizes: { w: number; h: number }[]
  blocks: PdfBlock[]
  /** Full id→place map from inheritIds — prior ids carried forward plus the
   *  current blocks. Absent (tests, first principles) → derived from blocks. */
  locations?: Record<string, { page: number; rects: PdfBlock['rects'] }>
  outline: { tree: OutlineNode[]; flat: { title: string; level: number; page: number }[] }
  /** Progress for the two halves this function owns: rendering the sections,
   *  then writing them out. Both were silent, and on a long document both take
   *  long enough to look like nothing happening. */
  onProgress?: IndexProgress
}

interface Boundary {
  page: number
  title: string
  level: number
}

/** Build + write the whole index directory. Returns the manifest. */
export async function buildIndex(input: BuildInput): Promise<PdfIndexManifest> {
  const { indexDir, source, title, contentHash, pageCount, pageSizes, blocks, outline } = input

  const { structure, boundaries } = pickStructure(blocks, outline, pageCount)
  const sections = buildSections(boundaries, pageCount)
  const sectionForPage = (page: number): SectionMeta =>
    sections.find((s) => page >= s.startPage && page <= s.endPage) ?? sections[sections.length - 1]

  const files: { path: string; content: string }[] = []
  for (const sec of sections) {
    files.push({ path: sec.file, content: renderSection(sec, blocks, source) })
    input.onProgress?.(files.length, sections.length, 'build')
  }
  files.push({
    path: 'toc.md',
    content: renderToc(title, source, structure, outline.tree, sections, sectionForPage),
  })
  files.push({ path: '_README.md', content: renderReadme(title, source) })

  const locations = input.locations ?? {}
  if (!input.locations) {
    for (const b of blocks) locations[b.id] = { page: b.page, rects: b.rects }
  }
  files.push({
    path: 'locations.json',
    content: JSON.stringify({ version: 1, pageSizes, blocks: locations }),
  })

  const manifest: PdfIndexManifest = {
    version: INDEX_VERSION,
    builder: BUILDER,
    source,
    title,
    pageCount,
    blockCount: blocks.length,
    contentHash,
    parsedAt: new Date().toISOString(),
    structure,
    sections,
  }
  files.push({ path: 'manifest.json', content: JSON.stringify(manifest, null, 2) })

  await writeAll(indexDir, files, (w, t) => input.onProgress?.(w, t, 'write'))
  return manifest
}

/** Choose how to split the document into section files. Exported for tests. */
export function pickStructure(
  blocks: PdfBlock[],
  outline: BuildInput['outline'],
  pageCount: number,
): { structure: PdfIndexManifest['structure']; boundaries: Boundary[] } {
  if (outline.flat.length >= 2) {
    return {
      structure: 'outline',
      boundaries: outline.flat.map((e) => ({ page: e.page, title: e.title, level: e.level })),
    }
  }
  // Headings: split on the SHALLOWEST level that actually spreads across the
  // document. Hardcoding level 1 lost real structure — a paper's only L1 is
  // its title (one page), while its section headings rank L2; the sections
  // are the boundaries worth having. A level whose heading count outruns the
  // page count is noise, not structure.
  const headings = blocks.filter((b) => b.kind === 'heading')
  for (let level = 1; level <= 3; level++) {
    const hs = headings.filter((b) => b.level === level)
    if (new Set(hs.map((b) => b.page)).size >= 2 && hs.length <= pageCount * 1.5) {
      return {
        structure: 'headings',
        boundaries: hs.map((b) => ({ page: b.page, title: b.text, level })),
      }
    }
  }
  return {
    structure: 'pages',
    boundaries: Array.from({ length: pageCount }, (_, i) => ({
      page: i + 1,
      title: `Page ${i + 1}`,
      level: 1,
    })),
  }
}

/** Turn boundary pages into contiguous, non-overlapping section page ranges. */
function buildSections(boundaries: Boundary[], pageCount: number): SectionMeta[] {
  const starts: Boundary[] = []
  for (const b of [...boundaries].filter((x) => x.page >= 1).sort((a, b) => a.page - b.page)) {
    const last = starts[starts.length - 1]
    if (last && last.page === b.page) {
      // Several outline entries share a page — title the section with the most major.
      if (b.level < last.level) starts[starts.length - 1] = b
      continue
    }
    starts.push(b)
  }
  if (starts.length === 0) starts.push({ page: 1, title: 'Document', level: 1 })

  const ranges: Omit<SectionMeta, 'index' | 'file'>[] = []
  if (starts[0].page > 1) {
    ranges.push({ title: 'Front matter', level: 1, startPage: 1, endPage: starts[0].page - 1 })
  }
  for (let i = 0; i < starts.length; i++) {
    const startPage = starts[i].page
    const endPage = i + 1 < starts.length ? starts[i + 1].page - 1 : pageCount
    ranges.push({
      title: starts[i].title,
      level: starts[i].level,
      startPage,
      endPage: Math.max(startPage, endPage),
    })
  }
  return ranges.map((r, i) => ({
    ...r,
    index: i + 1,
    file: `sections/${pad(i + 1)}-${slugify(r.title)}.md`,
  }))
}

/** Render one section file: a `#` title then every block, each tagged `[[id]]`.
 *  Boilerplate blocks are not rendered — their ids stay resolvable through
 *  locations.json, but running headers and folios earn no tokens. */
function renderSection(sec: SectionMeta, blocks: PdfBlock[], source: string): string {
  const own = blocks.filter(
    (b) => b.page >= sec.startPage && b.page <= sec.endPage && b.kind !== 'boilerplate',
  )
  const out: string[] = [
    `<!-- section ${pad(sec.index)} · pages ${sec.startPage}–${sec.endPage} · ${source} -->`,
  ]
  let body = own
  if (own.length > 0 && own[0].kind === 'heading') {
    out.push(`# [[${own[0].id}]] ${own[0].text}`, '')
    body = own.slice(1)
  } else {
    out.push(`# ${sec.title}`, '')
  }
  for (const b of body) {
    if (b.kind === 'heading') {
      out.push(`${b.level >= 2 ? '###' : '##'} [[${b.id}]] ${b.text}`, '')
    } else {
      out.push(`[[${b.id}]] ${b.text}`, '')
    }
  }
  if (body.length === 0) {
    out.push('_No extractable text on these pages (likely images or scanned content)._', '')
  }
  return out.join('\n')
}

/** Render `toc.md` — the outline tree (or section list) with links + pages. */
function renderToc(
  title: string,
  source: string,
  structure: PdfIndexManifest['structure'],
  tree: OutlineNode[],
  sections: SectionMeta[],
  sectionForPage: (page: number) => SectionMeta,
): string {
  const out: string[] = [
    `# ${title} — contents`,
    '',
    `> Location-aware index of \`${source}\`. Read \`_README.md\` for how to`,
    '> navigate these files and how to cite passages back to the PDF.',
    '',
  ]
  if (structure === 'outline' && tree.length > 0) {
    const walk = (nodes: OutlineNode[]): void => {
      for (const n of nodes) {
        const indent = '  '.repeat(Math.max(0, n.level - 1))
        if (n.page > 0) {
          out.push(`${indent}- [${n.title}](${sectionForPage(n.page).file}) · p.${n.page}`)
        } else {
          out.push(`${indent}- ${n.title}`)
        }
        walk(n.children)
      }
    }
    walk(tree)
  } else {
    for (const s of sections) {
      out.push(`- [${s.title}](${s.file}) · p.${s.startPage}–${s.endPage}`)
    }
  }
  out.push('')
  return out.join('\n')
}

/** Render `_README.md` — instructions for the AI agent reading this index. */
function renderReadme(title: string, source: string): string {
  return `# PDF index — ${title}

This folder is a **parsed, location-aware index** of the PDF \`${source}\`,
generated so an AI agent can read the document like source code.

## Files

- \`toc.md\` — table of contents. **Start here.**
- \`sections/*.md\` — the document text, in reading order, split into sections.
- \`manifest.json\` — metadata (page count, section list, content hash).
- \`locations.json\` — block id → PDF coordinates. The app uses this to
  draw highlights; you do not need to read it.

## How to navigate

Read \`toc.md\`, then open the section file(s) you need with your file tools.
To find a topic across the whole document, search within this directory. You
do **not** need to read every file — open only the sections relevant to the
question.

## How to cite (important)

Every paragraph and heading in the section files begins with a block id in
double square brackets:

    [[b14-3]] We trained the model on ImageNet for 90 epochs.

When you answer a question using this PDF, cite it in two parts so the app can
jump to the passage.

1. At the **very top of your answer**, declare this PDF on its own line, with
   a number (start at 1; number each additional PDF you cite):

       [[pdf1:${source}]]

2. After each claim, append \`[[N:blockid]]\` — the number from step 1 plus a
   block id copied **verbatim** from the section file:

       The model was trained for 90 epochs on ImageNet [[1:b14-3]].

Always include the number, even when this is the only PDF cited. The app turns
each \`[[N:blockid]]\` token into a clickable link that opens the PDF and
scrolls to that block. Never invent ids; prefer the most specific block, and
cite several if a claim spans multiple blocks.
`
}
