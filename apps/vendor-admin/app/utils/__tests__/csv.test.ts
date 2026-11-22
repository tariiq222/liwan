import { describe, expect, it } from 'vitest'
import { csvLiteral, toCsvTable } from '../csv'

const BOM = '﻿'

describe('toCsvTable', () => {
  it('starts with a byte-order mark, ends every line with CRLF and joins cells with commas', () => {
    expect(toCsvTable(['a', 'b'], [['x', 'y'], ['z', 'w']])).toBe(`${BOM}a,b\r\nx,y\r\nz,w\r\n`)
  })

  it('quotes a cell holding a comma, a quote or a line break, doubling the quotes', () => {
    expect(toCsvTable(['h'], [['He said "hi", ok'], ['two\nlines'], ['car\rreturn']])).toBe(`${BOM}h\r\n"He said ""hi"", ok"\r\n"two\nlines"\r\n"car\rreturn"\r\n`)
  })

  it.each(['=', '+', '-', '@', '\t', '\r'])('writes a customer name starting with %j as text, behind an apostrophe', (first) => {
    const name = `${first}HYPERLINK("http://evil.example","x")`
    const csv = toCsvTable(['name'], [[name]])
    const cell = csv.slice(`${BOM}name\r\n`.length, -2)
    const unquoted = cell.startsWith('"') ? cell.slice(1, -1).replaceAll('""', '"') : cell
    expect(unquoted).toBe(`'${name}`)
  })

  it('leaves a name that merely contains a dangerous character alone', () => {
    expect(toCsvTable(['n'], [['A-B'], ['a=b'], ["'quoted"], [' =lead']])).toBe(`${BOM}n\r\nA-B\r\na=b\r\n'quoted\r\n =lead\r\n`)
  })

  it('writes number cells and literal cells as given, with no apostrophe, and a null cell empty', () => {
    expect(toCsvTable(['n', 'l', 'e'], [[-5, csvLiteral('-12.50'), null], [0, csvLiteral('+3'), null]])).toBe(`${BOM}n,l,e\r\n-5,-12.50,\r\n0,+3,\r\n`)
  })

  it('does not alter the header, which the code writes', () => {
    expect(toCsvTable(['-x', '=y'], [])).toBe(`${BOM}-x,=y\r\n`)
  })

  it('refuses a number that is not finite', () => {
    expect(() => toCsvTable(['n'], [[Number.NaN]])).toThrow()
    expect(() => toCsvTable(['n'], [[Number.POSITIVE_INFINITY]])).toThrow()
  })

  it('keeps an Arabic name through the bytes: a UTF-8 byte-order mark, then the text', () => {
    const name = 'شركة المثال, للتجارة'
    const bytes = new TextEncoder().encode(toCsvTable(['الاسم'], [[name]]))
    expect([...bytes.slice(0, 3)]).toEqual([0xEF, 0xBB, 0xBF])
    const text = new TextDecoder('utf-8', { ignoreBOM: true }).decode(bytes)
    expect(text).toBe(`${BOM}الاسم\r\n"${name}"\r\n`)
    expect(text.slice(1)).toContain('شركة المثال')
  })
})
