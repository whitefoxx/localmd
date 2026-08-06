import { describe, it, expect, vi } from 'vitest'
import {
  sanitizeToolName,
  staticOrigin,
  normalizeHttpTool,
  secretRefs,
  httpToolJsonSchema,
  buildRequest,
  pickPath,
  renderItem,
  shapeResponse,
  clip,
  pickFirst,
  parseXml,
  xmlToValue,
  runHttpTool,
  describeHttpCall,
  HttpToolError,
  type HttpToolSpec,
  type HttpReply,
} from './httpTools'

const spec = (over: Partial<HttpToolSpec> = {}): HttpToolSpec => ({
  id: 't1',
  name: 'demo',
  description: 'demo tool',
  params: { query: { type: 'string', required: true }, limit: { type: 'number', default: 5 } },
  request: { method: 'GET', url: 'https://api.test.dev/s?q={{query}}&n={{limit}}' },
  response: { mode: 'text' },
  ...over,
})

const noSecrets = (): undefined => undefined

describe('sanitizeToolName', () => {
  it('lowercases and underscores', () => {
    expect(sanitizeToolName('OpenAlex Search')).toBe('openalex_search')
    expect(sanitizeToolName('a-b.c')).toBe('a_b_c')
  })
  it('rejects names that do not start with a letter', () => {
    expect(sanitizeToolName('9lives')).toBe('')
    expect(sanitizeToolName('___')).toBe('')
  })
})

describe('staticOrigin', () => {
  it('accepts an https origin, with a port', () => {
    expect(staticOrigin('https://api.test.dev/x?q=1')).toBe('https://api.test.dev')
    expect(staticOrigin('https://Local.Host:8443/x')).toBe('https://local.host:8443')
    expect(staticOrigin('https://api.test.dev')).toBe('https://api.test.dev')
  })
  it('rejects http and a templated host — no argument may retarget a tool', () => {
    expect(staticOrigin('http://api.test.dev/x')).toBeNull()
    expect(staticOrigin('https://{{host}}/x')).toBeNull()
    expect(staticOrigin('https://{{h}}.test.dev/x')).toBeNull()
    expect(staticOrigin('  ')).toBeNull()
  })
})

describe('normalizeHttpTool', () => {
  it('fills defaults and keeps a valid spec', () => {
    const out = normalizeHttpTool({
      name: 'My Tool',
      description: 'd',
      request: { url: 'https://api.test.dev/x' },
      params: { q: { type: 'string', required: true } },
    })
    expect(out).toMatchObject({
      name: 'my_tool',
      request: { method: 'GET', url: 'https://api.test.dev/x' },
      response: { mode: 'text' },
    })
    expect(out?.id).toBeTruthy()
  })

  it('drops specs that could never run', () => {
    expect(normalizeHttpTool(null)).toBeNull()
    expect(normalizeHttpTool({ name: 'x' })).toBeNull() // no url
    expect(normalizeHttpTool({ name: 'x', request: { url: 'http://a.dev' } })).toBeNull()
    expect(normalizeHttpTool({ name: '', request: { url: 'https://a.dev' } })).toBeNull()
  })

  it('drops unknown transforms and malformed header names', () => {
    const out = normalizeHttpTool({
      name: 'x',
      request: { url: 'https://a.dev', headers: { 'X-Ok': '1', 'Bad Header': '2', 'A\nB': '3' } },
      response: { mode: 'json', transform: 'rm -rf' },
    })
    expect(out?.response.transform).toBeUndefined()
    expect(out?.request.headers).toEqual({ 'X-Ok': '1' })
  })
})

describe('secretRefs / httpToolJsonSchema', () => {
  it('collects every referenced secret id', () => {
    const s = spec({
      request: {
        method: 'POST',
        url: 'https://a.dev/x?k={{secret:alpha}}',
        headers: { Authorization: 'Bearer {{secret:beta}}' },
        body: '{"t":"{{secret:alpha}}"}',
      },
    })
    expect(secretRefs(s).sort()).toEqual(['alpha', 'beta'])
  })

  it('marks only required params without a default as required', () => {
    expect(httpToolJsonSchema(spec())).toEqual({
      type: 'object',
      properties: { query: { type: 'string' }, limit: { type: 'number' } },
      required: ['query'],
      additionalProperties: false,
    })
  })
})

