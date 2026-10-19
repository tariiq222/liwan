// Tiny allowlist HTML sanitiser for comment bodies rendered with `v-html` in
// Timeline.vue. The server already sanitises comment HTML on write — this is
// defence in depth against a compromised/misbehaving API response, so it is
// deliberately small: no DOM dependency (works the same in a node vitest run
// and in the browser), rebuilding only the allowlisted tags below and
// dropping every attribute except a validated `href` on `<a>`.
const ALLOWED_TAGS = new Set([
  'p', 'br', 'b', 'strong', 'i', 'em', 'u', 'ul', 'ol', 'li', 'a',
  'code', 'pre', 'blockquote', 'h1', 'h2', 'h3', 'h4', 'span',
])
const VOID_TAGS = new Set(['br'])

// Named entities relevant to smuggling a scheme past the href check (e.g.
// `&colon;` for `:`) plus the handful of general-purpose named entities that
// commonly appear in comment bodies. Numeric (decimal/hex) references are
// handled separately below since they cover an unbounded code point range.
const NAMED_ENTITIES: Record<string, string> = {
  colon: ':',
  // `tab` and `newline` (lowercase) are not real HTML5 named character
  // references; `Tab` and `NewLine` (capitalized) are the actual spec'd
  // entities (https://html.spec.whatwg.org/multipage/named-characters.html).
  // Keep the lowercase spellings too in case any input relies on the
  // (non-conformant but historically-accepted-by-this-parser) lowercase form.
  tab: '\t',
  Tab: '\t',
  newline: '\n',
  NewLine: '\n',
  amp: '&',
  quot: '"',
  apos: '\'',
  lt: '<',
  gt: '>',
}

