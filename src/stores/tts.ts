/**
 * Read-aloud controller over the Web Speech API (window.speechSynthesis). One
 * playback at a time, app-wide. Text is split into sentence chunks and spoken
 * sequentially — short utterances dodge Chrome's ~15s cutoff and give a clean
 * place to hang sentence highlighting later.
 *
 * Voice policy: the picker offers Google voices (network, consistent across
 * platforms); if one fails or we're offline, playback auto-falls-back to a local
 * system voice of the same language, so it keeps working offline.
 */
import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { useSettingsStore } from './settings'
import {
  splitIntoChunks,
  chunkSegments,
  guessLang,
  pickVoice,
  type SpeechChunk,
  type TtsLang,
} from '@/lib/tts'

export const useTtsStore = defineStore('tts', () => {
  const settings = useSettingsStore()
  const synth = typeof window !== 'undefined' ? window.speechSynthesis : undefined

  const voices = ref<SpeechSynthesisVoice[]>([])
  const playing = ref(false)
  const paused = ref(false)
  const title = ref('') // label of what's being read, shown on the bar
  const chunkText = ref('') // the sentence currently being spoken (for highlight-follow)
  const chunkPage = ref<number | null>(null) // its source page, when segments carry one (PDF)
  const chunkBlock = ref<string | null>(null) // its source block id (PDF highlight-follow)

  const available = computed(() => !!synth)
  // The picker groups Google voices (network, best quality) and local system
  // voices (offline / zero-wait where Google is unreachable, e.g. mainland
  // China). Local voices also power the automatic fallback.
  const googleVoices = computed(() => voices.value.filter((v) => v.name.startsWith('Google')))
  const localVoices = computed(() => voices.value.filter((v) => v.localService))

  function loadVoices(): void {
    if (synth) voices.value = synth.getVoices()
  }
  if (synth) {
    loadVoices()
    // Voices load async in Chrome; refresh when they arrive.
    synth.addEventListener('voiceschanged', loadVoices)
  }

  // Playback state (non-reactive; a generation token invalidates the callbacks
  // of a superseded/stopped run so a stray onend/onerror can't advance it).
  let chunks: SpeechChunk[] = []
  let idx = 0
  let docLang: TtsLang = 'en' // whole-input language; fallback for signal-less chunks
  let fellBack = false
  let gen = 0
  let onFinishCb: (() => void) | null = null

  function speakChunk(myGen: number): void {
    if (!synth || myGen !== gen) return
    if (idx >= chunks.length) {
      finish(true)
      return
    }
    chunkText.value = chunks[idx].text // drives highlight-follow in the reading views
    chunkPage.value = chunks[idx].page ?? null
    chunkBlock.value = chunks[idx].block ?? null
    const u = new SpeechSynthesisUtterance(chunks[idx].text)
    // Per-chunk language: mixed documents switch voice sentence by sentence.
    const v = pickVoice(voices.value, {
      name: settings.state.ttsVoice || undefined,
      lang: guessLang(chunks[idx].text, docLang),
      online: navigator.onLine && !fellBack,
    })
    if (v) {
      u.voice = v
      u.lang = v.lang
    }
    u.rate = settings.state.ttsRate || 1
    // Watchdog: a network (Google) voice on a connection that can't reach Google
    // (e.g. mainland China — navigator.onLine is TRUE but google.com is blocked)
    // often hangs silently: no onstart, no onerror. If speech hasn't started in
    // time, cancel and retry this chunk with a local voice.
    const watchdog =
      v && !v.localService && !fellBack
        ? setTimeout(() => {
            if (myGen !== gen) return
            fellBack = true
            synth.cancel() // its onerror('interrupted') is ignored below
            speakChunk(myGen)
          }, 4000)
        : null
    u.onstart = () => {
      if (watchdog) clearTimeout(watchdog)
    }
    u.onend = () => {
      if (watchdog) clearTimeout(watchdog)
      if (myGen !== gen) return
      idx++
      speakChunk(myGen)
    }
    u.onerror = (e: SpeechSynthesisErrorEvent) => {
      if (watchdog) clearTimeout(watchdog)
      if (myGen !== gen) return
      // cancel() during stop/replace surfaces here — already invalidated by gen.
      if (e.error === 'interrupted' || e.error === 'canceled') return
      // A network (Google) voice failed → retry this chunk once with a local one.
      if (!fellBack && (e.error === 'network' || e.error.startsWith('synthesis'))) {
        fellBack = true
        speakChunk(myGen)
        return
      }
      // Otherwise skip the bad chunk so one failure can't stall the whole read.
      idx++
      speakChunk(myGen)
    }
    synth.speak(u)
  }

  /** `natural` = ran out of chunks (vs stopped/replaced). Only a natural finish
   *  fires the onFinish callback — that's what lets the EPUB reader chain the
   *  next chapter without a stop button triggering runaway auto-advance. */
  function finish(natural = false): void {
    playing.value = false
    paused.value = false
    title.value = ''
    chunkText.value = ''
    chunkPage.value = null
    chunkBlock.value = null
    const cb = onFinishCb
    onFinishCb = null
    if (natural) cb?.()
  }

  /** Start reading (label shown on the bar). Replaces any current read. Input is
   *  plain text, or segments carrying page metadata for follow-along. */
  function speak(
    input: string | { text: string; page?: number; block?: string }[],
    label = '',
    opts: { onFinish?: () => void } = {},
  ): void {
    if (!synth) return
    const cs =
      typeof input === 'string'
        ? splitIntoChunks(input).map((text) => ({ text }) as SpeechChunk)
        : chunkSegments(input)
    gen++ // invalidate any in-flight run before cancelling it
    synth.cancel()
    onFinishCb = null
    if (!cs.length) {
      finish()
      return
    }
    chunks = cs
    idx = 0
    fellBack = false
    docLang = guessLang(cs.map((c) => c.text).join(' '))
    title.value = label
    playing.value = true
    paused.value = false
    onFinishCb = opts.onFinish ?? null
    // cancel()+speak() in the same tick can wedge Chrome's synth — let the
    // cancel settle first. myGen guards against a stop/replace landing meanwhile.
    const myGen = gen
    setTimeout(() => speakChunk(myGen), 0)
  }

  function pause(): void {
    if (!synth || !playing.value) return
    synth.pause()
    paused.value = true
  }
  function resume(): void {
    if (!synth) return
    synth.resume()
    paused.value = false
  }
  function toggle(): void {
    if (paused.value) resume()
    else pause()
  }

  /** Stop and clear. Bumps the generation so pending callbacks are ignored. */
  function stop(): void {
    gen++
    synth?.cancel()
    finish()
  }

  return {
    available,
    voices,
    googleVoices,
    localVoices,
    playing,
    paused,
    title,
    chunkText,
    chunkPage,
    chunkBlock,
    speak,
    pause,
    resume,
    toggle,
    stop,
  }
})
