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

  // The parser used to require whitespace before attributes and matched the
  // attribute run with `[^<>]*`, so none of these four payloads matched the
  // tag regex at all — they were copied through to `v-html` byte-for-byte.
  // They must now come back with no live element in them.
  describe('unmatched-input payloads are escaped, never passed through', () => {
    const payloads = [
      '<img/src=x onerror=alert(1)>',
      '<svg/onload=alert(1)>',
      '<img src=x onerror=alert(1) alt="<">',
      '<iframe/src="javascript:alert(1)">',
    ]

    for (const payload of payloads) {
      it(`neutralises ${payload}`, () => {
        const out = sanitizeHtml(payload)
        // No live element survives: no raw '<' introducing a tag, and none of
        // the handler/scheme text can be sitting inside markup.
        expect(out).not.toMatch(/<[a-zA-Z/]/)
        expect(out.toLowerCase()).not.toContain('<img')
        expect(out.toLowerCase()).not.toContain('<svg')
        expect(out.toLowerCase()).not.toContain('<iframe')
        expect(out.toLowerCase()).not.toContain('onerror=')
        expect(out.toLowerCase()).not.toContain('onload=')
      })
    }

    it('drops the whole slash-form tag rather than leaking its attributes as text', () => {
      expect(sanitizeHtml('<img/src=x onerror=alert(1)>after')).toBe('after')
    })

    it('drops a quoted attribute containing > and keeps only the trailing text', () => {
      expect(sanitizeHtml('<img src=x onerror=alert(1) alt="<">tail')).toBe('tail')
    })
  })

  describe('hostile / malformed input is escaped rather than emitted', () => {
    it('keeps a > inside a quoted attribute from ending an allowed tag early', () => {
      expect(sanitizeHtml('<a href="https://x.test" title="a>b">t</a>')).toBe('<a href="https://x.test">t</a>')
    })

    it('drops a non-allowlisted tag whose name contains a digit', () => {
      expect(sanitizeHtml('<img2 src=x onerror=alert(1)>text')).toBe('text')
    })

    it('keeps an allowlisted tag whose name contains a digit', () => {
      expect(sanitizeHtml('<h1>title</h1>')).toBe('<h1>title</h1>')
    })

    it('accepts spaces around = in an attribute', () => {
      expect(sanitizeHtml('<a href = "https://x.test">t</a>')).toBe('<a href="https://x.test">t</a>')
    })

    it('accepts an unquoted href value', () => {
      expect(sanitizeHtml('<a href=https://x.test>t</a>')).toBe('<a href="https://x.test">t</a>')
    })

    it('escapes a lone < that does not start a tag', () => {
      expect(sanitizeHtml('1 < 2 and 3 > 2')).toBe('1 &lt; 2 and 3 &gt; 2')
    })

    it('escapes an unterminated tag instead of passing it through', () => {
      expect(sanitizeHtml('<a href="https://x.test')).toBe('&lt;a href="https://x.test')
    })

    it('escapes a tag with an unterminated attribute quote', () => {
      const out = sanitizeHtml('<p class="oops>hi')
      expect(out.startsWith('&lt;')).toBe(true)
      expect(out).not.toContain('<p')
    })

    it('drops HTML comments entirely', () => {
      expect(sanitizeHtml('a<!-- <img src=x onerror=alert(1)> -->b')).toBe('ab')
    })

    it('escapes an unterminated comment', () => {
      expect(sanitizeHtml('a<!-- dangling')).toBe('a&lt;!-- dangling')
    })

    it('drops a script tag left unclosed and escapes its body as text', () => {
      const out = sanitizeHtml('<script>alert(1)')
      expect(out).not.toContain('<script')
      expect(out).toBe('alert(1)')
    })
  })
})
