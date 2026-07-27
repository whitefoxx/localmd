/**
 * Fingerprint of an English doc, recorded in each translation's frontmatter so
 * a translation that has fallen behind its source is a build failure rather
 * than a page quietly telling readers something that stopped being true.
 *
 * Deliberately import-free: `scripts/sync-doc-hashes.ts` runs this under plain
 * `node` (which strips types natively), and the test imports it under Vite.
 * One implementation, so the two can never disagree about what a hash is.
 *
 * FNV-1a twice with different offsets, concatenated — 64 bits, which is far
 * more than "did this file change?" needs, but costs nothing and removes any
 * reason to think about collisions.
 */

function fnv1a(text: string, offset: number): string {
  let h = offset
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0).toString(16).padStart(8, '0')
}

/** Line endings and trailing whitespace are not content — normalising them
 *  keeps a hash from changing when only an editor touched the file. */
export function hashDocSource(raw: string): string {
  const text = raw.replace(/\r\n/g, '\n').trimEnd()
  return fnv1a(text, 0x811c9dc5) + fnv1a(text, 0x01000193)
}

/** The frontmatter field translations carry. */
export const SOURCE_HASH_FIELD = 'source-hash'
