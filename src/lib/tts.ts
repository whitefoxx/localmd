/**
 * Pure helpers for read-aloud (Web Speech API). The stateful controller lives in
 * stores/tts.ts; everything here is side-effect-free and unit-testable.
 */

/** Split text into speakable chunks at sentence boundaries, each capped in length
 *  so Chrome's ~15s / long-utterance cutoff never truncates one. Sentences are
 *  spoken one at a time (see the store), which also sidesteps the "speech stops
 *  after 15s" bug that bites a single long utterance. */
export function splitIntoChunks(text: string, max = 220): string[] {
  const clean = text
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{2,}/g, '\n')
    .trim()
  if (!clean) return []
  // Break after Latin/CJK sentence enders, and at hard line breaks.
  const sentences = clean
    .split(/(?<=[.!?。！？…])\s*|\n+/)
    .map((s) => s.trim())
    .filter(Boolean)
  const chunks: string[] = []
  let cur = ''
  for (const s of sentences) {
    if (s.length > max) {
      // A single over-long sentence (rare; e.g. no punctuation): hard-split.
      if (cur) {
        chunks.push(cur)
        cur = ''
      }
      for (let i = 0; i < s.length; i += max) chunks.push(s.slice(i, i + max))
      continue
    }
    if (cur && (cur + ' ' + s).length > max) {
      chunks.push(cur)
      cur = s
    } else {
      cur = cur ? `${cur} ${s}` : s
    }
  }
  if (cur) chunks.push(cur)
  return chunks
}

/** A speakable chunk with optional source metadata (PDF page / block id) so
 *  playback can follow along — scroll to the page, highlight the block. */
export interface SpeechChunk {
  text: string
  page?: number
  block?: string
}

/** Chunk a list of segments, tagging every chunk with its segment's page/block.
 *  Used by the PDF reader so "what is being spoken" survives the chunking. */
export function chunkSegments(
  segments: { text: string; page?: number; block?: string }[],
): SpeechChunk[] {
  const out: SpeechChunk[] = []
  for (const seg of segments) {
    for (const text of splitIntoChunks(seg.text))
      out.push({ text, page: seg.page, block: seg.block })
  }
  return out
}

export type TtsLang = 'zh' | 'ja' | 'ko' | 'ru' | 'en'

/** Guess the language of `text` by script, for voice selection. Kana is checked
 *  before Han (Japanese uses both); text with no script signal at all (numbers,
 *  punctuation) falls back to `fallback` — callers pass the document's language
 *  so a stray "42." chunk doesn't flip the voice. */
export function guessLang(text: string, fallback: TtsLang = 'en'): TtsLang {
  const n = (re: RegExp): number => (text.match(re) || []).length
  const kana = n(/[぀-ヿ]/g)
  const hangul = n(/[가-힣]/g)
  const cyrillic = n(/[Ѐ-ӿ]/g)
  const han = n(/[一-鿿]/g)
  const latin = n(/[A-Za-z]/g)
  if (kana >= 2) return 'ja'
  if (hangul >= 2) return 'ko'
  if (cyrillic >= 2 && cyrillic > latin) return 'ru'
  if (han >= 2 && han * 4 >= latin) return 'zh'
  if (latin >= 4) return 'en'
  return fallback
}

/** Strip Markdown to plain readable text so TTS never voices `#`, `*`, backticks,
 *  link URLs, wikilink brackets, images or stray HTML. Frontmatter is removed by
 *  the caller. */
export function stripMarkdown(md: string): string {
  return md
    .replace(/```[\s\S]*?```/g, ' ') // fenced code
    .replace(/`([^`]+)`/g, '$1') // inline code
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ') // images
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1') // links → text
    .replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_m, a, b) => b || a) // wikilinks → label
    .replace(/^\s{0,3}#{1,6}\s+/gm, '') // headings
    .replace(/^\s{0,3}>\s?/gm, '') // blockquotes
    .replace(/^\s*[-*+]\s+/gm, '') // bullet markers
    .replace(/^\s*\d+\.\s+/gm, '') // ordered-list markers
    .replace(/[*_~]{1,3}([^*_~]+)[*_~]{1,3}/g, '$1') // emphasis
    .replace(/<[^>]+>/g, ' ') // stray HTML
    .replace(/\n{2,}/g, '\n')
    .trim()
}

/**
 * Choose a voice for a chunk in language `lang`. The user's explicit pick wins
 * while it speaks that language; for a chunk in a DIFFERENT language, auto-pick
 * a matching voice — so mixed-language documents (Chinese prose quoting English)
 * read each part with the right voice. Preference: Google voice for the
 * language, any voice for the language, the explicit pick, then anything.
 * When offline (or after a network voice failed), restrict to LOCAL voices so
 * speech still works — the offline fallback.
 */
export function pickVoice(
  voices: SpeechSynthesisVoice[],
  opts: { name?: string; lang: TtsLang; online: boolean },
): SpeechSynthesisVoice | null {
  if (!voices.length) return null
  const usable = (v: SpeechSynthesisVoice) => opts.online || v.localService
  const langMatch = (v: SpeechSynthesisVoice) => v.lang.toLowerCase().startsWith(opts.lang)
  const chosen = opts.name ? voices.find((v) => v.name === opts.name) : undefined
  if (chosen && langMatch(chosen) && usable(chosen)) return chosen
  const pool = voices.filter(usable)
  const matches = pool.filter(langMatch)
  // A LOCAL explicit pick signals "stay offline-fast" (e.g. Google unreachable):
  // auto-switching to another language then prefers local voices over Google.
  const preferLocal = !!chosen?.localService
  return (
    (preferLocal ? matches.find((v) => v.localService) : undefined) ??
    matches.find((v) => v.name.startsWith('Google')) ??
    matches[0] ??
    (chosen && usable(chosen) ? chosen : null) ??
    pool.find((v) => v.name.startsWith('Google')) ??
    pool[0] ??
    voices[0] ??
    null
  )
}
