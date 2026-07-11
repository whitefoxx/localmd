/**
 * Vision sub-calls — one-shot "describe these images" requests the agent loop
 * delegates to the profile assigned to the `vision` capability slot (web-agent
 * pattern). Used when the PRIMARY model is text-only; a multimodal primary
 * gets images inline instead and never comes here.
 *
 * Images live in the KB as files; kbImageToDataUrl() inlines them as base64
 * data URLs before the call — providers downloading URLs themselves is the
 * classic timeout/400 failure mode web-agent hit.
 */
import Anthropic from '@anthropic-ai/sdk'
import * as fs from '@/lib/fs'
import { mimeFor, fileKind } from '@/lib/filetypes'
import type { LlmProfile } from '@/stores/settings'

const VISION_TIMEOUT_MS = 180_000

/** Shape an inlined image for a provider's `image_url.url` field. Most
 *  OpenAI-compatible providers want the full data URL; GLM (bigmodel.cn)
 *  documents the RAW base64 payload with no `data:` prefix and has been seen
 *  choking on data: URLs ("only ASCII characters"). */
export function imageUrlForProvider(
  profile: Pick<LlmProfile, 'provider' | 'baseUrl'>,
  ref: string,
): string {
  if (!ref.startsWith('data:')) return ref
  const isGlm = profile.provider === 'glm' || /bigmodel\.cn/i.test(profile.baseUrl)
  if (!isGlm) return ref
  const i = ref.indexOf(';base64,')
  return i === -1 ? ref : ref.slice(i + ';base64,'.length)
}

export function arrayBufferToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf)
  let bin = ''
  const CHUNK = 0x8000
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK))
  }
  return btoa(bin)
}

export interface KbImage {
  path: string
  mediaType: string
  base64: string
}

/** Load a KB image file as base64 + media type; null when missing or not an
 *  image. SVG is excluded — most vision APIs reject it. */
export async function loadKbImage(path: string): Promise<KbImage | null> {
  if (fileKind(path) !== 'image' || /\.svg$/i.test(path)) return null
  try {
    const buf = await fs.readBinary(path)
    return { path, mediaType: mimeFor(path), base64: arrayBufferToBase64(buf) }
  } catch {
    return null
  }
}

export function toDataUrl(img: KbImage): string {
  return `data:${img.mediaType};base64,${img.base64}`
}

/** Ask the vision-slot model to look at KB images and answer a question.
 *  Returns its text answer (handed back to the primary as a tool result). */
export async function visionDescribe(
  profile: LlmProfile,
  images: KbImage[],
  question: string,
  signal?: AbortSignal,
): Promise<string> {
  const q = question || '请详细描述这些图片的内容。'
  if (profile.provider === 'anthropic') {
    const client = new Anthropic({ apiKey: profile.apiKey, dangerouslyAllowBrowser: true })
    const res = await client.messages.create(
      {
        model: profile.model,
        max_tokens: 1500,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: q },
              ...images.map((img) => ({
                type: 'image' as const,
                source: {
                  type: 'base64' as const,
                  media_type: img.mediaType as 'image/png',
                  data: img.base64,
                },
              })),
            ],
          },
        ],
      },
      { signal },
    )
    const text = res.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('')
    if (!text) throw new Error('vision model returned no content')
    return text
  }

  const url = `${profile.baseUrl.replace(/\/$/, '')}/chat/completions`
  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${profile.apiKey}` },
    body: JSON.stringify({
      model: profile.model,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: q },
            ...images.map((img) => ({
              type: 'image_url',
              image_url: { url: imageUrlForProvider(profile, toDataUrl(img)) },
            })),
          ],
        },
      ],
      max_tokens: 1500,
    }),
    signal: signal
      ? AbortSignal.any([signal, AbortSignal.timeout(VISION_TIMEOUT_MS)])
      : AbortSignal.timeout(VISION_TIMEOUT_MS),
  })
  if (!resp.ok) {
    const text = await resp.text().catch(() => '')
    throw new Error(`${resp.status} ${resp.statusText}: ${text.slice(0, 300)}`)
  }
  const json = (await resp.json()) as { choices?: Array<{ message?: { content?: string } }> }
  const text = json.choices?.[0]?.message?.content
  if (!text) throw new Error('vision model returned no content')
  return text
}
