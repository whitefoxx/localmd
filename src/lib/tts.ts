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

/** Guess a coarse language for default-voice selection: 'zh' when the text has a
 *  meaningful share of CJK, else 'en'. Only used to pick a sensible default. */
export function guessLang(text: string): 'zh' | 'en' {
  const cjk = (text.match(/[一-鿿぀-ヿ]/g) || []).length
  return cjk >= 8 || cjk / Math.max(1, text.length) > 0.1 ? 'zh' : 'en'
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
 * Choose a voice. Prefer the user's picked voice by name; otherwise a Google
 * voice for the target language, then any voice for that language, then anything.
 * When offline (or after a network voice failed), restrict to LOCAL voices so
 * speech still works — the offline fallback.
 */
export function pickVoice(
  voices: SpeechSynthesisVoice[],
  opts: { name?: string; lang: 'zh' | 'en'; online: boolean },
): SpeechSynthesisVoice | null {
  if (!voices.length) return null
  const chosen = opts.name ? voices.find((v) => v.name === opts.name) : undefined
  // Honor the explicit pick unless we're offline and it's a network voice.
  if (chosen && (opts.online || chosen.localService)) return chosen
  const pool = opts.online ? voices : voices.filter((v) => v.localService)
  const langMatch = (v: SpeechSynthesisVoice) => v.lang.toLowerCase().startsWith(opts.lang)
  return (
    pool.find((v) => langMatch(v) && v.name.startsWith('Google')) ??
    pool.find((v) => langMatch(v)) ??
    pool.find((v) => v.name.startsWith('Google')) ??
    pool[0] ??
    voices[0] ??
    null
  )
}
