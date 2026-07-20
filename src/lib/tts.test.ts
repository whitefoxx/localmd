import { describe, it, expect } from 'vitest'
import { splitIntoChunks, chunkSegments, guessLang, stripMarkdown, pickVoice } from './tts'

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

describe('chunkSegments', () => {
  it('tags every chunk with its segment page', () => {
    const chunks = chunkSegments([
      { text: '第一页的内容。', page: 3 },
      { text: 'Second page text here.', page: 4 },
      { text: 'No page metadata.' },
    ])
    expect(chunks.map((c) => c.page)).toEqual([3, 4, undefined])
    expect(chunks[0].text).toContain('第一页')
  })

  it('splits a long segment into several chunks, all on the same page', () => {
    const long = Array.from({ length: 30 }, (_, i) => `Sentence number ${i} right here.`).join(' ')
    const chunks = chunkSegments([{ text: long, page: 7 }])
    expect(chunks.length).toBeGreaterThan(1)
    expect(chunks.every((c) => c.page === 7)).toBe(true)
  })

  it('carries the block id through chunking', () => {
    const chunks = chunkSegments([{ text: '一个文本块。', page: 3, block: 'b3-1' }])
    expect(chunks[0].block).toBe('b3-1')
    expect(chunks[0].page).toBe(3)
  })
})

describe('guessLang', () => {
  it('detects languages by script', () => {
    expect(guessLang('这是一段中文测试文本内容')).toBe('zh')
    expect(guessLang('This is an English sentence.')).toBe('en')
    expect(guessLang('これは日本語の文です。漢字も含む。')).toBe('ja') // kana beats han
    expect(guessLang('한국어 문장입니다.')).toBe('ko')
    expect(guessLang('Это русское предложение.')).toBe('ru')
  })

  it('falls back to the document language when a chunk has no script signal', () => {
    expect(guessLang('42.', 'zh')).toBe('zh')
    expect(guessLang('42.')).toBe('en')
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

  it('auto-switches voice for a chunk in a different language than the pick', () => {
    // zh voice picked, but this chunk is English → matching Google en voice.
    expect(
      pickVoice(voices, { name: 'Google 普通话（中国大陆）', lang: 'en', online: true })?.name,
    ).toBe('Google US English')
  })

  it('stays local when auto-switching from an explicitly LOCAL pick', () => {
    // Local zh voice picked (user avoiding Google) → an English chunk gets the
    // local en voice, not a Google one.
    expect(pickVoice(voices, { name: 'Ting-Ting', lang: 'en', online: true })?.name).toBe(
      'Samantha',
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