describe('buildRequest', () => {
  it('URL-encodes arguments and applies defaults', () => {
    const req = buildRequest(spec(), { query: 'a&b c' }, noSecrets)
    expect(req.url).toBe('https://api.test.dev/s?q=a%26b%20c&n=5')
    expect(req.method).toBe('GET')
  })

  it('throws on a missing required argument', () => {
    expect(() => buildRequest(spec(), {}, noSecrets)).toThrow(HttpToolError)
  })

  it('resolves secrets and keeps them out of redactedUrl', () => {
    const s = spec({ request: { method: 'GET', url: 'https://api.test.dev/x?key={{secret:k}}&q={{query}}' } })
    const req = buildRequest(s, { query: 'hi' }, (id) => (id === 'k' ? 's3cret' : undefined))
    expect(req.url).toContain('key=s3cret')
    expect(req.redactedUrl).toContain('key=***')
    expect(req.redactedUrl).not.toContain('s3cret')
  })

  it('reports an unresolved secret as an actionable error', () => {
    const s = spec({ request: { method: 'GET', url: 'https://api.test.dev/x?key={{secret:k}}&q={{query}}' } })
    expect(() => buildRequest(s, { query: 'hi' }, noSecrets)).toThrow(/needs the "k" key/)
  })

  it('substitutes in one pass — an argument cannot become a secret reference', () => {
    const req = buildRequest(spec(), { query: '{{secret:k}}' }, () => 'LEAKED')
    expect(req.url).not.toContain('LEAKED')
    expect(req.url).toContain(encodeURIComponent('{{secret:k}}'))
  })

  it('strips CR/LF from header values', () => {
    const s = spec({
      request: { method: 'GET', url: 'https://api.test.dev/x', headers: { 'X-Q': '{{query}}' } },
    })
    expect(buildRequest(s, { query: 'a\r\nX-Evil: 1' }, noSecrets).headers['X-Q']).toBe('aX-Evil: 1')
  })

  it('JSON-escapes body values and sets a content type', () => {
    const s = spec({
      request: { method: 'POST', url: 'https://api.test.dev/x', body: '{"q":"{{query}}"}' },
    })
    const req = buildRequest(s, { query: 'say "hi"\\' }, noSecrets)
    expect(req.body).toBe('{"q":"say \\"hi\\"\\\\"}')
    expect(JSON.parse(req.body!)).toEqual({ q: 'say "hi"\\' })
    expect(req.headers['Content-Type']).toBe('application/json')
  })

  it('form-encodes body values when bodyType is form', () => {
    const s = spec({
      request: { method: 'POST', url: 'https://api.test.dev/x', body: 'q={{query}}', bodyType: 'form' },
    })
    const req = buildRequest(s, { query: 'a&b=c' }, noSecrets)
    expect(req.body).toBe('q=a%26b%3Dc')
    expect(req.headers['Content-Type']).toBe('application/x-www-form-urlencoded')
  })

  it('omits a body for GET', () => {
    const s = spec({ request: { method: 'GET', url: 'https://api.test.dev/x', body: 'ignored' } })
    expect(buildRequest(s, { query: 'q' }, noSecrets).body).toBeUndefined()
  })
})

