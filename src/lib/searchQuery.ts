/**
 * The search palette's query grammar, factored out so it can be tested as a
 * pure function. A query is free text plus optional filters:
 *
 *   `type:foo` / `type:"foo bar"` — pages whose OKF `type:` contains foo
 *   `tag:foo`  / `tag:"foo bar"`  — pages whose frontmatter tags contain foo
 *
 * Filters compose (both must hold), match case-insensitively and by
 * substring — `tag:llm` finds `llm-agents` — and the rest of the query stays
 * the ordinary filename/content search.
 */
const TYPE_RE = /\btype:(?:"([^"]*)"|(\S+))/i
const TAG_RE = /\btag:(?:"([^"]*)"|(\S+))/i
/** `tag:` with nothing after it — the user is asking which tags exist. */
const BARE_TAG_RE = /\btag:$/i

export interface ParsedSearch {
  typeFilter: string
  tagFilter: string
  text: string
}

export function parseSearchQuery(term: string): ParsedSearch {
  const mType = term.match(TYPE_RE)
  const mTag = term.match(TAG_RE)
  return {
    typeFilter: mType ? (mType[1] ?? mType[2]).toLowerCase() : '',
    tagFilter: mTag ? (mTag[1] ?? mTag[2]).toLowerCase() : '',
    text: term.replace(TYPE_RE, '').replace(TAG_RE, '').trim(),
  }
}

/** Whether a page with this `type:` and these tags passes the parsed filters. */
export function matchesFilters(
  parsed: Pick<ParsedSearch, 'typeFilter' | 'tagFilter'>,
  type: string | null | undefined,
  tags: readonly string[] | undefined,
): boolean {
  if (parsed.typeFilter && !(type ?? '').toLowerCase().includes(parsed.typeFilter)) return false
  if (parsed.tagFilter && !(tags ?? []).some((t) => t.toLowerCase().includes(parsed.tagFilter)))
    return false
  return true
}

/**
 * Whether the query is asking for the list of tags rather than filtering by
 * one. Typing the filter is how you find out it exists; typing it with no
 * value is how you find out what the values are.
 */
export function wantsTagList(term: string): boolean {
  return BARE_TAG_RE.test(term.trimEnd() === term ? term : term.trimEnd())
}
