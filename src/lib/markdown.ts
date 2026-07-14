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
import { renderCitationTokens } from './citations'

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

function highlightCode(code: string, infostring?: string): string {
  const lang = LANG_ALIASES[infostring ?? ''] ?? infostring ?? ''
  if (lang && hljs.getLanguage(lang)) {
    try {
      const html = hljs.highlight(code, { language: lang, ignoreIllegals: true }).value
      return `<pre><code class="hljs language-${escapeHtml(lang)}">${html}</code></pre>`
    } catch {
      /* fall through to plain */
    }
  }
  return `<pre><code class="hljs">${escapeHtml(code)}</code></pre>`
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

export function renderMarkdown(content: string, resolver: WikilinkResolver): string {
  const { body: raw } = splitFrontmatter(content)
  // Citation tokens ([[pdf1:…]], [[1:b14-3]]) share the [[…]] syntax but are
  // not wikilinks — consume them first, before the wikilink tokenizer runs.
  const body = renderCitationTokens(raw)

  const marked = new Marked({
    gfm: true,
    breaks: false,
  })

  marked.use({
    renderer: {
      code(code: string, infostring: string | undefined) {
        return highlightCode(code, infostring?.trim().split(/\s+/)[0]?.toLowerCase())
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
    ],
  })

  return marked.parse(body, { async: false }) as string
}