describe('pickPath', () => {
  const data = { results: [{ t: 'a', m: { y: 2020 } }, { t: 'b', m: { y: 2021 } }], n: 2 }
  it('reads plain and nested keys', () => {
    expect(pickPath(data, 'n')).toBe(2)
    expect(pickPath(data, 'results')).toHaveLength(2)
  })
  it('maps the rest of the path over an array segment', () => {
    expect(pickPath(data, 'results[]')).toHaveLength(2)
    expect(pickPath(data, 'results[].t')).toEqual(['a', 'b'])
    expect(pickPath(data, 'results[].m.y')).toEqual([2020, 2021])
  })
  it('returns undefined for a path that does not fit the data', () => {
    expect(pickPath(data, 'missing.deep')).toBeUndefined()
    expect(pickPath(data, 'missing[]')).toBeUndefined()
  })

  /** XML carries no arity: a feed with one <entry> must shape like one with
   *  twenty, so [] treats a lone value as a list of one. */
  it('treats a lone value as a one-element list', () => {
    expect(pickPath(data, 'n[]')).toEqual([2])
    expect(pickPath({ feed: { entry: { title: 'only' } } }, 'feed.entry[].title')).toEqual(['only'])
  })

  it('indexes arrays numerically — Crossref boxes every field in one', () => {
    const crossref = { title: ['A paper'], issued: { 'date-parts': [[2020, 6, 14]] } }
    expect(pickPath(crossref, 'title.0')).toBe('A paper')
    expect(pickPath(crossref, 'issued.date-parts.0.0')).toBe(2020)
    expect(pickPath(crossref, 'title.9')).toBeUndefined()
  })

  it('reads a root-level array with []', () => {
    expect(pickPath([{ a: 1 }, { a: 2 }], '[]')).toHaveLength(2)
  })

  /** Grouped results (a list of groups, each holding a list) must flatten to
   *  one list — anything else cannot be rendered by a per-item template. */
  it('flattens nested [] segments', () => {
    const grouped = {
      results: [
        { books: [{ info: { t: 'a' } }, { info: { t: 'b' } }] },
        { books: [{ info: { t: 'c' } }] },
      ],
    }
    expect(pickPath(grouped, 'results[].books[].info')).toEqual([
      { t: 'a' },
      { t: 'b' },
      { t: 'c' },
    ])
    expect(pickPath(grouped, 'results[].books[].info.t')).toEqual(['a', 'b', 'c'])
  })
})

describe('renderItem', () => {
  it('fills fields, flattens arrays and blanks what is missing', () => {
    const out = renderItem('- {{title}} ({{meta.year}}) {{tags}} {{nope}}', {
      title: 'T',
      meta: { year: 1999 },
      tags: ['a', 'b'],
    })
    expect(out).toBe('- T (1999) a, b ')
  })

  it('accepts the full path grammar — [] mapping and numeric indices', () => {
    const crossref = {
      title: ['A paper'],
      author: [{ family: 'Basu' }, { family: 'Luhmann' }],
      issued: { 'date-parts': [[2020, 6, 14]] },
    }
    expect(
      renderItem('{{title.0}} — {{author[].family}} ({{issued.date-parts.0.0}})', crossref),
    ).toBe('A paper — Basu, Luhmann (2020)')
  })
})

describe('shapeResponse', () => {
  it('passes text through and clips to the budget', () => {
    expect(shapeResponse(spec(), '  hello  ')).toBe('hello')
    expect(shapeResponse(spec({ maxChars: 5 }), 'abcdefghij')).toContain('[truncated: 10 chars total]')
  })

  it('picks and templates a JSON list', () => {
    const s = spec({
      response: { mode: 'json', pick: 'results[]', template: '- {{title}} ({{year}})' },
    })
    const body = JSON.stringify({ results: [{ title: 'A', year: 1 }, { title: 'B', year: 2 }] })
    expect(shapeResponse(s, body)).toBe('- A (1)\n- B (2)')
  })

  it('falls back to the raw body when JSON does not parse', () => {
    const s = spec({ response: { mode: 'json', pick: 'results[]' } })
    expect(shapeResponse(s, 'not json')).toBe('not json')
  })

  it('names the miss and shows the shape when a pick matches nothing', () => {
    const s = spec({ response: { mode: 'json', pick: 'nope[]', template: '{{x}}' } })
    const out = shapeResponse(s, '{"a":1,"b":2}')
    expect(out).toContain('No match for pick "nope[]"')
    expect(out).toContain('Top-level keys: a, b')
  })

  it('strips markup that arrives inside JSON fields', () => {
    const s = spec({
      response: {
        mode: 'json',
        pick: 'pages[]',
        template: '- {{title}}: {{excerpt}}',
        transform: 'strip-html',
      },
    })
    const body = JSON.stringify({
      pages: [{ title: 'Zettelkasten', excerpt: 'A <span class="s">Zettelkasten</span> (&#039;slipbox&#039;) &amp; more' }],
    })
    expect(shapeResponse(s, body)).toBe("- Zettelkasten: A Zettelkasten ('slipbox') & more")
  })

  it('applies a named transform', () => {
    const enc = encodeURIComponent('https://real.org/doc')
    const s = spec({ response: { mode: 'text', transform: 'ddg-links' } })
    const out = shapeResponse(s, `[R](https://duckduckgo.com/l/?uddg=${enc}&rut=x)`)
    expect(out).toBe('[R](https://real.org/doc)')
  })
})

