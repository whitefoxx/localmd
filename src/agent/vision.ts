/**
 * Vision sub-calls — one-shot "describe these images" requests the agent loop
 * delegates to the profile assigned to the `vision` capability slot (web-agent
 * pattern). Used when the PRIMARY model is text-only; a multimodal primary gets
 * images back inline from view_image and never comes here.
 *
 * Images live in the KB as files; they're inlined as base64 data URLs before
 * the call (providers downloading URLs themselves is the classic timeout/400
 * failure mode). The AI SDK provider formats them per its wire protocol.
 */
import { generateText } from 'ai'
import * as fs from '@/lib/fs'
import { mimeFor, fileKind } from '@/lib/filetypes'
import { toLanguageModel } from './model'
import type { LlmProfile } from '@/stores/settings'

const VISION_TIMEOUT_MS = 180_000

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

/** Longest edge sent to a model. Vision billing scales with pixels and every
 *  provider downsizes to roughly this anyway (it matches Anthropic's cap), so
 *  larger originals only inflate the request. */
const MAX_IMAGE_EDGE = 1568

/** Shrink an oversized raster image for the model-facing copy (the KB file is
 *  untouched). PNG stays PNG (screenshots, alpha); other formats re-encode as
 *  JPEG. Returns null when the image is small enough, the format is unsafe to
 *  re-encode (GIF/SVG), or canvas APIs are unavailable — caller keeps the
 *  original bytes. */
async function downscaled(buf: ArrayBuffer, mediaType: string): Promise<Omit<KbImage, 'path'> | null> {
  if (!/^image\/(png|jpeg|webp)$/.test(mediaType)) return null
  if (typeof createImageBitmap === 'undefined' || typeof OffscreenCanvas === 'undefined') return null
  let bitmap: ImageBitmap
  try {
    bitmap = await createImageBitmap(new Blob([buf], { type: mediaType }))
  } catch {
    return null
  }
  try {
    const scale = MAX_IMAGE_EDGE / Math.max(bitmap.width, bitmap.height)
    if (scale >= 1) return null
    const canvas = new OffscreenCanvas(
      Math.max(1, Math.round(bitmap.width * scale)),
      Math.max(1, Math.round(bitmap.height * scale)),
    )
    const ctx = canvas.getContext('2d')
    if (!ctx) return null
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
    const outType = mediaType === 'image/png' ? 'image/png' : 'image/jpeg'
    const blob = await canvas.convertToBlob(
      outType === 'image/jpeg' ? { type: outType, quality: 0.85 } : { type: outType },
    )
    return { mediaType: outType, base64: arrayBufferToBase64(await blob.arrayBuffer()) }
  } catch {
    return null
  } finally {
    bitmap.close()
  }
}

/** Load a KB image file as base64 + media type; null when missing or not an
 *  image. SVG is excluded — most vision APIs reject it. Oversized images are
 *  downscaled for the request; the file in the KB keeps its full resolution. */
export async function loadKbImage(path: string): Promise<KbImage | null> {
  if (fileKind(path) !== 'image' || /\.svg$/i.test(path)) return null
  try {
    const buf = await fs.readBinary(path)
    const mediaType = mimeFor(path)
    const small = await downscaled(buf, mediaType)
    if (small) return { path, ...small }
    return { path, mediaType, base64: arrayBufferToBase64(buf) }
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
  const q = question || 'Describe the contents of these images in detail.'
  const timeout = AbortSignal.timeout(VISION_TIMEOUT_MS)
  const { text } = await generateText({
    model: toLanguageModel(profile),
    maxOutputTokens: 1500,
    reasoning: profile.reasoning,
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: q },
          ...images.map((img) => ({
            type: 'image' as const,
            image: toDataUrl(img),
            mediaType: img.mediaType,
          })),
        ],
      },
    ],
    abortSignal: signal ? AbortSignal.any([signal, timeout]) : timeout,
  })
  if (!text) throw new Error('vision model returned no content')
  return text
}
