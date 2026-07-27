/**
 * Stamp each translated app doc with the fingerprint of the English file it was
 * translated from. Run after translating, or after re-reading a translation and
 * confirming it still matches:
 *
 *   npm run docs:sync
 *
 * The check lives in src/lib/appDocs.test.ts and fails when a translation's
 * recorded hash no longer matches its source. That failure is the point: it
 * means someone changed the English and the other languages now say something
 * different. Running this script is how you say "I have looked, and they agree
 * again" — so do the translating first, not the stamping.
 *
 * Runs under plain `node` (Node strips the types), importing the same hash
 * implementation the test uses so the two can never disagree.
 */
import { readFileSync, writeFileSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { hashDocSource, SOURCE_HASH_FIELD } from '../src/lib/docHash.ts'

const DOCS = join(dirname(fileURLToPath(import.meta.url)), '..', 'docs', 'app')

/** Replace the source-hash line, or add one just before the closing `---`. */
function stamp(md: string, hash: string): string {
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(md)
  if (!m) throw new Error('no frontmatter')
  const field = new RegExp(`^${SOURCE_HASH_FIELD}\\s*:.*$`, 'm')
  const front = field.test(m[1])
    ? m[1].replace(field, `${SOURCE_HASH_FIELD}: ${hash}`)
    : `${m[1]}\n${SOURCE_HASH_FIELD}: ${hash}`
  return `---\n${front}\n---` + md.slice(m[0].length)
}

const files = readdirSync(DOCS).filter((f) => f.endsWith('.md'))
const translations = files.filter((f) => /\.[a-z]{2}\.md$/.test(f))

let changed = 0
for (const file of translations) {
  const id = file.replace(/\.[a-z]{2}\.md$/, '')
  const source = `${id}.md`
  if (!files.includes(source)) {
    console.error(`✗ ${file} has no English source (${source})`)
    process.exitCode = 1
    continue
  }
  const hash = hashDocSource(readFileSync(join(DOCS, source), 'utf8'))
  const before = readFileSync(join(DOCS, file), 'utf8')
  const after = stamp(before, hash)
  if (after === before) continue
  writeFileSync(join(DOCS, file), after)
  console.log(`  stamped ${file} → ${hash}`)
  changed++
}

console.log(
  changed
    ? `\n${changed} translation(s) stamped. Commit them with the translation itself.`
    : `All ${translations.length} translations already match their source.`,
)
