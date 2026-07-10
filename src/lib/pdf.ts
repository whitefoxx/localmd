/**
 * PDF text extraction via pdf.js, so the agent's read_file works on
 * raw/papers/*.pdf during ingest. Results are cached by mtime — extraction
 * of a large PDF is expensive.
 */
import * as pdfjs from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import * as fs from '@/lib/fs'

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl

const cache = new Map<string, { mtime: number; text: string }>()

export async function extractPdfText(path: string): Promise<string> {
  const mtime = (await fs.statMtime(path)) ?? 0
  const cached = cache.get(path)
  if (cached && cached.mtime === mtime) return cached.text

  const buf = await fs.readBinary(path)
  const loadingTask = pdfjs.getDocument({ data: buf })
  const pages: string[] = []
  try {
    const doc = await loadingTask.promise
    for (let p = 1; p <= doc.numPages; p++) {
      const page = await doc.getPage(p)
      const tc = await page.getTextContent()
      const line = tc.items.map((i) => ('str' in i ? i.str : '')).join(' ')
      pages.push(`[page ${p}]\n${line}`)
    }
  } finally {
    await loadingTask.destroy()
  }
  const text = pages.join('\n\n')
  cache.set(path, { mtime, text })
  return text
}
