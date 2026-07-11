/**
 * One-shot conversation summarization for history compaction (A2) — a single
 * non-streaming request to the PRIMARY profile's model.
 */
import Anthropic from '@anthropic-ai/sdk'
import type { LlmProfile } from '@/stores/settings'

const PROMPT =
  '你是对话压缩器。把下面的 agent 对话历史压缩成结构化摘要,必须保留:用户的目标与明确指示、已完成的操作(含涉及的文件路径)、关键发现与决定、尚未完成的事项。用要点列表,总长不超过 600 字。只输出摘要本身。'

export async function summarize(
  profile: LlmProfile,
  transcript: string,
  signal?: AbortSignal,
): Promise<string> {
  if (profile.provider === 'anthropic') {
    const client = new Anthropic({ apiKey: profile.apiKey, dangerouslyAllowBrowser: true })
    const res = await client.messages.create(
      {
        model: profile.model,
        max_tokens: 1500,
        messages: [{ role: 'user', content: `${PROMPT}\n\n<对话历史>\n${transcript}\n</对话历史>` }],
      },
      { signal },
    )
    const text = res.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('')
    if (!text) throw new Error('summarizer returned no content')
    return text
  }

  const resp = await fetch(`${profile.baseUrl.replace(/\/$/, '')}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${profile.apiKey}` },
    body: JSON.stringify({
      model: profile.model,
      messages: [{ role: 'user', content: `${PROMPT}\n\n<对话历史>\n${transcript}\n</对话历史>` }],
      max_tokens: 1500,
    }),
    signal,
  })
  if (!resp.ok) throw new Error(`summarizer HTTP ${resp.status}`)
  const json = (await resp.json()) as { choices?: Array<{ message?: { content?: string } }> }
  const text = json.choices?.[0]?.message?.content
  if (!text) throw new Error('summarizer returned no content')
  return text
}
