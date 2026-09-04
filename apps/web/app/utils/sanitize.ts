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

const UNSAFE_HREF_SCHEMES = /^\s*(javascript|data):/i

function isSafeHref(href: string): boolean {
  return href.length > 0 && !UNSAFE_HREF_SCHEMES.test(href)
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
