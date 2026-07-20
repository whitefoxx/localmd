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
  let docLang: TtsLang = 'en' // whole-input language; fallback for signal-less chunks
  let fellBack = false
  let gen = 0
  let onFinishCb: (() => void) | null = null
  let queuedUpTo = -1 // highest chunk index handed to the synth's queue
  let watchdog: ReturnType<typeof setTimeout> | null = null
  // Chrome GC-collects utterances the page no longer references and silently
  // drops their events — a stalled queue mid-read. Hold in-flight ones strongly.
  const live = new Set<SpeechSynthesisUtterance>()

  function clearWatchdog(): void {
    if (watchdog) {
      clearTimeout(watchdog)
      watchdog = null
    }
  }

  /** Arm the silent-hang watchdog for chunk `i` (due to start now): a network
   *  (Google) voice on a connection that can't reach Google (e.g. mainland
   *  China — navigator.onLine is TRUE but google.com is blocked) often hangs
   *  with no onstart and no onerror. After the fallback this is unnecessary:
   *  restartFrom rebuilds the queue with local voices, which start instantly. */
  function armWatchdog(i: number, myGen: number): void {
    clearWatchdog()
    if (fellBack) return
    watchdog = setTimeout(() => {
      watchdog = null
      if (myGen !== gen || paused.value) return
      fellBack = true
      restartFrom(i, myGen)
    }, 4000)
  }

  /** Cancel everything queued and rebuild from chunk `i`. Used when falling back
   *  to local voices — the queued-ahead utterance still carries the dead network
   *  voice, so it must be purged along with the current one. */
  function restartFrom(i: number, myGen: number): void {
    if (!synth || myGen !== gen) return
    synth.cancel() // queued utterances surface onerror('interrupted') — ignored
    queuedUpTo = i - 1
    // cancel()+speak() in the same tick can wedge Chrome's synth — settle first.
    setTimeout(() => queueAhead(i, myGen), 0)
  }

  /** Hand chunk `i` to the synth's queue. The queue always holds the playing
   *  utterance PLUS the next one (queued from onstart), so the engine
   *  transitions between sentences natively — no audible JS round-trip gap.
   *  Voice and rate are locked in at queue time (one sentence ahead), so a bar
   *  change takes effect within two sentences. */
  function queueAhead(i: number, myGen: number): void {
    if (!synth || myGen !== gen || i >= chunks.length || i <= queuedUpTo) return
    queuedUpTo = i
    const chunk = chunks[i]
    const u = new SpeechSynthesisUtterance(chunk.text)
    // Per-chunk language: mixed documents switch voice sentence by sentence.
    const v = pickVoice(voices.value, {
      name: settings.state.ttsVoice || undefined,
      lang: guessLang(chunk.text, docLang),
      online: navigator.onLine && !fellBack,
    })
    if (v) {
      u.voice = v
      u.lang = v.lang
    }
    u.rate = settings.state.ttsRate || 1
    u.onstart = () => {
      if (myGen !== gen) return
      clearWatchdog()
      chunkText.value = chunk.text // drives highlight-follow in the viewers
      chunkPage.value = chunk.page ?? null
      chunkBlock.value = chunk.block ?? null
      queueAhead(i + 1, myGen) // keep the next sentence buffered behind this one
    }
    u.onend = () => {
      live.delete(u)
      if (myGen !== gen) return
      if (i + 1 >= chunks.length) {
        finish(true)
        return
      }
      armWatchdog(i + 1, myGen) // the queued next is due to start immediately
      if (queuedUpTo < i + 1) queueAhead(i + 1, myGen) // edge: never got queued
    }
    u.onerror = (e: SpeechSynthesisErrorEvent) => {
      live.delete(u)
      clearWatchdog()
      if (myGen !== gen) return
      // cancel() during stop/replace/fallback surfaces here — already handled.
      if (e.error === 'interrupted' || e.error === 'canceled') return
      // A network (Google) voice failed → rebuild from this chunk with local
      // voices (the queued-ahead utterance carries the same dead voice).
      if (!fellBack && (e.error === 'network' || e.error.startsWith('synthesis'))) {
        fellBack = true
        restartFrom(i, myGen)
        return
      }
      // Otherwise skip the bad chunk so one failure can't stall the whole read.
      if (i + 1 >= chunks.length) finish(true)
      else if (queuedUpTo < i + 1) queueAhead(i + 1, myGen)
      // (when the next chunk is already queued, the engine advances on its own)
    }
    live.add(u)
    synth.speak(u)
  }

  /** `natural` = ran out of chunks (vs stopped/replaced). Only a natural finish
   *  fires the onFinish callback — that's what lets the EPUB reader chain the
   *  next chapter without a stop button triggering runaway auto-advance. */
  function finish(natural = false): void {
    clearWatchdog()
    live.clear()
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
    fellBack = false
    queuedUpTo = -1
    docLang = guessLang(cs.map((c) => c.text).join(' '))
    title.value = label
    playing.value = true
    paused.value = false
    onFinishCb = opts.onFinish ?? null
    // cancel()+speak() in the same tick can wedge Chrome's synth — let the
    // cancel settle first. myGen guards against a stop/replace landing meanwhile.
    const myGen = gen
    setTimeout(() => {
      armWatchdog(0, myGen)
      queueAhead(0, myGen)
    }, 0)
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
