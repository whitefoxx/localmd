/**
 * Extract an .xlsx workbook into plain string tables for the sheet preview.
 *
 * An .xlsx is a zip of XML: `xl/workbook.xml` names the sheets,
 * `xl/_rels/workbook.xml.rels` locates their parts, `xl/sharedStrings.xml`
 * holds the deduplicated text, and `xl/styles.xml` is how a bare number admits
 * to being a date. We read those directly rather than pulling in a spreadsheet
 * library — the preview needs displayed values, not formulas, formatting or
 * charts.
 *
 * What a cell yields: shared/inline strings, cached formula results, booleans
 * as TRUE/FALSE, error literals, and date-styled serials rendered as ISO dates.
 * Not extracted: merged-cell spans, per-cell formatting, charts, comments.
 *
 * Like the docx extractor, the XML walk needs a DOM and is exercised in the
 * browser (e2e); the pure decisions (cell refs, date formats, serial dates)
 * are unit-tested.
 */
import JSZip from 'jszip'

export interface SheetTable {
  name: string
  rows: string[][]
  /** True when the sheet was cut at the parser's row/column safety caps. */
  clipped: boolean
}

export interface XlsxResult {
  sheets: SheetTable[]
}

/** Thrown for the legacy binary .xls format, which is not OOXML at all. */
export class LegacyXlsError extends Error {
  constructor() {
    super('Legacy .xls (Excel 97–2003) is not supported — open it in Excel and save as .xlsx.')
    this.name = 'LegacyXlsError'
  }
}

/** Safety caps: a stray formatted cell at XFD1048576 must not allocate the
 *  whole grid. The viewer shows less than this; these only bound memory. */
const MAX_ROWS = 50_000
const MAX_COLS = 512

export async function extractXlsx(bytes: ArrayBuffer): Promise<XlsxResult> {
  if (isOleCompoundFile(bytes)) throw new LegacyXlsError()

  let zip: JSZip
  try {
    zip = await JSZip.loadAsync(bytes)
  } catch {
    throw new Error('Not a readable .xlsx file (the zip container could not be opened).')
  }
  const workbookXml = await readText(zip, 'xl/workbook.xml')
  if (workbookXml === null) {
    throw new Error('Not an Excel workbook: xl/workbook.xml is missing.')
  }

  const workbook = parseXml(workbookXml, 'xl/workbook.xml')
  const date1904 =
    byLocal(workbook.documentElement, 'workbookPr')[0]?.getAttribute('date1904') === '1'
  const rels = parseRels(await readText(zip, 'xl/_rels/workbook.xml.rels'))
  const shared = parseSharedStrings(await readText(zip, 'xl/sharedStrings.xml'))
  const dateXfs = parseDateStyles(await readText(zip, 'xl/styles.xml'))

  const sheets: SheetTable[] = []
  for (const sheet of byLocal(workbook.documentElement, 'sheet')) {
    const name = sheet.getAttribute('name') ?? `Sheet${sheets.length + 1}`
    const rid =
      sheet.getAttributeNS(RELS_NS, 'id') ?? sheet.getAttribute('r:id') ?? ''
    const target = rels.get(rid)
    const xml = target ? await readText(zip, resolvePart('xl', target)) : null
    if (xml === null) {
      sheets.push({ name, rows: [], clipped: false })
      continue
    }
    sheets.push({ name, ...parseWorksheet(parseXml(xml, name), shared, dateXfs, date1904) })
  }
  return { sheets }
}

/* ── worksheet ───────────────────────────────────────────────────────────── */