describe('XML', () => {
  const ATOM = `<?xml version="1.0"?>
<!-- a comment -->
<feed xmlns="http://www.w3.org/2005/Atom" xmlns:arxiv="http://arxiv.org/schemas/atom">
  <title>My feed</title>
  <entry>
    <title>First &amp; foremost</title>
    <published>2026-01-02</published>
    <link href="https://example.com/1" rel="alternate"/>
    <link href="https://example.com/1.pdf" rel="related"/>
    <author><name>Ada</name></author>
    <author><name>Grace</name></author>
    <arxiv:primary_category term="cs.CL"/>
  </entry>
</feed>`

  const RSS = `<rss version="2.0" xmlns:dc="http://purl.org/dc/elements/1.1/"><channel>
  <title>Chan</title>
  <item>
    <title><![CDATA[Bracketed <title> here]]></title>
    <link>https://example.com/a</link>
    <pubDate>Sun, 26 Jul 2026 04:19:59 +0000</pubDate>
    <dc:creator>someone</dc:creator>
    <guid isPermaLink="false">urn:x</guid>
  </item>
</channel></rss>`

  it('reads a leaf as its text and decodes entities', () => {
    const v = xmlToValue(ATOM) as Record<string, Record<string, unknown>>
    expect(pickPath(v, 'feed.title')).toBe('My feed')
    expect(pickPath(v, 'feed.entry.title')).toBe('First & foremost')
  })

  it('exposes attributes, repeated elements and nested children', () => {
    const v = xmlToValue(ATOM)
    expect(pickPath(v, 'feed.entry.link.0.href')).toBe('https://example.com/1')
    expect(pickPath(v, 'feed.entry.author[].name')).toEqual(['Ada', 'Grace'])
    // Namespace prefixes are dropped — a ':' would collide with {{secret:…}}.
    expect(pickPath(v, 'feed.entry.primary_category.term')).toBe('cs.CL')
  })

  it('keeps CDATA verbatim and pairs an attribute with element text', () => {
    const v = xmlToValue(RSS)
    expect(pickPath(v, 'rss.channel.item.title')).toBe('Bracketed <title> here')
    expect(pickPath(v, 'rss.channel.item.guid.isPermaLink')).toBe('false')
    expect(pickPath(v, 'rss.channel.item.guid.value')).toBe('urn:x')
    expect(pickPath(v, 'rss.channel.item.creator')).toBe('someone')
  })

  it('shapes a feed through the same pick/template grammar as JSON', () => {
    const s = spec({
      response: { mode: 'xml', pick: 'feed.entry[]', template: '- {{title}} ({{published}}) {{link.0.href}}' },
    })
    expect(shapeResponse(s, ATOM)).toBe('- First & foremost (2026-01-02) https://example.com/1')
  })

  it('survives junk rather than throwing', () => {
    expect(parseXml('')).toBeNull()
    expect(parseXml('not xml at all')).toBeNull()
    expect(() => xmlToValue('<a><b>unclosed')).not.toThrow()
  })

  it('falls back to the raw body when the payload is not XML', () => {
    const s = spec({ response: { mode: 'xml', pick: 'feed.entry[]' } })
    expect(shapeResponse(s, 'plain text')).toBe('plain text')
  })
})

describe('pickFirst', () => {
  it('takes the first alternative that matches — one tool, RSS or Atom', () => {
    const rss = { rss: { channel: { item: [{ title: 'r' }] } } }
    const atom = { feed: { entry: [{ title: 'a' }] } }
    const pick = 'rss.channel.item[]|feed.entry[]'
    expect(pickFirst(rss, pick)).toEqual([{ title: 'r' }])
    expect(pickFirst(atom, pick)).toEqual([{ title: 'a' }])
    expect(pickFirst({ other: 1 }, pick)).toBeUndefined()
  })

  it('skips an alternative that matches an empty list', () => {
    expect(pickFirst({ a: [], b: [1] }, 'a[]|b[]')).toEqual([1])
  })
})

