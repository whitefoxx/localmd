/**
 * Index a markdown source under `.localmd/md-index/` — one section file per
 * H1/H2 run, every block tagged `[[id]]`, plus toc/README/manifest.
 * Mirrors the EPUB/PDF indexes so the agent navigates them the same way.
 */
import * as fs from '@/lib/fs'
import { indexDirFor, pad, readFreshManifest, sha256Hex, slugify, writeAll } from '../util'
import { parseMarkdownDoc, type MdBlock, type MdSection } from './parse'
import { extractTitle, baseName } from '@/lib/wiki'

/** READ CONTRACT — see pdf/types.ts for the INDEX_VERSION/BUILDER split. */
export const INDEX_VERSION = 1
/** Algorithm revision — a rebuild suggestion, never an invalidation. */
export const BUILDER = 1

export interface MdSectionMeta {
  index: number
  title: string
  /** Section file path, relative to the index directory. */
  file: string
}

export interface MdIndexManifest {
  version: number
  /** Algorithm revision that produced this index (absent = 1, pre-split). */
  builder?: number
  /** KB-relative path of the markdown source. */
  source: string
  title: string
  blockCount: number
  contentHash: string
  parsedAt: string
  sections: MdSectionMeta[]
}

export interface MdParseResult {
  indexDir: string
  manifest: MdIndexManifest
  cached: boolean
}

export async function indexMarkdown(
  source: string,
  opts: { force?: boolean } = {},
): Promise<MdParseResult> {
  const indexDir = indexDirFor('md', source)
  const content = await fs.readFile(source)
  const contentHash = await sha256Hex(new TextEncoder().encode(content).buffer as ArrayBuffer)

  // Older-builder indexes stay fresh — only an explicit `force` rebuilds.
  if (!opts.force) {
    const fresh = await readFreshManifest<MdIndexManifest>(indexDir, INDEX_VERSION, contentHash)
    if (fresh) return { indexDir, manifest: fresh, cached: true }
  }

  const title = extractTitle(content) ?? baseName(source).replace(/\.md$/i, '')
  const sections = parseMarkdownDoc(content, title)

  const metas: MdSectionMeta[] = sections.map((s, i) => ({
    index: i + 1,
    title: s.title,
    file: `sections/${pad(i + 1)}-${slugify(s.title)}.md`,
  }))

  const files: { path: string; content: string }[] = []
  sections.forEach((s, i) =>
    files.push({ path: metas[i].file, content: renderSection(metas[i], s) }),
  )
  files.push({ path: 'toc.md', content: renderToc(title, source, metas) })
  files.push({ path: '_README.md', content: renderReadme(title, source) })

  const manifest: MdIndexManifest = {
    version: INDEX_VERSION,
    builder: BUILDER,
    source,
    title,
    blockCount: sections.reduce((n, s) => n + s.blocks.length, 0),
    contentHash,
    parsedAt: new Date().toISOString(),
    sections: metas,
  }
  files.push({ path: 'manifest.json', content: JSON.stringify(manifest, null, 2) })

  await writeAll(indexDir, files)
  return { indexDir, manifest, cached: false }
}

/** Render one section file: a `#` title then every block, each tagged `[[id]]`. */
function renderSection(meta: MdSectionMeta, section: MdSection): string {
  const out: string[] = [`<!-- section ${pad(meta.index)} -->`]
  let body = section.blocks
  if (body.length > 0 && body[0].kind === 'heading') {
    out.push(`# [[${body[0].id}]] ${body[0].text}`, '')
    body = body.slice(1)
  } else {
    out.push(`# ${meta.title}`, '')
  }
  for (const b of body) out.push(renderBlock(b), '')
  if (section.blocks.length === 0) out.push('_Empty section._', '')
  return out.join('\n')
}

function renderBlock(b: MdBlock): string {
  if (b.kind === 'heading') {
    const hashes = '#'.repeat(Math.min(6, Math.max(2, b.level + 1)))
    return `${hashes} [[${b.id}]] ${b.text}`
  }
  if (b.kind === 'code') return `[[${b.id}]]\n\`\`\`\n${b.text}\n\`\`\``
  // Lists / quotes / tables span multiple lines — keep the id on its own line.
  if (b.kind === 'paragraph') return `[[${b.id}]] ${b.text}`
  return `[[${b.id}]]\n${b.text}`
}

function renderToc(title: string, source: string, sections: MdSectionMeta[]): string {
  const out: string[] = [
    `# ${title} — contents`,
    '',
    `> Location-aware index of \`${source}\`. Read \`_README.md\` for how to`,
    '> navigate these files and how to cite passages back to the source.',
    '',
  ]
  for (const s of sections) out.push(`- [${s.title}](${s.file})`)
  out.push('')
  return out.join('\n')
}

function renderReadme(title: string, source: string): string {
  return `# Markdown index — ${title}

This folder is a **parsed, location-aware index** of the markdown source
\`${source}\`, generated so an AI agent can cite passages that the app can
scroll to and highlight.

## Files

- \`toc.md\` — table of contents. **Start here.**
- \`sections/*.md\` — the source's text, in reading order, every block tagged.
- \`manifest.json\` — metadata (section list, content hash).

You may also read the raw source directly, but **only the section files carry
the block ids** needed to cite.

## How to cite (important)

Every block in the section files begins with a block id in double brackets:

    [[b2-3]] The author argues attention is all you need.

When you answer using this source, cite it in two parts so the app can jump to
the passage.

1. At the **very top of your answer**, declare this source on its own line,
   numbered (start at 1; number each additional source you cite):

       [[md1:${source}]]

2. After each claim, append \`[[N:blockid]]\` — the number from step 1 plus a
   block id copied **verbatim** from a section file:

       Attention replaced recurrence in sequence models [[1:b2-3]].

Always include the number, even when this is the only source cited. The app
turns each \`[[N:blockid]]\` token into a clickable link that opens the source
and scrolls to that block. Never invent ids.
`
}
