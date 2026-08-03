/**
 * The recommended-tool catalog — what Settings → Tools offers to install.
 *
 * Most of it is not built in: an entry is something the user checks on or off,
 * so the agent's reach is generally something they chose rather than something
 * the app assumed.
 *
 * The exception is the two entries marked `builtin` — Jina and Parallel, the
 * web-search pair. Those are free forever and sit beside read_file rather than
 * being integrations to connect, because a knowledge base that cannot look
 * anything up is not a working product to hand someone. Everything else here
 * reaches past the user's own folder and model, which is what the paid tier
 * covers (see lib/licence.ts).
 *
 * Every endpoint below was probed for browser CORS before being listed. That
 * matters more than it sounds: a browser-only app can't reach an API that
 * doesn't opt in, and "add the URL and find out" is a terrible first run. Where
 * an endpoint refuses browsers, the entry routes through WebCLI instead —
 * which is why WebCLI is the featured entry: its `fetch_url` runs in a service
 * worker with the user's cookies and no CORS, so it is the one install that
 * makes every *other* tool (and any the agent writes later) more likely to work.
 */
import type { HttpToolSpec } from '@/lib/httpTools'
import { WEBCLI_RELAY_URL } from '@/lib/webcliRelay'

/** The WebCLI tool that makes it a general HTTP transport rather than just
 *  another set of browser tools. Used to detect a usable bridge. */
export const WEBCLI_FETCH_TOOL = 'generic__fetch_url'

export type CatalogKind = 'extension' | 'mcp' | 'http'

export interface CatalogSecret {
  /** Referenced from a spec as {{secret:<id>}}. */
  id: string
  /** Fallback label; the UI prefers settings.catalog.<entry>.secret.<id>. */
  label: string
  /** Where the user obtains it. */
  url?: string
  /** Not actually secret (a user id, an email for an API's polite pool) — shown
   *  as plain text so the user can check it. */
  plain?: boolean
}

export interface CatalogEntry {
  id: string
  kind: CatalogKind
  /** Promoted to the top and visually highlighted. */
  featured?: boolean
  /** Present on a fresh profile unless the user removes it. */
  defaultInstalled?: boolean
  /** Ships with the app and is free forever — web search sits beside read_file
   *  rather than being an integration the user connects. Deliberately a flag on
   *  the entry rather than "whatever is in the catalog today": the catalog is an
   *  editorial list that will change, and the free tier must not change with it.
   *  See `BUILTIN_TOOL_SOURCES` in lib/licence.ts, which names the same set for
   *  the gate. */
  builtin?: boolean
  /** Where to read about / install it. */
  homepage?: string
  /** Its source / companion repository, when there is one worth reading — the
   *  homepage is a store listing or a landing page, which is a different thing. */
  repo?: string
  /** kind 'extension' | 'mcp': the server entry an install adds. For an
   *  extension the url selects a transport rather than naming an address —
   *  WEBCLI_RELAY_URL, whose marker supplies whichever build is installed.
   *
   *  `url`, `token` and any header value may carry `{{secret:<id>}}`, resolved
   *  when the row connects (see resolveServerSecrets). That is what lets an
   *  entry for a keyed service be data rather than code: it names the header
   *  the service chose and the secret to put in it, and the user supplies only
   *  the value. Declare the ids in `secrets` so the UI knows to ask. */
  server?: { name: string; url: string; token?: string; headers?: Record<string, string> }
  /** kind 'http': the tools an install registers. */
  tools?: HttpToolSpec[]
  /** The endpoint refuses browsers, so these tools only work with the WebCLI
   *  extension connected. Surfaced on the card rather than discovered on the
   *  first failed call. */
  requiresWebcli?: boolean
  /** Values the user must supply before the tools work. */
  secrets?: CatalogSecret[]
}

/* ── http tool packs ─────────────────────────────────────────────────────── */

const MAX_WEB_CHARS = 60_000

/** Jina AI Reader — keyless page reader + DuckDuckGo search, both read through
 *  r.jina.ai (open CORS). No cookies, so login-walled pages fail; that is what
 *  the browser extensions are for. This pack is the former built-in. */
