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

  describe('entity-encoded scheme bypass', () => {
    it('strips a decimal-entity-encoded javascript: href', () => {
      expect(sanitizeHtml('<a href="&#106;avascript:alert(1)">click</a>')).toBe('<a>click</a>')
    })

    it('strips a decimal-entity-encoded colon in javascript:', () => {
      expect(sanitizeHtml('<a href="javascript&#58;alert(1)">click</a>')).toBe('<a>click</a>')
    })

    it('strips a hex-entity-encoded javascript: href', () => {
      expect(sanitizeHtml('<a href="&#x6A;avascript:alert(1)">click</a>')).toBe('<a>click</a>')
    })

    it('strips javascript: regardless of case', () => {
      expect(sanitizeHtml('<a href="JaVaScRiPt:alert(1)">click</a>')).toBe('<a>click</a>')
    })

    it('strips a href with a leading control character before the scheme', () => {
      expect(sanitizeHtml('<a href="\tjavascript:alert(1)">click</a>')).toBe('<a>click</a>')
    })

    it('strips a href with an embedded NUL inside the scheme name', () => {
      expect(sanitizeHtml('<a href="java\x00script:alert(1)">click</a>')).toBe('<a>click</a>')
    })

    it('strips a href with a capitalized &Tab; entity inside the scheme name', () => {
      expect(sanitizeHtml('<a href="java&Tab;script:alert(1)">click</a>')).toBe('<a>click</a>')
    })

    it('strips a href with a capitalized &NewLine; entity inside the scheme name', () => {
      expect(sanitizeHtml('<a href="java&NewLine;script:alert(1)">click</a>')).toBe('<a>click</a>')
    })

    it('strips protocol-relative hrefs', () => {
      expect(sanitizeHtml('<a href="//evil.com">click</a>')).toBe('<a>click</a>')
    })

    it('strips vbscript: hrefs', () => {
      expect(sanitizeHtml('<a href="vbscript:msgbox(1)">click</a>')).toBe('<a>click</a>')
    })

    it('strips data: hrefs with a base64 payload', () => {
      expect(sanitizeHtml('<a href="data:text/html;base64,PHNjcmlwdD4=">click</a>')).toBe('<a>click</a>')
    })
  })

  describe('allowlisted href schemes are kept', () => {
    it('keeps https hrefs', () => {
      expect(sanitizeHtml('<a href="https://example.com">link</a>')).toBe('<a href="https://example.com">link</a>')
    })

    it('keeps http hrefs with query and fragment', () => {
      expect(sanitizeHtml('<a href="http://example.com/a?b=1#c">link</a>')).toBe('<a href="http://example.com/a?b=1#c">link</a>')
    })

    it('keeps mailto hrefs', () => {
      expect(sanitizeHtml('<a href="mailto:a@b.com">link</a>')).toBe('<a href="mailto:a@b.com">link</a>')
    })

    it('keeps root-relative hrefs', () => {
      expect(sanitizeHtml('<a href="/tasks/12">link</a>')).toBe('<a href="/tasks/12">link</a>')
    })

    it('keeps fragment-only hrefs', () => {
      expect(sanitizeHtml('<a href="#anchor">link</a>')).toBe('<a href="#anchor">link</a>')
    })

    it('keeps query-only hrefs', () => {
      expect(sanitizeHtml('<a href="?q=1">link</a>')).toBe('<a href="?q=1">link</a>')
    })

    it('keeps schemeless relative-path hrefs', () => {
      expect(sanitizeHtml('<a href="relative/path">link</a>')).toBe('<a href="relative/path">link</a>')
    })
  })
})
