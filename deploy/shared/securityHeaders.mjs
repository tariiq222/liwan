/** The browser-document security headers of the shared edge.
 *
 * The dedicated edge sets these on its Nuxt route in `deploy/Caddyfile`; the shared
 * edge had no equivalent, so a tenant's pages were served without a CSP, HSTS or
 * frame protection (issue #480). The values are the dedicated ones, kept in one
 * place so the two edges cannot drift apart: `deploy/shared/securityHeaders.test.mjs`
 * pins this object's header names to the set the dedicated Caddyfile sets.
 *
 * Only documents from the Nuxt upstream carry them. Odoo answers JSON, PDF reports
 * and binary downloads, where a document CSP breaks report rendering,
 * exactly as the dedicated edge explains above its own `header` block.
 */
export const DOCUMENT_SECURITY_HEADERS = Object.freeze({
  'content-security-policy': "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:; connect-src 'self' wss:; object-src 'none'; frame-src 'none'; base-uri 'self'; form-action 'self' https:; frame-ancestors 'none'",
  // '?' semantics on the dedicated edge: a stricter value the app already sent wins.
  // A page that carries a document token sets `no-referrer` itself, so only set this
  // when the upstream did not send one.
  'referrer-policy': 'strict-origin-when-cross-origin',
  'strict-transport-security': 'max-age=31536000',
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
  'permissions-policy': 'camera=(), microphone=(), display-capture=(), geolocation=(self), fullscreen=(self)',
})

/** The referrer policy is a default: an upstream value that is already set survives. */
export const DEFAULT_ONLY_HEADERS = Object.freeze(new Set(['referrer-policy']))

/** Apply the document headers to one outgoing response's header map, in place.
 * A fixed header always wins over an upstream value (`defer` on the dedicated edge);
 * a default-only header never overwrites one the app already sent.
 */
export function applyDocumentHeaders(headers) {
  for (const [name, value] of Object.entries(DOCUMENT_SECURITY_HEADERS)) {
    if (DEFAULT_ONLY_HEADERS.has(name) && headers[name] !== undefined) continue
    headers[name] = value
  }
  return headers
}
