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
import { splitIntoChunks, guessLang, pickVoice } from '@/lib/tts'

export const useTtsStore = defineStore('tts', () => {
  const settings = useSettingsStore()
  const synth = typeof window !== 'undefined' ? window.speechSynthesis : undefined

  const voices = ref<SpeechSynthesisVoice[]>([])
  const playing = ref(false)
  const paused = ref(false)
  const title = ref('') // label of what's being read, shown on the bar
  const chunkText = ref('') // the sentence currently being spoken (for highlight-follow)

  const available = computed(() => !!synth)
  // Only Google voices in the picker (the user asked for those); local voices
  // stay off the list but still power the automatic offline fallback.
  const googleVoices = computed(() => voices.value.filter((v) => v.name.startsWith('Google')))

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
  let chunks: string[] = []
  let idx = 0
  let lang: 'zh' | 'en' = 'en'
  let fellBack = false
  let gen = 0

  function speakChunk(myGen: number): void {
    if (!synth || myGen !== gen) return
    if (idx >= chunks.length) {
      finish()
      return
    }
    chunkText.value = chunks[idx] // drives highlight-follow in the reading views
    const u = new SpeechSynthesisUtterance(chunks[idx])
    const v = pickVoice(voices.value, {
      name: settings.state.ttsVoice || undefined,
      lang,
      online: navigator.onLine && !fellBack,
    })
    if (v) {
      u.voice = v
      u.lang = v.lang
    }
    u.rate = settings.state.ttsRate || 1
    u.onend = () => {
      if (myGen !== gen) return
      idx++
      speakChunk(myGen)
    }
    u.onerror = (e: SpeechSynthesisErrorEvent) => {
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

  function finish(): void {
    playing.value = false
    paused.value = false
    title.value = ''
    chunkText.value = ''
  }

  /** Start reading `text` (label shown on the bar). Replaces any current read. */
  function speak(text: string, label = ''): void {
    if (!synth) return
    const cs = splitIntoChunks(text)
    gen++ // invalidate any in-flight run before cancelling it
    synth.cancel()
    if (!cs.length) {
      finish()
      return
    }
    chunks = cs
    idx = 0
    fellBack = false
    lang = guessLang(text)
    title.value = label
    playing.value = true
    paused.value = false
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
    playing,
    paused,
    title,
    chunkText,
    speak,
    pause,
    resume,
    toggle,
    stop,
  }
})