const JINA_TOOLS: HttpToolSpec[] = [
  {
    id: 'jina.web_fetch',
    name: 'web_fetch',
    description:
      "Fetch a single web page by URL and return its main content as markdown (via Jina AI Reader — no login or cookies). Use to read a page you have the URL for. Login-walled or heavily bot-protected pages may fail. If browser-extension tools (mcp__*) are connected, prefer those — they carry the user's real session.",
    params: {
      url: { type: 'string', required: true, description: 'Full URL to read, e.g. "https://example.com/article"' },
    },
    request: { method: 'GET', url: 'https://r.jina.ai/{{url}}', headers: { 'X-Retain-Images': 'none' } },
    response: { mode: 'text' },
    maxChars: MAX_WEB_CHARS,
    transport: 'auto',
    web: true,
  },
  {
    id: 'jina.web_search',
    name: 'web_search',
    description:
      'Search the web and return result titles, URLs and snippets as markdown (DuckDuckGo, read via Jina AI Reader). Use when you need to FIND pages and have no URL; then read a promising result with web_fetch (or a browser tool). Prefer connected mcp__* browser tools when available.',
    params: { query: { type: 'string', required: true, description: 'Search query' } },
    request: {
      method: 'GET',
      url: 'https://r.jina.ai/https://html.duckduckgo.com/html/?q={{query}}',
      headers: { 'X-Retain-Images': 'none' },
    },
    response: { mode: 'text', transform: 'ddg-links' },
    maxChars: MAX_WEB_CHARS,
    transport: 'auto',
    web: true,
  },
]

/** Scholarly lookup. OpenAlex and Crossref cover metadata and citation counts
 *  for essentially all of published research; Europe PMC covers biomedical
 *  abstracts. All three are keyless and send `Access-Control-Allow-Origin: *`. */
const RESEARCH_TOOLS: HttpToolSpec[] = [
  {
    id: 'research.openalex_search',
    name: 'openalex_search',
    description:
      'Search scholarly works (papers, preprints, books) by topic on OpenAlex and return title, year, first author, citation count and DOI. Use to find literature on a subject; follow up with crossref_lookup on a DOI for full metadata and an abstract.',
    params: {
      query: { type: 'string', required: true, description: 'Topic or title words to search for' },
      limit: { type: 'number', default: 8, description: 'How many results (default 8)' },
    },
    request: {
      method: 'GET',
      url: 'https://api.openalex.org/works?search={{query}}&per-page={{limit}}&select=doi,display_name,publication_year,cited_by_count,authorships,primary_location',
    },
    response: {
      mode: 'json',
      pick: 'results[]',
      template:
        '- {{display_name}} ({{publication_year}}) — {{authorships.0.author.display_name}} et al. · {{primary_location.source.display_name}} · cited {{cited_by_count}}× · {{doi}}',
    },
    maxChars: 20_000,
    transport: 'auto',
  },
  {
    id: 'research.crossref_lookup',
    name: 'crossref_lookup',
    description:
      'Look up one DOI on Crossref and return its full metadata — title, authors, year, journal, abstract when the publisher deposited one, and the canonical URL. Use to turn a DOI into a citable reference.',
    params: {
      doi: { type: 'string', required: true, description: 'A DOI, e.g. "10.1038/nature12373" (with or without the https://doi.org/ prefix)' },
    },
    request: { method: 'GET', url: 'https://api.crossref.org/works/{{doi}}' },
    response: {
      mode: 'json',
      template:
        '# {{message.title.0}}\nAuthors: {{message.author[].family}}\nYear: {{message.issued.date-parts.0.0}}\nJournal: {{message.container-title.0}}\nDOI: {{message.DOI}}\nURL: {{message.URL}}\nCited by: {{message.is-referenced-by-count}}\n\n{{message.abstract}}',
      // Crossref deposits abstracts as JATS XML (<jats:p>…</jats:p>).
      transform: 'strip-html',
    },
    maxChars: 12_000,
    transport: 'auto',
  },
  {
    id: 'research.europepmc_search',
    name: 'europepmc_search',
    description:
      'Search biomedical and life-sciences literature on Europe PMC (PubMed, PMC, preprints) and return title, authors, journal, year, DOI and PMID. Use for medical or biological questions where PubMed coverage matters.',
    params: {
      query: { type: 'string', required: true, description: 'Search terms, e.g. "CRISPR off-target"' },
      limit: { type: 'number', default: 8, description: 'How many results (default 8)' },
    },
    request: {
      method: 'GET',
      url: 'https://www.ebi.ac.uk/europepmc/webservices/rest/search?query={{query}}&format=json&pageSize={{limit}}',
    },
    response: {
      mode: 'json',
      pick: 'resultList.result[]',
      template: '- {{title}} — {{authorString}} · {{journalTitle}} {{pubYear}} · doi:{{doi}} · PMID {{pmid}}',
    },
    maxChars: 20_000,
    transport: 'auto',
  },
]

