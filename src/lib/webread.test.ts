import { describe, it, expect } from 'vitest'
import { withScheme, ddgSearchUrl, decodeDdgLinks } from './webread'

describe('withScheme', () => {
  it('leaves http(s) URLs untouched and trims', () => {
    expect(withScheme('https://example.com/a')).toBe('https://example.com/a')
    expect(withScheme('  http://x.io  ')).toBe('http://x.io')
  })
  it('prepends https:// to bare hosts', () => {
    expect(withScheme('example.com')).toBe('https://example.com')
    expect(withScheme('en.wikipedia.org/wiki/Cat')).toBe('https://en.wikipedia.org/wiki/Cat')
  })
})

describe('ddgSearchUrl', () => {
  it('builds the no-JS results URL with an encoded query', () => {
    expect(ddgSearchUrl('quantum computing')).toBe(
      'https://html.duckduckgo.com/html/?q=quantum%20computing',
    )
    expect(ddgSearchUrl('a&b')).toContain('q=a%26b')
  })
})

describe('decodeDdgLinks', () => {
  it('rewrites DDG redirect links to their real target URLs', () => {
    const enc = encodeURIComponent('https://www.ibm.com/think/topics/quantum-computing')
    const md = `## [What is quantum computing? - IBM](https://duckduckgo.com/l/?uddg=${enc}&rut=deadbeef)`
    expect(decodeDdgLinks(md)).toBe(
      '## [What is quantum computing? - IBM](https://www.ibm.com/think/topics/quantum-computing)',
    )
  })

  it('handles the kh-prefixed variant and leaves normal links alone', () => {
    const enc = encodeURIComponent('https://example.org/page?x=1')
    const md = `see [x](https://duckduckgo.com/l/?kh=-1&uddg=${enc}&rut=abc) and [y](https://real.com/z)`
    const out = decodeDdgLinks(md)
    expect(out).toContain('(https://example.org/page?x=1)')
    expect(out).toContain('(https://real.com/z)')
    expect(out).not.toContain('duckduckgo.com/l/')
  })

  it('leaves a malformed uddg value in place', () => {
    const md = 'a https://duckduckgo.com/l/?uddg=%E0%A4%A&rut=x b'
    expect(decodeDdgLinks(md)).toBe(md)
  })

  it('drops sponsored (y.js) rows and empty-anchor chrome', () => {
    const enc = encodeURIComponent('https://real.org/doc')
    const md = [
      '[](https://html.duckduckgo.com/html/ "DuckDuckGo")',
      '## [Ad Title](https://duckduckgo.com/y.js?ad_domain=x.com&ad_provider=bingv7aa)',
      `## [Real result](https://duckduckgo.com/l/?uddg=${enc}&rut=abc)`,
    ].join('\n')
    const out = decodeDdgLinks(md)
    expect(out).not.toContain('y.js')
    expect(out).not.toContain('Ad Title')
    expect(out).not.toContain('[](')
    expect(out).toContain('## [Real result](https://real.org/doc)')
  })
})