function parseWorksheet(
  doc: XMLDocument,
  shared: string[],
  dateXfs: Array<'date' | 'time' | 'datetime' | null>,
  date1904: boolean,
): { rows: string[][]; clipped: boolean } {
  const rows: string[][] = []
  let clipped = false
  let lastRow = -1
  for (const rowEl of byLocal(doc.documentElement, 'row')) {
    const declared = Number(rowEl.getAttribute('r'))
    const rowIdx = Number.isInteger(declared) && declared > 0 ? declared - 1 : lastRow + 1
    lastRow = rowIdx
    if (rowIdx >= MAX_ROWS) {
      clipped = true
      break
    }
    const cells: string[] = (rows[rowIdx] ??= [])
    let lastCol = -1
    for (const c of Array.from(rowEl.children).filter((el) => el.localName === 'c')) {
      const declared = colIndex(c.getAttribute('r') ?? '')
      // A cell without (or with a malformed) ref sits right of its predecessor.
      const colIdx = declared >= 0 ? declared : lastCol + 1
      lastCol = colIdx
      if (colIdx >= MAX_COLS) {
        clipped = true
        continue
      }
      const text = cellText(c, shared, dateXfs, date1904)
      if (text !== '') cells[colIdx] = text
    }
  }
  // Sparse holes (skipped rows, skipped cells) become empty strings.
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i] ?? (rows[i] = [])
    for (let j = 0; j < r.length; j++) r[j] ??= ''
  }
  return { rows, clipped }
}

function cellText(
  c: Element,
  shared: string[],
  dateXfs: Array<'date' | 'time' | 'datetime' | null>,
  date1904: boolean,
): string {
  const t = c.getAttribute('t') ?? 'n'
  if (t === 'inlineStr') {
    return byLocal(c, 't')
      .filter((el) => !hasAncestor(el, 'rPh'))
      .map((el) => el.textContent ?? '')
      .join('')
  }
  const v = byLocal(c, 'v')[0]?.textContent ?? ''
  if (v === '') return ''
  if (t === 's') return shared[Number(v)] ?? ''
  if (t === 'str') return v
  if (t === 'b') return v === '1' ? 'TRUE' : 'FALSE'
  if (t === 'e') return v
  // A number — possibly a date wearing a number format.
  const n = Number(v)
  if (!Number.isFinite(n)) return v
  const dateKind = dateXfs[Number(c.getAttribute('s') ?? -1)] ?? null
  if (dateKind) return formatSerial(n, dateKind, date1904)
  return String(n)
}

/** 'BC12' → 54: the zero-based column of a cell reference. */
export function colIndex(ref: string): number {
  let col = 0
  for (const ch of ref) {
    const c = ch.toUpperCase().charCodeAt(0)
    if (c < 65 || c > 90) break
    col = col * 26 + (c - 64)
  }
  return col - 1
}

/* ── dates ───────────────────────────────────────────────────────────────── */

/** Builtin numFmtIds that mean date/time (ECMA-376 §18.8.30). Durations
 *  (45–47) stay raw numbers — rendering 30 hours as a clock time would lie. */
const BUILTIN_DATE_KIND: Record<number, 'date' | 'time' | 'datetime'> = {
  14: 'date',
  15: 'date',
  16: 'date',
  17: 'date',
  18: 'time',
  19: 'time',
  20: 'time',
  21: 'time',
  22: 'datetime',
}

/**
 * Classify a custom number-format code. Quoted literals, [bracketed] color and
 * locale codes, and backslash escapes carry no meaning; in what remains, y/d
 * announce a date and h/s a time (bare `m` is ambiguous — month vs minute —
 * and never decides on its own).
 */
export function formatKind(code: string): 'date' | 'time' | 'datetime' | null {
  const bare = code.replace(/"[^"]*"/g, '').replace(/\[[^\]]*\]/g, '').replace(/\\./g, '')
  const hasDate = /[yd]/i.test(bare)
  const hasTime = /[hs]/i.test(bare)
  if (hasDate && hasTime) return 'datetime'
  if (hasDate) return 'date'
  if (hasTime) return 'time'
  return null
}

/** Excel serial → ISO-ish text. Serials count days from 1899-12-30 (or
 *  1904-01-01); the fraction is the time of day, rounded to whole seconds. */
