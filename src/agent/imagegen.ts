/**
 * Image generation for the `image` capability slot. The agent calls the
 * generate_image tool; the loop routes it here, which asks the image-slot
 * model (via the AI SDK) to produce an image and saves the bytes into the KB
 * under raw/images/ (trace-app's archiving convention), returning the path so
 * the chat can show it and the model can reference it.
 */
import { generateImage as aiGenerateImage } from 'ai'
import { toImageModel } from './model'
import * as fs from '@/lib/fs'
import { slugify } from '@/lib/docindex/util'
import type { LlmProfile } from '@/stores/settings'

/** Pick `raw/images/generated-<slug>.<ext>`, appending -2, -3… on collision. */
async function uniqueImagePath(prompt: string, ext: string): Promise<string> {
  const slug = slugify(prompt).slice(0, 40) || 'image'
  for (let n = 1; n < 1000; n++) {
    const path = `raw/images/generated-${slug}${n > 1 ? `-${n}` : ''}.${ext}`
    if (!(await fs.exists(path))) return path
  }
  return `raw/images/generated-${slug}-${Date.now()}.${ext}`
}

/** Generate an image from a prompt and save it into the KB. Returns its
 *  KB-relative path. */
export async function generateKbImage(
  profile: LlmProfile,
  prompt: string,
  opts: { size?: string; signal?: AbortSignal } = {},
): Promise<{ path: string }> {
  const { images } = await aiGenerateImage({
    model: toImageModel(profile),
    prompt,
    ...(opts.size ? { size: opts.size as `${number}x${number}` } : {}),
    abortSignal: opts.signal,
  })
  const img = images[0]
  if (!img) throw new Error('image model returned no images')
  const mediaType = img.mediaType || 'image/png'
  const ext = mediaType.split('/')[1]?.replace('jpeg', 'jpg') || 'png'
  const path = await uniqueImagePath(prompt, ext)
  // Copy into a fresh ArrayBuffer-backed array (the SDK's Uint8Array may be
  // SharedArrayBuffer-backed, which Blob's types reject).
  const bytes = new Uint8Array(img.uint8Array.length)
  bytes.set(img.uint8Array)
  await fs.writeFile(path, new Blob([bytes], { type: mediaType }))
  return { path }
}