/** arXiv has no JSON endpoint and sends no CORS headers, so it is the one
 *  catalog entry that genuinely needs the extension — and the reason `xml` mode
 *  exists at all. OpenAlex covers arXiv preprints too, but without the abstract,
 *  the version, or same-day postings. */
const ARXIV_TOOLS: HttpToolSpec[] = [
  {
    id: 'arxiv.arxiv_search',
    name: 'arxiv_search',
    description:
      'Search arXiv preprints (physics, maths, CS, biology, economics) and return title, authors, date, abstract and links. Use for recent or unpublished research, where arXiv is often months ahead of a journal; use openalex_search instead for published work and citation counts.',
    params: {
      query: {
        type: 'string',
        required: true,
        description: 'Search terms; arXiv field prefixes work, e.g. "ti:transformer" or "cat:cs.CL"',
      },
      limit: { type: 'number', default: 5, description: 'How many results (default 5)' },
    },
    request: {
      method: 'GET',
      url: 'https://export.arxiv.org/api/query?search_query=all:{{query}}&max_results={{limit}}&sortBy=relevance',
    },
    response: {
      mode: 'xml',
      pick: 'feed.entry[]',
      template: '- {{title}} ({{published}})\n  {{author[].name}}\n  {{summary}}\n  {{id}}',
    },
    maxChars: 24_000,
    // arXiv sends no Access-Control-Allow-Origin, verified from the app origin.
    transport: 'webcli',
  },
]

/** General reference. Wikipedia's host is fixed at en. by the static-origin rule
 *  (no placeholder may sit in a hostname); another language is a one-field copy
 *  of the tool, which the editor — or the agent — can make in seconds. */
const REFERENCE_TOOLS: HttpToolSpec[] = [
  {
    id: 'reference.wikipedia_search',
    name: 'wikipedia_search',
    description:
      'Search English Wikipedia article titles and return each match with a one-line description and a matching excerpt. Use to find the right article; then read it with wikipedia_page.',
    params: {
      query: { type: 'string', required: true, description: 'What to search for' },
      limit: { type: 'number', default: 5, description: 'How many results (default 5)' },
    },
    request: {
      method: 'GET',
      url: 'https://en.wikipedia.org/w/rest.php/v1/search/page?q={{query}}&limit={{limit}}',
    },
    response: {
      mode: 'json',
      pick: 'pages[]',
      template: '- {{title}} — {{description}}\n  {{excerpt}}',
      transform: 'strip-html',
    },
    maxChars: 12_000,
    transport: 'auto',
  },
  {
    id: 'reference.wikipedia_page',
    name: 'wikipedia_page',
    description:
      'Read the lead section (summary) of an English Wikipedia article by exact title, with its canonical URL. Use after wikipedia_search, or when you already know the title.',
    params: {
      title: { type: 'string', required: true, description: 'Exact article title, e.g. "Zettelkasten"' },
    },
    request: { method: 'GET', url: 'https://en.wikipedia.org/api/rest_v1/page/summary/{{title}}' },
    response: {
      mode: 'json',
      template: '# {{title}}\n{{description}}\n\n{{extract}}\n\n{{content_urls.desktop.page}}',
    },
    maxChars: 12_000,
    transport: 'auto',
  },
  {
    id: 'reference.openlibrary_search',
    name: 'openlibrary_search',
    description:
      'Search books on Open Library by title, author or subject and return title, author, first publication year and an openlibrary.org link. Use for bibliographic details of books (not papers — use openalex_search for those).',
    params: {
      query: { type: 'string', required: true, description: 'Title, author or subject' },
      limit: { type: 'number', default: 8, description: 'How many results (default 8)' },
    },
    request: {
      method: 'GET',
      url: 'https://openlibrary.org/search.json?q={{query}}&limit={{limit}}&fields=title,author_name,first_publish_year,key',
    },
    response: {
      mode: 'json',
      pick: 'docs[]',
      template: '- {{title}} — {{author_name}} ({{first_publish_year}}) https://openlibrary.org{{key}}',
    },
    maxChars: 12_000,
    transport: 'auto',
  },
]

