import { describe, expect, it } from 'vitest'
import { sanitizeHtml } from '../sanitize'

describe('sanitizeHtml', () => {
  it('strips script tags and their content', () => {
    expect(sanitizeHtml('<p>hi</p><script>alert(1)</script>')).toBe('<p>hi</p>')
  })

  it('strips style tags and their content', () => {
    expect(sanitizeHtml('<style>body{color:red}</style><p>hi</p>')).toBe('<p>hi</p>')
  })

  it('strips on* attributes (e.g. onclick) from otherwise-allowed tags', () => {
    expect(sanitizeHtml('<p onclick="alert(1)">hi</p>')).toBe('<p>hi</p>')
  })

  it('strips onerror from a non-allowed tag but keeps its text content', () => {
    expect(sanitizeHtml('<img src=x onerror="alert(1)">gotcha')).toBe('gotcha')
  })

  it('removes javascript: hrefs but keeps the anchor and its text', () => {
    expect(sanitizeHtml('<a href="javascript:alert(1)">click</a>')).toBe('<a>click</a>')
  })

  it('removes data: hrefs but keeps the anchor and its text', () => {
    expect(sanitizeHtml('<a href="data:text/html,evil">click</a>')).toBe('<a>click</a>')
  })

  it('keeps safe http(s) hrefs on anchors', () => {
    expect(sanitizeHtml('<a href="https://example.com">link</a>')).toBe('<a href="https://example.com">link</a>')
  })

  it('preserves allowlisted formatting tags', () => {
    expect(sanitizeHtml('<b>bold</b> <ul><li>one</li></ul>')).toBe('<b>bold</b> <ul><li>one</li></ul>')
  })

  it('preserves plain text unchanged', () => {
    expect(sanitizeHtml('hello world')).toBe('hello world')
  })

  it('handles empty input', () => {
    expect(sanitizeHtml('')).toBe('')
  })
})
