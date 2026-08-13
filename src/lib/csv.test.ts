import { describe, it, expect } from 'vitest'
import { parseDelimited, sniffDelimiter } from './csv'

describe('parseDelimited', () => {
  it('splits plain rows and fields', () => {
    expect(parseDelimited('a,b,c\n1,2,3', ',')).toEqual([
      ['a', 'b', 'c'],
      ['1', '2', '3'],
    ])
  })

  it('honours quotes: embedded delimiters, newlines, doubled quotes', () => {
    expect(parseDelimited('"a,b",plain\n"line\nbreak","say ""hi"""', ',')).toEqual([
      ['a,b', 'plain'],
      ['line\nbreak', 'say "hi"'],
    ])
  })

  it('treats CRLF and lone CR as row ends, without a phantom last row', () => {
    expect(parseDelimited('a,b\r\nc,d\r\n', ',')).toEqual([
      ['a', 'b'],
      ['c', 'd'],
    ])
    expect(parseDelimited('a\rb', ',')).toEqual([['a'], ['b']])
  })

  it('keeps empty fields, including trailing ones', () => {
    expect(parseDelimited('a,,c\n,,', ',')).toEqual([
      ['a', '', 'c'],
      ['', '', ''],
    ])
  })

  it('a quote mid-field is literal, not an opener', () => {
    expect(parseDelimited('5" nail,ok', ',')).toEqual([['5" nail', 'ok']])
  })

  it('an unterminated quote swallows to the end instead of throwing', () => {
    expect(parseDelimited('"open,ab\ncd', ',')).toEqual([['open,ab\ncd']])
  })
})

describe('sniffDelimiter', () => {
  it('trusts the extension for .tsv', () => {
    expect(sniffDelimiter('a,b\tc', 'data/x.tsv')).toBe('\t')
  })

  it('lets the first line vote for .csv', () => {
    expect(sniffDelimiter('a,b,c\n1,2,3', 'x.csv')).toBe(',')
    expect(sniffDelimiter('a;b;c\n1;2;3', 'x.csv')).toBe(';')
    expect(sniffDelimiter('a\tb\tc', 'x.csv')).toBe('\t')
    expect(sniffDelimiter('single-column', 'x.csv')).toBe(',')
  })
})