describe('anyOrigin', () => {
  const feed = (over = {}): HttpToolSpec =>
    spec({
      name: 'read_feed',
      params: { url: { type: 'string', required: true } },
      request: { method: 'GET', url: '{{url}}' },
      anyOrigin: true,
      ...over,
    })

  it('passes a whole URL through instead of percent-encoding it', () => {
    const req = buildRequest(feed(), { url: 'https://example.com/feed.xml?a=1&b=2' }, noSecrets)
    expect(req.url).toBe('https://example.com/feed.xml?a=1&b=2')
  })

  it('demands https and rejects anything that is not a URL', () => {
    expect(() => buildRequest(feed(), { url: 'http://example.com/f' }, noSecrets)).toThrow(/https/)
    expect(() => buildRequest(feed(), { url: 'javascript:alert(1)' }, noSecrets)).toThrow(/https/)
    expect(() => buildRequest(feed(), { url: 'not a url' }, noSecrets)).toThrow(/https/)
  })

  it('refuses to combine an open destination with a stored key', () => {
    const s = feed({
      request: { method: 'GET', url: '{{url}}', headers: { Authorization: '{{secret:k}}' } },
    })
    expect(() => buildRequest(s, { url: 'https://example.com/f' }, () => 'key')).toThrow(
      /open destination with a stored key/,
    )
  })

  it('is stripped from any spec that did not ship with the app', () => {
    const parsed = normalizeHttpTool({
      name: 'sneaky',
      request: { url: 'https://api.example.com/x' },
      anyOrigin: true,
    })
    expect(parsed?.anyOrigin).toBeUndefined()
  })
})

describe('clip', () => {
  it('leaves short text alone', () => {
    expect(clip('abc', 10)).toBe('abc')
  })
})

describe('describeHttpCall', () => {
  it('summarizes with the first parameter', () => {
    expect(describeHttpCall(spec(), { query: 'cats' })).toBe('demo: cats')
    expect(describeHttpCall(spec(), {})).toBe('demo')
  })
})

describe('runHttpTool', () => {
  const ok = (body: string): HttpReply => ({ status: 200, ok: true, body })

  it('returns the shaped body on success', async () => {
    const direct = vi.fn(async () => ok('hello'))
    expect(await runHttpTool(spec(), { query: 'q' }, { resolveSecret: noSecrets, direct })).toBe('hello')
    expect(direct).toHaveBeenCalledOnce()
  })

  it('reports a non-2xx as an error without retrying', async () => {
    const direct = vi.fn(async () => ({ status: 404, ok: false, body: 'nope' }))
    const extension = vi.fn(async () => ok('x'))
    const out = await runHttpTool(spec(), { query: 'q' }, { resolveSecret: noSecrets, direct, extension })
    expect(out).toMatch(/^Error:.*HTTP 404/)
    expect(extension).not.toHaveBeenCalled()
  })

  it('falls back to the extension when a direct call throws (CORS is indistinguishable)', async () => {
    const direct = vi.fn(async () => {
      throw new TypeError('Failed to fetch')
    })
    const extension = vi.fn(async () => ok('from the extension'))
    const out = await runHttpTool(spec(), { query: 'q' }, { resolveSecret: noSecrets, direct, extension })
    expect(out).toBe('from the extension')
    expect(extension).toHaveBeenCalledOnce()
  })

  it('suggests localmd Connect when direct fails and no extension is connected', async () => {
    const direct = vi.fn(async () => {
      throw new TypeError('Failed to fetch')
    })
    const out = await runHttpTool(spec(), { query: 'q' }, { resolveSecret: noSecrets, direct })
    expect(out).toMatch(/localmd Connect/)
  })

  it('refuses an extension-only tool when the extension is absent', async () => {
    const direct = vi.fn(async () => ok('x'))
    const s = spec({ transport: 'extension' })
    const out = await runHttpTool(s, { query: 'q' }, { resolveSecret: noSecrets, direct })
    expect(out).toMatch(/needs the browser extension/)
    expect(direct).not.toHaveBeenCalled()
  })

  it('surfaces a build failure as an error string, not a throw', async () => {
    const direct = vi.fn(async () => ok('x'))
    const out = await runHttpTool(spec(), {}, { resolveSecret: noSecrets, direct })
    expect(out).toMatch(/requires the "query" argument/)
  })
})
