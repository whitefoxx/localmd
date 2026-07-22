import { describe, it, expect } from 'vitest'
import { renderTranscript, sessionFileName, transcriptDirFor } from './transcript'
import type { TranscriptSession } from './transcript'
import type { UiMessage } from '@/stores/chat'

const CREATED = new Date(2026, 6, 17, 10, 30).getTime() // 2026-07-17 local

function session(overrides: Partial<TranscriptSession> = {}): TranscriptSession {
  const uiMessages: UiMessage[] = [
    { id: 1, role: 'user', parts: [{ type: 'text', text: '帮我梳理一下会话方案' }] },
    {
      id: 2,
      role: 'assistant',
      parts: [
        { type: 'thinking', text: 'internal chain of thought' },
        { type: 'tool', name: 'read_file', detail: 'wiki/index.md' },
        { type: 'text', text: '结论:转录进 raw/conversations。' },
      ],
    },
  ]
  return {
    id: '5b1c2f34-aaaa-bbbb-cccc-1234567890ab',
    title: '会话方案 讨论',
    createdAt: CREATED,
    uiMessages,
    ...overrides,
  }
}

describe('transcriptDirFor', () => {
  it('keeps trace-app’s conversations dir in raw-layout KBs, inbox/ elsewhere', () => {
    expect(transcriptDirFor(true)).toBe('raw/conversations/browser-md')
    expect(transcriptDirFor(false)).toBe('inbox/conversations')
  })
})

describe('sessionFileName', () => {
  it('prefixes the date and keeps the title (CJK and spaces)', () => {
    expect(sessionFileName('会话方案 讨论', CREATED)).toBe('2026-07-17 会话方案 讨论.md')
  })
  it('strips filesystem-illegal characters and falls back to chat', () => {
    expect(sessionFileName('a/b:c*?', CREATED)).toBe('2026-07-17 a b c.md')
    expect(sessionFileName('   ', CREATED)).toBe('2026-07-17 chat.md')
  })
})

describe('renderTranscript', () => {
  const out = renderTranscript(session())

  it('writes a minimal frontmatter (type + session id + title + date)', () => {
    expect(out).toContain('type: chat')
    expect(out).toContain('session: 5b1c2f34-aaaa-bbbb-cccc-1234567890ab')
    expect(out).toContain('title: "会话方案 讨论"')
    expect(out).toContain('date: 2026-07-17')
  })

  it('renders turn anchors and collapsed tool lines, omits thinking', () => {
    expect(out).toContain('## t1 · User')
    expect(out).toContain('## t2 · Assistant')
    expect(out).toContain('> ⚙ read_file — wiki/index.md')
    expect(out).toContain('结论:转录进 raw/conversations。')
    expect(out).not.toContain('internal chain of thought')
  })

  it('renders attachments, contexts, errors, artifacts and images', () => {
    const s = session({
      uiMessages: [
        {
          id: 3,
          role: 'user',
          parts: [{ type: 'text', text: '看看这个' }],
          attachments: [{ path: '.tmp/shot.png', image: true }],
          contexts: [{ id: 'x', file: 'wiki/a.md', text: '选中的  一段\n话', pinned: false }],
        },
        {
          id: 4,
          role: 'assistant',
          parts: [
            { type: 'artifact', title: '路线图', path: 'wiki/roadmap.html' },
            { type: 'image', path: 'raw/images/gen.png' },
            { type: 'tool', name: 'edit_file', detail: 'wiki/a.md', status: 'error' },
          ],
          error: 'Stopped.',
        },
      ] as UiMessage[],
    })
    const r = renderTranscript(s)
    expect(r).toContain('> 📎 Attachments: .tmp/shot.png')
    expect(r).toContain('> 📌 Quoting wiki/a.md: 选中的 一段 话')
    expect(r).toContain('> 📄 Artifact: wiki/roadmap.html (路线图)')
    expect(r).toContain('> 🖼 Generated image: raw/images/gen.png')
    expect(r).toContain('> ⚙ edit_file — wiki/a.md ✗')
    expect(r).toContain('> ⚠ Stopped.')
  })
})
