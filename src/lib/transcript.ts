/**
 * Render a chat session to markdown — a plain snapshot the user (via the "save
 * session" button) or the agent (via the save_transcript tool) saves on demand.
 *
 * The result is just a KB file like any other: no auto-sync, no reserved
 * frontmatter, no distill bookkeeping. The frontmatter carries a `type: chat`
 * marker and a stable `session` id (handy for later cross-checking). The user
 * picks where to save it and can rename it; the default name is the session's
 * own title.
 */
import type { UiMessage } from '@/stores/chat'

/** The slice of a chat session the renderer needs. */
export interface TranscriptSession {
  id: string
  title: string
  createdAt: number
  uiMessages: UiMessage[]
}

/** Default directory for the agent's save_transcript tool (the user's button
 *  picks a location instead). */
export const TRANSCRIPT_DIR = 'raw/conversations/browser-md'

function localDate(ts: number): string {
  const d = new Date(ts)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

/** Default save name for a session: date + its own title, with characters a
 *  filename can't hold stripped (CJK and spaces are kept — the user can rename
 *  in the picker anyway). The date prefix keeps saved chats sorted. */
export function sessionFileName(title: string, ts: number): string {
  const base =
    title
      .replace(/[/\\:*?"<>|]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 60) || 'chat'
  return `${localDate(ts)} ${base}.md`
}

/** Full markdown for a session snapshot. */
export function renderTranscript(s: TranscriptSession): string {
  const fm = [
    'type: chat',
    `session: ${s.id}`,
    `title: ${JSON.stringify(s.title)}`,
    `date: ${localDate(s.createdAt)}`,
  ]
  const body = s.uiMessages.map(renderMessage).join('\n')
  return `---\n${fm.join('\n')}\n---\n\n${body}`
}

/** One message as a `## t<id> · 角色` section. Tool calls collapse to one-liners;
 *  model-internal thinking is omitted (the record is the discussion). */
function renderMessage(m: UiMessage): string {
  const lines: string[] = [`## t${m.id} · ${m.role === 'user' ? '用户' : '助手'}`, '']
  for (const c of m.contexts ?? []) {
    lines.push(`> 📌 ${c.file ? `引用 ${c.file}` : '引用此前回复'}: ${excerpt(c.text)}`, '')
  }
  if (m.attachments?.length) {
    lines.push(`> 📎 附件: ${m.attachments.map((a) => a.path).join(', ')}`, '')
  }
  for (const p of m.parts) {
    if (p.type === 'text') {
      const t = p.text.trim()
      if (t) lines.push(t, '')
    } else if (p.type === 'tool') {
      const status = p.status === 'error' ? ' ✗' : ''
      lines.push(`> ⚙ ${p.name}${p.detail ? ` — ${excerpt(p.detail, 160)}` : ''}${status}`, '')
    } else if (p.type === 'artifact') {
      if (!p.pending) lines.push(`> 📄 工件: ${p.path}${p.title ? `(${p.title})` : ''}`, '')
    } else if (p.type === 'image') {
      lines.push(`> 🖼 生成图片: ${p.path}`, '')
    }
  }
  if (m.error) lines.push(`> ⚠ ${m.error}`, '')
  return lines.join('\n')
}

function excerpt(t: string, max = 300): string {
  const one = t.replace(/\s+/g, ' ').trim()
  return one.length > max ? `${one.slice(0, max)}…` : one
}
