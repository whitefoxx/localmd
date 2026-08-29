/**
 * Finding math in editor text, for live rendering.
 *
 * The markdown parser CodeMirror uses has no notion of `$…$` — math is not
 * part of CommonMark — so unlike every other decoration in richMarkdown.ts,
 * this one cannot come from the syntax tree and has to scan text. It reuses
 * the preview's delimiters (MATH_RULES) so both panes agree on what is a
 * formula and what is a price tag.
 *
 * Pure, and unit tested: the rules are subtle enough (CJK adjacency, dollar
 * amounts) that they earn their own tests rather than only being checked
 * through the rendered result.
 */
import { MATH_RULES } from '@/lib/markdown'

export interface MathSpan {
  from: number
  to: number
  tex: string
  display: boolean
}

/** Ranges that must never be read as math — code spans and the like. */
export type Protected = { from: number; to: number }[]

function overlaps(from: number, to: number, ranges: Protected): boolean {
  return ranges.some((r) => from < r.to && to > r.from)
}

/**
 * Inline math within `text`, offset by `base`. `protectedRanges` are absolute
 * document ranges (code, URLs) where a `$` is never a delimiter.
 */
export function findInlineMath(text: string, base: number, protectedRanges: Protected): MathSpan[] {
  const out: MathSpan[] = []
  for (let i = 0; i < text.length; i++) {
    const latex = text[i] === '\\' && (text[i + 1] === '(' || text[i + 1] === '[')
    if (text[i] !== '$' && !latex) continue
    const rest = text.slice(i)
    const block = latex
      ? MATH_RULES.latexInlineBlock.exec(rest)
      : MATH_RULES.inlineBlock.exec(rest)
    const m = block ?? (latex ? MATH_RULES.latexInline.exec(rest) : MATH_RULES.inline.exec(rest))
    if (!m) continue
    const from = base + i
    const to = from + m[0].length
    if (overlaps(from, to, protectedRanges)) continue
    out.push({ from, to, tex: m[1], display: Boolean(block) })
    i += m[0].length - 1
  }
  return out
}

/**
 * Display math written across lines:
 *
 *     $$
 *     E = mc^2
 *     $$
 *
 * Returned as line-number ranges because the whole block is replaced at once.
 * Single-line `$$…$$` is left to findInlineMath.
 */
export function findBlockMath(lines: string[]): { fromLine: number; toLine: number; tex: string }[] {
  const out = []
  for (let i = 0; i < lines.length; i++) {
    const open = lines[i].trim()
    if (open !== '$$' && open !== '\\[') continue
    const close = open === '$$' ? '$$' : '\\]'
    for (let j = i + 1; j < lines.length; j++) {
      if (lines[j].trim() !== close) continue
      out.push({ fromLine: i, toLine: j, tex: lines.slice(i + 1, j).join('\n') })
      i = j
      break
    }
  }
  return out
}