// Decodes HTML character references so a scheme check can't be bypassed by
// entity-encoding it (e.g. `&#106;avascript:` or `javascript&#58;`). Runs
// repeatedly until the string stops changing (capped) to catch double
// encoding, then strips ASCII control characters, which browsers also strip
// from attribute values before treating them as a URL (e.g. a literal tab
// inside "java\tscript:").
function decodeEntities(value: string): string {
  let out = value
  for (let pass = 0; pass < 5; pass++) {
    const next = out
      .replace(/&#0*([0-9]+);?/g, (_m, dec: string) => String.fromCodePoint(Number(dec)))
      .replace(/&#[xX]0*([0-9a-fA-F]+);?/g, (_m, hex: string) => String.fromCodePoint(parseInt(hex, 16)))
      .replace(/&([a-zA-Z]+);?/g, (m, name: string) => (name in NAMED_ENTITIES ? NAMED_ENTITIES[name]! : m))
    if (next === out) break
    out = next
  }
  // Deliberately strips control characters from the *whole* decoded string
  // rather than just decoding entities and edge-trimming: a control
  // character anywhere in the value (not only at the edges) can split a
  // scheme the browser would otherwise still honour (e.g. "java\tscript:" or
  // a decoded "java&Tab;script:"), so removing them outright — matching how
  // browsers strip these before treating the value as a URL — is simpler and
  // safer than trying to special-case "only edges" or "only certain slots".
  return out.replace(/[\x00-\x20\x7f]/g, '')
}

function isSafeHref(raw: string): boolean {
  const href = decodeEntities(raw).toLowerCase().trim()
  if (!href) return false
  if (href.startsWith('http://') || href.startsWith('https://') || href.startsWith('mailto:')) return true
  if (href.startsWith('//')) return false // protocol-relative
  if (href.startsWith('/') || href.startsWith('./') || href.startsWith('../')
    || href.startsWith('#') || href.startsWith('?')) return true
  // Relative path with no scheme: safe only if there's no ':' before the
  // first path/query/fragment delimiter (otherwise it's an unknown scheme,
  // e.g. "javascript:...", "vbscript:...", "file:...").
  const delimiterIndex = href.search(/[/?#]/)
  const beforeDelimiter = delimiterIndex === -1 ? href : href.slice(0, delimiterIndex)
  return !beforeDelimiter.includes(':')
}

// --- tokenizer ------------------------------------------------------------
// The parser is deliberately fail-closed: `sanitizeHtml` walks the input once
// and emits either a *rebuilt* allowed tag or escaped text. Anything the
// tokenizer does not fully understand — a stray `<`, an unterminated tag, an
// unclosed attribute quote — is escaped and rendered as literal text rather
// than passed through as markup. A previous regex-based pass matched only
// well-shaped `<tag attrs>` forms and copied everything else through
// verbatim, which let `<img/src=x onerror=alert(1)>`, `<svg/onload=…>`,
// `<img src=x onerror=… alt="<">` and `<iframe/src="javascript:…">` reach
// `v-html` byte-for-byte.

interface Attr { name: string; value: string }
interface Tag { end: number; closing: boolean; name: string; attrs: Attr[] }

function isSpace(c: string | undefined): boolean {
  return c === ' ' || c === '\t' || c === '\n' || c === '\r' || c === '\f'
}

function isAlpha(c: string | undefined): boolean {
  return !!c && ((c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z'))
}

function isAlnum(c: string | undefined): boolean {
  return isAlpha(c) || (!!c && c >= '0' && c <= '9')
}

// Parses one tag starting at `src[start] === '<'`. Returns null when the run
// is not a complete, well-formed tag — the caller then escapes the `<`.
// Handles the shapes the old regex missed: `/` immediately after the tag name
// (`<img/src=x>`), quoted attribute values containing `>` or `<`, unquoted
// values, and whitespace around `=`.
function readTag(src: string, start: number): Tag | null {
  let i = start + 1
  const closing = src[i] === '/'
  if (closing) i++
  if (!isAlpha(src[i])) return null
  const nameStart = i
  while (i < src.length && isAlnum(src[i])) i++
  const name = src.slice(nameStart, i).toLowerCase()

  const attrs: Attr[] = []
  for (;;) {
    // `/` is a separator here, not part of a name: `<br/>` and `<img/src=x>`.
    while (i < src.length && (isSpace(src[i]) || src[i] === '/')) i++
    if (i >= src.length) return null // unterminated tag
    if (src[i] === '>') { i++; break }

    const nStart = i
    while (i < src.length && !isSpace(src[i]) && src[i] !== '/' && src[i] !== '>' && src[i] !== '=') i++
    if (i === nStart) return null // bogus (e.g. a bare '=' where a name belongs)
    const attrName = src.slice(nStart, i).toLowerCase()

    let value = ''
    let j = i
    while (j < src.length && isSpace(src[j])) j++
    if (src[j] === '=') {
      j++
      while (j < src.length && isSpace(src[j])) j++
      const quote = src[j]
      if (quote === '"' || quote === '\'') {
        const close = src.indexOf(quote, j + 1)
        if (close === -1) return null // unterminated quote
        value = src.slice(j + 1, close)
        i = close + 1
      } else {
        const vStart = j
        while (j < src.length && !isSpace(src[j]) && src[j] !== '>') j++
        if (j === vStart) return null // '=' with no value
        value = src.slice(vStart, j)
        i = j
      }
    }
    attrs.push({ name: attrName, value })
  }
  return { end: i, closing, name, attrs }
}

// Text nodes: only `<`/`>` are escaped. `&` is left alone deliberately so
// server-produced entities (`&amp;`, `&nbsp;`) keep rendering as themselves
// instead of being double-encoded.
function escapeText(text: string): string {
  return text.replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function escapeAttr(value: string): string {
  return value.replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

// Rebuilds an allowed tag, or returns '' for a well-formed tag that is simply
// not on the allowlist (its inner text is kept by the caller's normal walk).
function renderTag(tag: Tag): string {
  if (!ALLOWED_TAGS.has(tag.name)) return ''
  if (tag.closing) return VOID_TAGS.has(tag.name) ? '' : `</${tag.name}>`
  if (VOID_TAGS.has(tag.name)) return `<${tag.name}>`
  if (tag.name === 'a') {
    const href = tag.attrs.find((a) => a.name === 'href')
    if (href && isSafeHref(href.value)) return `<a href="${escapeAttr(href.value)}">`
    return '<a>'
  }
  return `<${tag.name}>`
}

export function sanitizeHtml(html: string): string {
  if (!html) return ''

  // Drop <script>/<style> tags along with their content entirely — their
  // inner text is never safe to surface even after tag-stripping. (Anything
  // this misses is still handled by the tokenizer below, which drops the tag
  // and escapes what follows.)
  const src = html.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, '')

  let out = ''
  let i = 0
  while (i < src.length) {
    const lt = src.indexOf('<', i)
    if (lt === -1) {
      out += escapeText(src.slice(i))
      break
    }
    out += escapeText(src.slice(i, lt))

    // Comments are understood markup: drop them (content included). An
    // unterminated one falls through to the escape below.
    if (src.startsWith('<!--', lt)) {
      const close = src.indexOf('-->', lt + 4)
      if (close !== -1) { i = close + 3; continue }
      out += '&lt;'
      i = lt + 1
      continue
    }

    const tag = readTag(src, lt)
    if (!tag) {
      // Not a tag we understand — fail closed and render the `<` as text.
      out += '&lt;'
      i = lt + 1
      continue
    }
    out += renderTag(tag)
    i = tag.end
  }

  return out
}