export function formatSerial(
  serial: number,
  kind: 'date' | 'time' | 'datetime',
  date1904 = false,
): string {
  const epoch = date1904 ? Date.UTC(1904, 0, 1) : Date.UTC(1899, 11, 30)
  const d = new Date(epoch + Math.round(serial * 86400) * 1000)
  if (Number.isNaN(d.getTime())) return String(serial)
  const pad = (n: number): string => String(n).padStart(2, '0')
  const date = `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`
  const secs = d.getUTCSeconds()
  const time = `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}${secs ? `:${pad(secs)}` : ''}`
  if (kind === 'date') return date
  if (kind === 'time') return time
  return `${date} ${time}`
}

/** cellXfs index → the date kind its number format implies, or null. */
function parseDateStyles(xml: string | null): Array<'date' | 'time' | 'datetime' | null> {
  if (xml === null) return []
  const doc = parseXml(xml, 'xl/styles.xml')
  const custom = new Map<number, 'date' | 'time' | 'datetime' | null>()
  for (const fmt of byLocal(doc.documentElement, 'numFmt')) {
    custom.set(Number(fmt.getAttribute('numFmtId')), formatKind(fmt.getAttribute('formatCode') ?? ''))
  }
  const cellXfs = byLocal(doc.documentElement, 'cellXfs')[0]
  if (!cellXfs) return []
  return byLocal(cellXfs, 'xf').map((xf) => {
    const id = Number(xf.getAttribute('numFmtId') ?? -1)
    return BUILTIN_DATE_KIND[id] ?? custom.get(id) ?? null
  })
}

/* ── shared parts ────────────────────────────────────────────────────────── */

const RELS_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'

function parseSharedStrings(xml: string | null): string[] {
  if (xml === null) return []
  const doc = parseXml(xml, 'xl/sharedStrings.xml')
  return Array.from(doc.documentElement.children)
    .filter((el) => el.localName === 'si')
    .map((si) =>
      byLocal(si, 't')
        .filter((el) => !hasAncestor(el, 'rPh')) // phonetic guides are not the text
        .map((el) => el.textContent ?? '')
        .join(''),
    )
}

function parseRels(xml: string | null): Map<string, string> {
  const map = new Map<string, string>()
  if (xml === null) return map
  const doc = parseXml(xml, 'rels')
  for (const rel of byLocal(doc.documentElement, 'Relationship')) {
    const id = rel.getAttribute('Id')
    const target = rel.getAttribute('Target')
    if (id && target && rel.getAttribute('TargetMode') !== 'External') map.set(id, target)
  }
  return map
}

/** Resolve a relationship target against its base part directory. */
export function resolvePart(baseDir: string, target: string): string {
  if (target.startsWith('/')) return target.slice(1)
  const segs = baseDir.split('/').filter(Boolean)
  for (const part of target.split('/')) {
    if (part === '..') segs.pop()
    else if (part !== '.') segs.push(part)
  }
  return segs.join('/')
}

/* ── plumbing (mirrors the docx extractor) ───────────────────────────────── */

function isOleCompoundFile(bytes: ArrayBuffer): boolean {
  const b = new Uint8Array(bytes.slice(0, 8))
  const magic = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]
  return b.length === 8 && magic.every((m, i) => b[i] === m)
}

async function readText(zip: JSZip, path: string): Promise<string | null> {
  const entry = zip.file(path)
  return entry ? entry.async('text') : null
}

function parseXml(xml: string, what: string): XMLDocument {
  const doc = new DOMParser().parseFromString(xml, 'application/xml')
  if (doc.getElementsByTagName('parsererror').length > 0) {
    throw new Error(`Could not parse ${what}.`)
  }
  return doc
}

/** All descendants with the given local name, in document order. */
function byLocal(el: Element, localName: string): Element[] {
  return Array.from(el.getElementsByTagNameNS('*', localName))
}

function hasAncestor(el: Element, localName: string): boolean {
  for (let p = el.parentElement; p; p = p.parentElement) {
    if (p.localName === localName) return true
  }
  return false
}