/**
 * Feeds. The destination is the whole point here, so these carry `anyOrigin` —
 * a flag only a first-party catalog literal can set (see HttpToolSpec).
 *
 * RSS and Atom are kept as two tools rather than one with alternation: their
 * item shapes genuinely differ (RSS `link` is a string; Atom's is an element
 * with an href attribute, sometimes repeated), so a single template would print
 * a JSON blob for one of them. Picking the wrong one is cheap — the pick-miss
 * diagnostic names the root element, so the agent switches on the next call.
 */
const FEED_TOOLS: HttpToolSpec[] = [
  {
    id: 'feeds.rss_feed',
    name: 'rss_feed',
    description:
      "Read an RSS 2.0 feed by URL and return its recent items — title, date and link. Use for a blog, news or podcast feed whose URL you have. If the result says the root element is 'feed', it is Atom: call atom_feed instead.",
    params: {
      url: { type: 'string', required: true, description: 'Full https URL of the RSS feed' },
    },
    request: { method: 'GET', url: '{{url}}' },
    response: {
      mode: 'xml',
      pick: 'rss.channel.item[]',
      template: '- {{title}} · {{pubDate}}\n  {{link}}',
    },
    maxChars: 20_000,
    transport: 'auto',
    anyOrigin: true,
  },
  {
    id: 'feeds.atom_feed',
    name: 'atom_feed',
    description:
      "Read an Atom feed by URL and return its recent entries — title, date and link. Use for a blog or project feed whose URL you have. If the result says the root element is 'rss', call rss_feed instead.",
    params: {
      url: { type: 'string', required: true, description: 'Full https URL of the Atom feed' },
    },
    request: { method: 'GET', url: '{{url}}' },
    response: {
      mode: 'xml',
      pick: 'feed.entry[]',
      template: '- {{title}} · {{published}}\n  {{id}}',
    },
    maxChars: 20_000,
    transport: 'auto',
    anyOrigin: true,
  },
]

/** The user's own reference library. Zotero's API allowlists its `Zotero-API-Key`
 *  header for browser preflights, so this works direct from the page. */
const ZOTERO_TOOLS: HttpToolSpec[] = [
  {
    id: 'zotero.zotero_search',
    name: 'zotero_search',
    description:
      "Search the user's personal Zotero library (references they have saved, with their notes and tags) and return title, creator, date, item type and URL. Use when the user refers to their own literature, sources or reading list.",
    params: {
      query: { type: 'string', required: true, description: 'Words to match in titles, creators, notes and tags' },
      limit: { type: 'number', default: 10, description: 'How many items (default 10)' },
    },
    request: {
      method: 'GET',
      url: 'https://api.zotero.org/users/{{secret:zotero_user}}/items?q={{query}}&qmode=everything&limit={{limit}}&format=json',
      headers: { 'Zotero-API-Key': '{{secret:zotero_key}}' },
    },
    response: {
      mode: 'json',
      pick: '[]',
      template: '- {{data.title}} — {{meta.creatorSummary}} ({{data.date}}) [{{data.itemType}}] {{data.url}}',
    },
    maxChars: 20_000,
    transport: 'direct',
  },
]

/* ── retired packs ───────────────────────────────────────────────────────── */

/**
 * Packs that were once offered here, kept only so an install of one survives.
 *
 * The catalog shrank to what everyone wants on day one. Everything else is now
 * a conversation — the agent researches a service, proposes it, and the user
 * approves — because a curated list is a promise that rots: entries need
 * verifying, describing in two languages, and re-checking forever, and every
 * inclusion is an editorial call ("why Parallel and not Tavily?") that the
 * machinery no longer needs anyone to make.
 *
 * An MCP entry that disappears from here is harmless — installing one copies a
 * row into settings, so it keeps working under its own name. An HTTP pack is
 * different: its tools are looked up here on every read, so dropping the entry
 * would delete tools out from under someone. These specs exist so the migration
 * in stores/settings.ts can hand them over as the user's own instead.
 */
