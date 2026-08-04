import { describe, it, expect } from 'vitest'
import { parseLicenceKey } from './licence'
// Read as text through Vite rather than node:fs — `src/` is browser code and
// carries no node types, so a test that reached for readFileSync would pass
// under vitest and fail typecheck.
import claim from '../../public/claim.html?raw'
import settings from '@/stores/settings.ts?raw'

/**
 * `public/claim.html` is plain HTML outside the bundle, so nothing type-checks
 * it against the app it writes into. These are the agreements that would fail
 * silently if they drifted — a claim page writing to the wrong storage key
 * looks like it worked and installs nothing.
 */
function literal(source: string, name: string): string {
  const m = new RegExp(`${name}\\s*=\\s*'([^']+)'`).exec(source)
  if (!m) throw new Error(`no ${name} literal found`)
  return m[1]
}

describe('claim page ↔ app agreements', () => {
  it('writes to the storage key the settings store reads', () => {
    expect(literal(claim, 'STORAGE_KEY')).toBe(literal(settings, 'const STORAGE_KEY'))
  })

  it('recognises the key format the signer actually emits', () => {
    // The page splits on '.' and checks parts[0]; if the prefix ever changed,
    // every claim link would report "that does not look like a key".
    const sample =
      'LMD1.eyJpZCI6IngiLCJraW5kIjoiZWFybHkiLCJpc3N1ZWQiOiIyMDI2LTA4LTAzIiwiZXhwaXJlcyI6IjIwMjYtMTEtMDEifQ.AA'
    expect(claim).toContain("parts[0] !== 'LMD1'")
    // The payload the page decodes is the payload the app parses: this key gets
    // all the way to the signature check before being rejected.
    const parsed = parseLicenceKey(sample)
    expect('error' in parsed ? parsed.error : '').toBe('signature is the wrong length')
  })

  it('keeps the key out of anything a server would see', () => {
    // The fragment is the entire privacy story of the claim link. A build that
    // read location.search instead would put the key in access logs, the
    // Referer header, and any CDN in between — silently.
    expect(claim).toContain('location.hash')
    expect(claim).not.toContain('location.search')
  })

  it('never replaces settings it could not read', () => {
    // The blob it would overwrite holds the user's API keys. Saving them one
    // paste is not worth any chance of losing those.
    expect(claim).toContain('nothing was changed')
  })

  it('is not indexable', () => {
    expect(claim).toContain('name="robots" content="noindex"')
  })
})
