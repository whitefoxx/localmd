/**
 * Markdown → HTML for the preview pane: marked with a custom inline extension
 * that renders [[wikilinks]] as clickable anchors. Link resolution (does the
 * target page exist, and where) is injected per render so this module stays
 * store-agnostic.
 */
import { Marked } from 'marked'
import katex from 'katex'
import 'katex/dist/katex.min.css'
import hljs from 'highlight.js/lib/core'
import javascript from 'highlight.js/lib/languages/javascript'
import typescript from 'highlight.js/lib/languages/typescript'
import python from 'highlight.js/lib/languages/python'
import json from 'highlight.js/lib/languages/json'
import bash from 'highlight.js/lib/languages/bash'
import xml from 'highlight.js/lib/languages/xml'
import css from 'highlight.js/lib/languages/css'
import markdownLang from 'highlight.js/lib/languages/markdown'
import yaml from 'highlight.js/lib/languages/yaml'
import sql from 'highlight.js/lib/languages/sql'
import go from 'highlight.js/lib/languages/go'
import rust from 'highlight.js/lib/languages/rust'
import java from 'highlight.js/lib/languages/java'
import cpp from 'highlight.js/lib/languages/cpp'
import diff from 'highlight.js/lib/languages/diff'
import { splitLink, escapeHtml, splitFrontmatter } from './wiki'
import { citationHtml, isCitationToken, parseCiteSources, type CiteSource } from './citations'

// Core build + a curated language set keeps the bundle sane; unknown
// languages fall back to escaped plain text.
hljs.registerLanguage('javascript', javascript)
hljs.registerLanguage('typescript', typescript)
hljs.registerLanguage('python', python)
hljs.registerLanguage('json', json)
hljs.registerLanguage('bash', bash)
hljs.registerLanguage('xml', xml) // also html
hljs.registerLanguage('css', css)
hljs.registerLanguage('markdown', markdownLang)
hljs.registerLanguage('yaml', yaml)
hljs.registerLanguage('sql', sql)
hljs.registerLanguage('go', go)
hljs.registerLanguage('rust', rust)
hljs.registerLanguage('java', java)
hljs.registerLanguage('cpp', cpp)
hljs.registerLanguage('diff', diff)

const LANG_ALIASES: Record<string, string> = {
  js: 'javascript',
  jsx: 'javascript',
  ts: 'typescript',
  tsx: 'typescript',
  py: 'python',
  sh: 'bash',
  shell: 'bash',
  zsh: 'bash',
  html: 'xml',
  vue: 'xml',
  yml: 'yaml',
  c: 'cpp',
  'c++': 'cpp',
  golang: 'go',
  md: 'markdown',
}

// A hover copy button in the corner of every rendered code block. The click is
// handled by a delegated listener (handleCodeCopy) on the preview container.
const CODE_COPY_BTN =
  '<button class="code-copy" type="button" title="Copy" aria-label="Copy code"><span class="codicon codicon-copy"></span></button>'

function wrapCodeBlock(pre: string): string {
  return `<div class="code-block">${CODE_COPY_BTN}${pre}</div>`
}

function highlightCode(code: string, infostring?: string): string {
  const lang = LANG_ALIASES[infostring ?? ''] ?? infostring ?? ''
  if (lang && hljs.getLanguage(lang)) {
    try {
      const html = hljs.highlight(code, { language: lang, ignoreIllegals: true }).value
      return wrapCodeBlock(`<pre><code class="hljs language-${escapeHtml(lang)}">${html}</code></pre>`)
    } catch {
      /* fall through to plain */
    }
  }
  return wrapCodeBlock(`<pre><code class="hljs">${escapeHtml(code)}</code></pre>`)
}

export interface WikilinkResolver {
  /** Returns the KB-relative path for a wikilink target, or null if missing. */
  resolve(target: string): string | null
}

interface WikilinkToken {
  type: 'wikilink'
  raw: string
  inner: string
}

interface CitationToken {
  type: 'citation'
  raw: string
  inner: string
}