export const RETIRED_PACKS: Record<string, HttpToolSpec[]> = {
  research: RESEARCH_TOOLS,
  reference: REFERENCE_TOOLS,
  feeds: FEED_TOOLS,
  arxiv: ARXIV_TOOLS,
  zotero: ZOTERO_TOOLS,
}

/* ── the catalog ─────────────────────────────────────────────────────────── */

/**
 * What is offered on a first run, and nothing else.
 *
 * Three entries, each earning its place by being wanted before the user knows
 * what they want: WebCLI because it makes everything else more likely to work,
 * and two web searches that fail differently. Anything past that is the user's
 * choice to make, with the agent's help — see docs/app/tools.md.
 */
export const CATALOG: CatalogEntry[] = [
  {
    id: 'webcli',
    kind: 'extension',
    featured: true,
    homepage: 'https://chromewebstore.google.com/detail/webcli/jnhfdhpafndcbppkphhfpecflhogngge',
    repo: 'https://github.com/whitefoxx/webcli-skills',
    server: { name: 'webcli', url: WEBCLI_RELAY_URL },
  },
  {
    id: 'jina',
    kind: 'http',
    defaultInstalled: true,
    builtin: true,
    homepage: 'https://jina.ai/reader/',
    tools: JINA_TOOLS,
  },
  {
    // Default alongside Jina rather than instead of it. They overlap in what
    // they do and differ in how they fail: Jina is an HTTP tool that needs no
    // connection, so it still answers when MCP is unreachable, and its results
    // are shaped down before they reach the model. Parallel is better at
    // finding things and returns far more of them. Keeping both costs the
    // schema bytes of two extra tools and buys a search that survives the other
    // one being down.
    id: 'parallel',
    kind: 'mcp',
    defaultInstalled: true,
    builtin: true,
    homepage: 'https://parallel.ai/',
    server: { name: 'parallel', url: 'https://search.parallel.ai/mcp' },
  },
]

export function catalogEntryById(id: string): CatalogEntry | undefined {
  return CATALOG.find((e) => e.id === id)
}

/** Entry ids installed on a profile that has never been configured. */
export function defaultInstalledIds(): string[] {
  return CATALOG.filter((e) => e.defaultInstalled).map((e) => e.id)
}

/** Featured first, then catalog order — the UI's display sort. */
export function sortedCatalog(): CatalogEntry[] {
  return [...CATALOG].sort((a, b) => Number(!!b.featured) - Number(!!a.featured))
}

/** Every tool an installed set of entries contributes. */
export function toolsForEntries(ids: readonly string[]): HttpToolSpec[] {
  const wanted = new Set(ids)
  return CATALOG.filter((e) => wanted.has(e.id)).flatMap((e) => e.tools ?? [])
}

/** Server configs an installed set of entries contributes (extensions + MCP). */
export function serversForEntries(
  ids: readonly string[],
): Array<{
  entryId: string
  name: string
  url: string
  token?: string
  headers?: Record<string, string>
}> {
  const wanted = new Set(ids)
  return CATALOG.filter((e) => wanted.has(e.id) && e.server).map((e) => ({
    entryId: e.id,
    name: e.server!.name,
    url: e.server!.url,
    ...(e.server!.token ? { token: e.server!.token } : {}),
    ...(e.server!.headers ? { headers: e.server!.headers } : {}),
  }))
}

/** Secret ids an installed set still needs a value for. */
export function missingSecrets(
  ids: readonly string[],
  has: (secretId: string) => boolean,
): Array<{ entryId: string; secret: CatalogSecret }> {
  const wanted = new Set(ids)
  return CATALOG.filter((e) => wanted.has(e.id)).flatMap((e) =>
    (e.secrets ?? []).filter((s) => !has(s.id)).map((secret) => ({ entryId: e.id, secret })),
  )
}
