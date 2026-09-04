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
  tab: '\t',
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
  // eslint-disable-next-line no-control-regex
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

function extractHref(attrs: string): string | null {
  const match = attrs.match(/\shref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i)
  if (!match) return null
  return match[1] ?? match[2] ?? match[3] ?? ''
}

export function sanitizeHtml(html: string): string {
  if (!html) return ''

  // Drop <script>/<style> tags along with their content entirely — their
  // inner text is never safe to surface even after tag-stripping.
  let out = html.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, '')

  // Every other tag is rebuilt from the allowlist below: unknown tags are
  // stripped but their inner text is kept, and attributes are dropped
  // wholesale (including any `on*` handler) except a validated `href` on
  // `<a>`, so nothing carries a handler or attacker-controlled markup.
  out = out.replace(/<(\/?)([a-zA-Z][a-zA-Z0-9]*)((?:\s+[^<>]*)?)\/?>/g, (_match, closingSlash: string, tagName: string, attrs: string) => {
    const tag = tagName.toLowerCase()
    if (!ALLOWED_TAGS.has(tag)) return ''
    if (closingSlash) return VOID_TAGS.has(tag) ? '' : `</${tag}>`
    if (VOID_TAGS.has(tag)) return `<${tag}>`
    if (tag === 'a') {
      const href = extractHref(attrs)
      if (href !== null && isSafeHref(href)) return `<a href="${href.replace(/"/g, '&quot;')}">`
      return '<a>'
    }
    return `<${tag}>`
  })

  return out
}
