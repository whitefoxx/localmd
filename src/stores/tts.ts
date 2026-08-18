/**
 * Read-aloud controller over the Web Speech API (window.speechSynthesis). One
 * playback at a time, app-wide. Text is split into sentence chunks and spoken
 * sequentially — short utterances dodge Chrome's ~15s cutoff and give a clean
 * place to hang sentence highlighting later.
 *
 * Voice policy: the picker offers Google voices (network, consistent across
 * platforms); if one fails or we're offline, playback auto-falls-back to a local
 * system voice of the same language, so it keeps working offline. That fallback
 * is remembered for the rest of the session — see `networkDead`.
 */
import { defineStore } from 'pinia'
import { ref, computed, watch } from 'vue'
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
  /**
   * A network (Google) voice was handed to the engine and never started, so
   * every read for the rest of this session goes straight to local voices.
   *
   * Session-scoped, not per-read, and that is the whole point. Where Google is
   * unreachable (mainland China, an offline machine, a captive network) the
   * fallback used to be re-discovered on every single read: four seconds of
   * silence, then a local voice starting over the dead one — which the engine
   * does not reliably silence on cancel(), so you hear BOTH. Once is a hiccup;
   * once per read is the bug that got reported. An explicit voice change is a
   * fresh statement of intent, so it clears this.
   */
  let networkDead = false
  /** A network voice has actually spoken here, so the network reaches it. */
  let networkProven = false
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

  /**
   * Arm the silent-hang watchdog for chunk `i` (due to start now): a network
   * (Google) voice on a connection that can't reach Google (e.g. mainland
   * China — navigator.onLine is TRUE but google.com is blocked) often hangs
   * with no onstart and no onerror. After the fallback this is unnecessary:
   * restartFrom rebuilds the queue with local voices, which start instantly.
   *
   * The first attempt of a session is given a short leash and every later one a
   * long leash, because the two are waiting for different things. Before a
   * network voice has ever spoken here, the question is whether it can reach
   * Google at all — and every second of that wait is a second in which the
   * engine may start playing the utterance we are about to talk over. Once one
   * HAS spoken, a slow start is just a slow start, and cutting it off would
   * downgrade the voice for the rest of the session over one stutter.
   */
  const FIRST_TRY_MS = 1500
  const PROVEN_MS = 4000
  function armWatchdog(i: number, myGen: number): void {
    clearWatchdog()
    if (networkDead) return
    watchdog = setTimeout(
      () => {
        watchdog = null
        if (myGen !== gen || paused.value) return
        networkDead = true
        restartFrom(i, myGen)
      },
      networkProven ? PROVEN_MS : FIRST_TRY_MS,
    )
  }

  /** Cancel everything queued and rebuild from chunk `i`. Used when falling back
   *  to local voices — the queued-ahead utterance still carries the dead network
   *  voice, so it must be purged along with the current one. The pause before
   *  re-queueing is not just superstition about cancel()+speak() in one tick:
   *  it is the engine's chance to actually silence what it was doing before a
   *  second voice starts on top of it. */
  const CANCEL_SETTLE_MS = 250
  function restartFrom(i: number, myGen: number): void {
    if (!synth || myGen !== gen) return
    synth.cancel() // queued utterances surface onerror('interrupted') — ignored
    queuedUpTo = i - 1
    setTimeout(() => queueAhead(i, myGen), CANCEL_SETTLE_MS)
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
      online: navigator.onLine && !networkDead,
    })
    if (v) {
      u.voice = v
      u.lang = v.lang
    }
    u.rate = settings.state.ttsRate || 1
    u.onstart = () => {
      if (myGen !== gen) return
      clearWatchdog()
      if (v && !v.localService) networkProven = true
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
      if (!networkDead && (e.error === 'network' || e.error.startsWith('synthesis'))) {
        networkDead = true
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

  // Picking a voice is a fresh statement of intent — including "try the network
  // one again", which is why it is the one thing that clears networkDead.
  watch(
    () => settings.state.ttsVoice,
    () => {
      networkDead = false
      networkProven = false
    },
  )

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
