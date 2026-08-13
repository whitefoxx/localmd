import { describe, it, expect } from 'vitest'
import { colIndex, formatKind, formatSerial, resolvePart } from './xlsx'

/* The zip/XML walk needs a DOM and is exercised in the browser (e2e, like the
   docx extractor); these cover the decisions that turn cells into text. */

describe('colIndex', () => {
  it('reads the column letters of a cell reference, zero-based', () => {
    expect(colIndex('A1')).toBe(0)
    expect(colIndex('Z99')).toBe(25)
    expect(colIndex('AA3')).toBe(26)
    expect(colIndex('BC12')).toBe(54)
    expect(colIndex('XFD1048576')).toBe(16383)
  })

  it('is -1 for a reference with no letters', () => {
    expect(colIndex('12')).toBe(-1)
    expect(colIndex('')).toBe(-1)
  })
})

describe('formatKind', () => {
  it('classifies date, time and datetime codes', () => {
    expect(formatKind('yyyy-mm-dd')).toBe('date')
    expect(formatKind('mmm yyyy')).toBe('date')
    expect(formatKind('hh:mm:ss')).toBe('time')
    expect(formatKind('h:mm AM/PM')).toBe('time')
    expect(formatKind('yyyy-mm-dd hh:mm')).toBe('datetime')
  })

  it('bare m never decides on its own — month vs minute is ambiguous', () => {
    expect(formatKind('mm:ss')).toBe('time') // the s decides
    expect(formatKind('0.00')).toBeNull()
  })

  it('ignores quoted literals, bracketed codes and escapes', () => {
    expect(formatKind('"day of ship"0')).toBeNull()
    expect(formatKind('[Red]0.00')).toBeNull()
    expect(formatKind('0.0\\h')).toBeNull()
    expect(formatKind('[$-409]d-mmm-yy')).toBe('date')
  })

  it('plain number and text codes are not dates', () => {
    expect(formatKind('#,##0.00')).toBeNull()
    expect(formatKind('0.00E+00')).toBeNull()
    expect(formatKind('@')).toBeNull()
  })
})

describe('formatSerial', () => {
  it('renders the 1900-system epoch and a known date', () => {
    // Excel shows serial 1 as 1900-01-01 because it believes in 1900-02-29;
    // the standard workaround (epoch 1899-12-30) is a day off before 1900-03-01
    // and exact after — the trade every spreadsheet reader makes.
    expect(formatSerial(1, 'date')).toBe('1899-12-31')
    expect(formatSerial(45658, 'date')).toBe('2025-01-01')
  })

  it('renders the time fraction, rounded to whole seconds', () => {
    expect(formatSerial(0.5, 'time')).toBe('12:00')
    expect(formatSerial(45658.75, 'datetime')).toBe('2025-01-01 18:00')
    // 10:30:15 = 37815s of 86400 — float dust must not shift the second.
    expect(formatSerial(37815 / 86400, 'time')).toBe('10:30:15')
  })

  it('honours the 1904 date system', () => {
    expect(formatSerial(0, 'date', true)).toBe('1904-01-01')
  })
})

describe('resolvePart', () => {
  it('resolves relative, parent-relative and absolute targets', () => {
    expect(resolvePart('xl', 'worksheets/sheet1.xml')).toBe('xl/worksheets/sheet1.xml')
    expect(resolvePart('ppt/slides', '../media/image1.png')).toBe('ppt/media/image1.png')
    expect(resolvePart('xl', '/xl/worksheets/sheet1.xml')).toBe('xl/worksheets/sheet1.xml')
  })
})