/* ── math (KaTeX) ─────────────────────────────────────────────────────────
 * Custom tokenizers instead of marked-katex-extension: its standard mode
 * misses CJK-adjacent math (当$x>0$时) and its nonStandard mode swallows
 * dollar amounts ($5,那件 $10). Pandoc's rules thread the needle:
 *   - the opening $ must be immediately followed by non-whitespace
 *   - the closing $ must be immediately preceded by non-whitespace
 *   - the closing $ must not be immediately followed by a digit          */

// $$…$$ anywhere in inline position (single-line display math).
const INLINE_BLOCK_RULE = /^\$\$([^$]+?)\$\$/
// Pandoc-style $…$ (see above).
const INLINE_RULE = /^\$(?!\s)((?:\\.|[^\\\n$])+?)\$(?!\d)/

/** The same delimiters, for the editor's live rendering. Shared rather than
 *  re-derived: two sets of math rules would disagree about `$5,那件 $10`, and
 *  the editor and the preview would render the same note differently. */
export const MATH_RULES = { inlineBlock: INLINE_BLOCK_RULE, inline: INLINE_RULE }
// A paragraph-level $$ … $$ block, possibly spanning multiple lines.
const BLOCK_RULE = /^\$\$([\s\S]+?)\$\$\s*(?:\n+|$)/

function renderMath(tex: string, displayMode: boolean): string {
  return katex.renderToString(tex.trim(), { throwOnError: false, displayMode })
}

interface MathToken {
  type: 'blockMath' | 'inlineMath'
  raw: string
  tex: string
  display: boolean
}

const mathExtensions = [
  {
    name: 'blockMath',
    level: 'block' as const,
    start: (src: string) => {
      const i = src.indexOf('$$')
      return i < 0 ? undefined : i
    },
    tokenizer(src: string): MathToken | undefined {
      const m = BLOCK_RULE.exec(src)
      if (!m) return undefined
      return { type: 'blockMath', raw: m[0], tex: m[1], display: true }
    },
    renderer: (t: unknown) => renderMath((t as MathToken).tex, true),
  },
  {
    name: 'inlineMath',
    level: 'inline' as const,
    start: (src: string) => {
      const i = src.indexOf('$')
      return i < 0 ? undefined : i
    },
    tokenizer(src: string): MathToken | undefined {
      const block = INLINE_BLOCK_RULE.exec(src)
      if (block) return { type: 'inlineMath', raw: block[0], tex: block[1], display: true }
      const m = INLINE_RULE.exec(src)
      if (!m || !m[1].trim() || /\s$/.test(m[1])) return undefined
      return { type: 'inlineMath', raw: m[0], tex: m[1], display: false }
    },
    renderer: (t: unknown) => {
      const tok = t as MathToken
      return renderMath(tok.tex, tok.display)
    },
  },
]

/** Image sources the browser can fetch on its own. Everything else is a KB path. */
const EXTERNAL_SRC = /^(https?:|data:|blob:|\/\/)/i

export interface RenderOptions {
  /** Citation source declarations from surrounding context (e.g. the whole
   *  chat session) for resolving [[N:block]] chips in a partial text. */
  citeSources?: Map<string, CiteSource>
  /**
   * Turn `` `some/path.md` `` into a link to that file — given a resolver that
   * answers with the KB path, or null for anything that is not one.
   *
   * Opt-in, and only ever used where a resolver is passed: in a note, a code
   * span is code, and quietly linkifying the ones that happen to name a file
   * would be the app editing what the user wrote. In the agent transcript it
   * is the opposite — "created `wiki/x.md`" is a pointer, and having to find
   * the file in the tree by hand is the friction.
   *
   * Resolution must be EXACT, and the KB is a soft constraint: a path that
   * names no file stays a plain code span rather than becoming a broken link
   * or an offer to create something. A file the agent is about to write is
   * simply not clickable yet, and becomes so once it exists.
   */
  resolvePath?: (text: string) => string | null
}

/** Marked hands `codespan` its text already escaped; resolution needs the
 *  characters back. Only the five entities marked's own escape produces. */
function unescapeHtml(s: string): string {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
}

