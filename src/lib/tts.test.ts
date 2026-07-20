import { describe, it, expect } from 'vitest'
import { splitIntoChunks, guessLang, stripMarkdown, pickVoice } from './tts'

describe('splitIntoChunks', () => {
  it('splits on Latin and CJK sentence enders', () => {
    expect(splitIntoChunks('Hi there. How are you? Fine!')).toEqual([
      'Hi there. How are you? Fine!',
    ])
    expect(splitIntoChunks('第一句。第二句！第三句？', 4)).toEqual(['第一句。', '第二句！', '第三句？'])
  })

  it('caps chunk length, merging short sentences up to max', () => {
    const chunks = splitIntoChunks('A. B. C. D.', 5)
    expect(chunks.every((c) => c.length <= 5)).toBe(true)
    expect(chunks.join(' ')).toContain('A.')
  })

  it('hard-splits a single over-long sentence with no punctuation', () => {
    const long = 'x'.repeat(500)
    const chunks = splitIntoChunks(long, 200)
    expect(chunks.length).toBe(3)
    expect(chunks.every((c) => c.length <= 200)).toBe(true)
  })

  it('returns [] for blank input', () => {
    expect(splitIntoChunks('   \n  ')).toEqual([])
  })
})

describe('guessLang', () => {
  it('detects Chinese vs English', () => {
    expect(guessLang('这是一段中文测试文本内容')).toBe('zh')
    expect(guessLang('This is an English sentence.')).toBe('en')
  })
})

describe('stripMarkdown', () => {
  it('drops syntax but keeps prose', () => {
    const out = stripMarkdown('# Title\n\nSee [docs](http://x) and [[Note|the note]].\n\n- item\n`code`')
    expect(out).toContain('Title')
    expect(out).toContain('See docs and the note.')
    expect(out).toContain('item')
    expect(out).not.toContain('#')
    expect(out).not.toContain('http://x')
    expect(out).not.toContain('`')
    expect(out).not.toContain('[[')
  })
})

describe('pickVoice', () => {
  const v = (name: string, lang: string, localService: boolean): SpeechSynthesisVoice =>
    ({ name, lang, localService, default: false, voiceURI: name }) as SpeechSynthesisVoice
  const voices = [
    v('Google US English', 'en-US', false),
    v('Google 普通话（中国大陆）', 'zh-CN', false),
    v('Ting-Ting', 'zh-CN', true),
    v('Samantha', 'en-US', true),
  ]

  it('honors an explicit pick when online', () => {
    expect(pickVoice(voices, { name: 'Google US English', lang: 'en', online: true })?.name).toBe(
      'Google US English',
    )
  })

  it('defaults to a Google voice for the language', () => {
    expect(pickVoice(voices, { lang: 'zh', online: true })?.name).toBe('Google 普通话（中国大陆）')
  })

  it('falls back to a local voice of the same language when offline', () => {
    const picked = pickVoice(voices, { name: 'Google 普通话（中国大陆）', lang: 'zh', online: false })
    expect(picked?.localService).toBe(true)
    expect(picked?.lang).toBe('zh-CN')
    expect(picked?.name).toBe('Ting-Ting')
  })

  it('returns null with no voices', () => {
    expect(pickVoice([], { lang: 'en', online: true })).toBeNull()
  })
})
