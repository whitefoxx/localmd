/**
 * Minimal delimited-text parser for the CSV/TSV table preview: quoted fields,
 * doubled-quote escapes, embedded delimiters and newlines, CRLF. Deliberately
 * forgiving — a malformed file still yields rows, never an exception, because
 * the preview sits next to an editor showing the same bytes.
 */

export function parseDelimited(text: string, delim: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false
  const pushField = (): void => {
    row.push(field)
    field = ''
  }
  const pushRow = (): void => {
    pushField()
    rows.push(row)
    row = []
  }
  let i = 0
  while (i < text.length) {
    const c = text[i]
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"'
          i += 2
          continue
        }
        quoted = false
        i++
        continue
      }
      field += c
      i++
      continue
    }
    if (c === '"' && field === '') {
      quoted = true
      i++
      continue
    }
    if (c === delim) {
      pushField()
      i++
      continue
    }
    if (c === '\n') {
      pushRow()
      i++
      continue
    }
    if (c === '\r') {
      if (text[i + 1] === '\n') i++
      pushRow()
      i++
      continue
    }
    field += c
    i++
  }
  if (field !== '' || row.length) pushRow()
  return rows
}

/** `.tsv` is tabs; for `.csv` the first line votes between `,` and `;` (and a
 *  stray tab-separated `.csv`) — European locales export semicolons. */
export function sniffDelimiter(text: string, path: string): string {
  if (/\.tsv$/i.test(path)) return '\t'
  const line = text.slice(0, text.indexOf('\n') === -1 ? text.length : text.indexOf('\n'))
  const counts: Array<[string, number]> = [',', ';', '\t'].map((d) => [
    d,
    line.split(d).length - 1,
  ])
  counts.sort((a, b) => b[1] - a[1])
  return counts[0][1] > 0 ? counts[0][0] : ','
}