export function renderMarkdown(
  content: string,
  resolver: WikilinkResolver,
  opts: RenderOptions = {},
): string {
  const { body } = splitFrontmatter(content)
  // Which source number is which document. Collected up front because a chip
  // may be rendered before the `[[pdf1:…]]` that declares its source is
  // reached, and `citeSources` adds declarations from outside this text (chat
  // messages render part by part).
  const sources = parseCiteSources(body)
  for (const [num, src] of opts.citeSources ?? []) {
    if (!sources.has(num)) sources.set(num, src)
  }

  const marked = new Marked({
    gfm: true,
    breaks: false,
  })

  marked.use({
    renderer: {
      code(code: string, infostring: string | undefined) {
        return highlightCode(code, infostring?.trim().split(/\s+/)[0]?.toLowerCase())
      },
      codespan(text: string) {
        const path = opts.resolvePath?.(unescapeHtml(text).trim())
        if (!path) return `<code>${text}</code>`
        // The anchor carries the path and the code keeps its own styling, so a
        // linked path still reads as a path. No href: like a wikilink, this is
        // resolved by the click handler, not by the browser.
        return `<a class="file-path" data-path="${escapeHtml(path)}"><code>${text}</code></a>`
      },
      image(href: string, title: string | null, text: string) {
        const alt = ` alt="${escapeHtml(text ?? '')}"`
        const t = title ? ` title="${escapeHtml(title)}"` : ''
        // A picture stored in the knowledge base cannot be fetched by URL —
        // the app is not served from the user's folder, so `src="shot.png"`
        // resolves against the app's origin and shows a broken image. Hand it
        // to the viewer as data-kb-src instead; resolveKbImages swaps in a
        // blob URL once the file has been read through the file-system handle.
        if (EXTERNAL_SRC.test(href)) return `<img src="${escapeHtml(href)}"${alt}${t}>`
        return `<img data-kb-src="${escapeHtml(href)}"${alt}${t} class="kb-image">`
      },
    },
    extensions: [
      ...mathExtensions,
      {
        name: 'wikilink',
        level: 'inline',
        start(src: string) {
          const i = src.indexOf('[[')
          return i < 0 ? undefined : i
        },
        tokenizer(src: string) {
          const m = /^\[\[([^\[\]]+)\]\]/.exec(src)
          if (!m) return undefined
          return { type: 'wikilink', raw: m[0], inner: m[1] } as WikilinkToken
        },
        renderer(token) {
          const { target, label } = splitLink((token as unknown as WikilinkToken).inner)
          const resolved = resolver.resolve(target)
          const cls = resolved ? 'wikilink' : 'wikilink wikilink-broken'
          const data = resolved ?? target
          return `<a class="${cls}" data-target="${escapeHtml(data)}" data-resolved="${resolved ? '1' : ''}">${escapeHtml(label)}</a>`
        },
      },
      // Citation tokens ([[pdf1:…]], [[1:b14-3]]) share the [[…]] syntax but
      // are not wikilinks, so they must be tried first — which is why this is
      // registered LAST: marked unshifts each extension, so the most recently
      // registered tokenizer runs before the others. (The test named "consumes
      // citation tokens before the wikilink pass" is what holds this order.)
      //
      // Being a tokenizer rather than a pass over the whole text is what keeps
      // a citation written inside code literal: the tokenizer is never offered
      // the inside of a code span or fence.
      {
        name: 'citation',
        level: 'inline',
        start(src: string) {
          const i = src.indexOf('[[')
          return i < 0 ? undefined : i
        },
        tokenizer(src: string) {
          const m = /^\[\[([^\[\]]+)\]\]/.exec(src)
          if (!m || !isCitationToken(m[1])) return undefined
          return { type: 'citation', raw: m[0], inner: m[1] } as CitationToken
        },
        renderer(token) {
          const inner = (token as unknown as CitationToken).inner
          // isCitationToken passed, so this is non-null; the token's own text
          // is the honest fallback if the two ever disagree.
          return citationHtml(inner, sources) ?? escapeHtml(`[[${inner}]]`)
        },
      },
    ],
  })

  return marked.parse(body, { async: false }) as string
}
