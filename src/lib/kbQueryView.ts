/**
 * A `localmd-query` block rendered to HTML.
 *
 * Pure over a snapshot, like the engine it calls and for the same reason as
 * `marks.ts`: vitest runs in the node environment, and a renderer that only
 * existed inside a Vue composable could only ever be checked by looking at it.
 * The composable that uses this is DOM plumbing and nothing else.
 *
 * What comes out is a VIEW. It is rebuilt from the index on every render and
 * never written back — the note on disk keeps the question, never the answer.
 * That is the whole reason the block is worth having over a pasted list: a
 * materialized list is a record, and a record nobody maintains starts to lie
 * the day someone renames a file.
 *
 * Page links are emitted as ordinary wikilink anchors so the preview's
 * existing click handler opens them. A second click path would be a second
 * thing to keep in step with what opening a page means.
 */
import {
  parseKbQuery,
  runQuery,
  FILTER_HELP,
  type HealthSets,
  type QueryPage,
  type QueryRow,
} from '@/lib/kbQuery'
import { escapeHtml } from '@/lib/wiki'
import { t } from '@/i18n'

/** Shown when the query names no columns of its own. */
const DEFAULT_COLUMNS = ['type', 'modified']

function isoDay(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10)
}

/** A cell the query asked for, or one of the built-ins it did not have to. */
function cellText(row: QueryRow, name: string): string {
  if (name in row.cells) return row.cells[name]
  switch (name) {
    case 'path':
      return row.path
    case 'title':
      return row.title
    case 'type':
      return row.type ?? ''
    case 'tags':
      return row.tags.join(', ')
    case 'modified':
      return row.mtime === undefined ? '' : isoDay(row.mtime)
    case 'inbound':
      return String(row.inbound)
    default:
      return ''
  }
}

function note(cls: string, text: string): string {
  return `<p class="kb-query-note ${cls}">${escapeHtml(text)}</p>`
}

export function renderQueryBlock(
  pages: readonly QueryPage[],
  queryText: string,
  now: number,
  /** Read only if the question asks a health flag — the same lazy hand-off the
   *  palette makes, so a note full of ordinary queries never triggers a lint
   *  pass on every render. */
  health?: () => HealthSets,
): string {
  const { query, errors } = parseKbQuery(queryText, now)
  if (errors.length) {
    // The agent gets the whole grammar back when it writes a bad query; there
    // was no reason the person writing one in their own note should get less.
    // Spent only here, where someone is already stuck — a syntax table on
    // every working block would be furniture.
    const keys = FILTER_HELP.map(
      (f) => `<code>${escapeHtml(`${f.key}:${f.example}`)}</code>`,
    ).join(' ')
    return (
      note('kb-query-error', t('query.badQuery')) +
      `<ul class="kb-query-errors">${errors.map((e) => `<li>${escapeHtml(e)}</li>`).join('')}</ul>` +
      note('kb-query-keys', t('query.canWrite')) +
      `<p class="kb-query-keys-list">${keys}</p>`
    )
  }

  const result = runQuery(pages, query, health)
  const columns = query.columns ?? DEFAULT_COLUMNS
  // `unmatchedTerms` is only ever populated for an empty result — a filter
  // nothing satisfies cannot leave a row standing — so the empty message
  // absorbs the reason and there is no second place for it to appear.
  if (!result.rows.length) {
    const terms = result.unmatchedTerms.join(', ')
    return note(
      'kb-query-empty',
      terms ? t('query.emptyUnknown', { terms }) : t('query.empty'),
    )
  }

  const head = ['', ...columns].map((c) => `<th>${escapeHtml(c)}</th>`).join('')
  const body = result.rows
    .map((row) => {
      const link = `<a class="wikilink" data-target="${escapeHtml(row.path)}" data-resolved="1">${escapeHtml(row.title)}</a>`
      const cells = columns.map((c) => `<td>${escapeHtml(cellText(row, c))}</td>`).join('')
      return `<tr><td>${link}</td>${cells}</tr>`
    })
    .join('')
  const count =
    result.rows.length < result.total
      ? t('query.countCapped', { shown: result.rows.length, total: result.total })
      : t('query.count', { n: result.total })

  return (
    `<table class="kb-query-table"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>` +
    `<p class="kb-query-count">${escapeHtml(count)}</p>`
  )
}
