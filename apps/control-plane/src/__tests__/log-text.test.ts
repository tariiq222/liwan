import { describe, expect, it } from 'vitest'
import { logCode, logText } from '../log-text.js'

describe('logText', () => {
  it('removes carriage returns, line feeds and other control characters so a value cannot forge a log line', () => {
    const forged = ['declined\r\n[payments] attempt 1 settled', String.fromCharCode(0x1b) + '[31m', String.fromCharCode(0), '\ttab', String.fromCharCode(0x2028) + 'next' + String.fromCharCode(0x2029) + 'end' + String.fromCharCode(0x85)].join('')
    const clean = logText(forged)
    expect(clean).not.toMatch(new RegExp('[\\u0000-\\u001f\\u007f-\\u009f\\u2028\\u2029]'))
    expect(clean).toContain('declined')
    expect(clean).toContain('end')
  })
  it('cuts long text, reads an error message and tolerates nothing', () => {
    expect(logText('x'.repeat(500))).toHaveLength(200)
    expect(logText('abcdef', 3)).toBe('abc')
    expect(logText(new Error('a\nb'))).toBe('a b')
    expect(logText(undefined)).toBe('')
    expect(logText(null)).toBe('')
  })
})

describe('logCode', () => {
  it('names an error by its code or class, never by its message, and cleans the code too', () => {
    expect(logCode(Object.assign(new Error('secret\nmessage'), { code: '23505' }))).toBe('23505')
    expect(logCode(new TypeError('x'))).toBe('TypeError')
    expect(logCode(Object.assign(new Error('x'), { code: 'bad\ncode' }))).toBe('bad code')
    expect(logCode(null)).toBe('error')
  })
})
