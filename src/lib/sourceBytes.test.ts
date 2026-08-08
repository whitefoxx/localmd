import { describe, expect, it } from 'vitest'
// The app tsconfig is browser-only on purpose — node types are deliberately
// absent so src code cannot lean on node APIs. This test DOES run in vitest's
// node runtime; the imports work, only their types are missing. Typed by hand.
// @ts-expect-error node types are intentionally not installed
import { readFileSync, readdirSync } from 'node:fs'
// @ts-expect-error node types are intentionally not installed
import { join } from 'node:path'

/**
 * Source files must stay text to text tools.
 *
 * A single raw control byte makes file(1) call the file "data" and grep(1)
 * classify it as binary — every search silently returns nothing, blinding
 * both humans and the agents that work on this repo. It has happened twice,
 * each time a NUL used as a cache-key separator (connectGuard.ts,
 * ChatPanel.vue), and cost real debugging time before anyone realized the
 * searches were lying. A backslash-u escape builds the identical runtime
 * string without poisoning the file.
 */

interface DirEnt {
  name: string
  isDirectory(): boolean
}

const OK = new Set([0x09, 0x0a, 0x0d]) // tab, LF, CR
const EXT = /\.(ts|tsx|vue)$/

function walk(dir: string): string[] {
  return (readdirSync(dir, { withFileTypes: true }) as DirEnt[]).flatMap((e) => {
    const p = join(dir, e.name) as string
    if (e.isDirectory()) return walk(p)
    return EXT.test(e.name) ? [p] : []
  })
}

describe('source bytes', () => {
  it('no raw control bytes anywhere under src/', () => {
    const offenders: string[] = []
    for (const p of walk('src')) {
      const buf = readFileSync(p) as Uint8Array
      for (let i = 0; i < buf.length; i++) {
        if (buf[i] < 0x20 && !OK.has(buf[i])) {
          let line = 1
          for (let j = 0; j < i; j++) if (buf[j] === 0x0a) line++
          offenders.push(`${p}:${line} byte 0x${buf[i].toString(16)} — use a \\u escape instead`)
          break
        }
      }
    }
    expect(offenders).toEqual([])
  })
})
