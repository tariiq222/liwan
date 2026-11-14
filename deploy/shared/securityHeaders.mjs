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

/** Cloudflare Turnstile on the public sign-up page and the find-workspace page (`/register` and `/find-workspace`, the only pages that show the widget). The script, the
 * challenge iframe and its calls all come from one origin; every other document keeps `frame-src 'none'` and no
 * third-party script or connect origin. Customer-hosted (non-SaaS) edges do not use this file and never load it. */
const TURNSTILE_ORIGIN = 'https://challenges.cloudflare.com'
const REGISTER_PATH = /^\/(?:register|find-workspace)\/?$/
const registerPolicy = DOCUMENT_SECURITY_HEADERS['content-security-policy']
  .replace("script-src 'self'", `script-src 'self' ${TURNSTILE_ORIGIN}`)
  .replace("connect-src 'self'", `connect-src 'self' ${TURNSTILE_ORIGIN}`)
  .replace("frame-src 'none'", `frame-src ${TURNSTILE_ORIGIN}`)

/** The card payment page (`/subscription/pay/<order>`, the only page that mounts the Moyasar card form). The form package is
 * bundled with our own scripts and styles and its card-brand images are data URIs, so the page needs one extra origin and only
 * for `connect-src`: the provider's API, where the form fulfils the payment intent with the publishable key. Its error reporter
 * would call a second origin (`appsignal-endpoint.net`); that stays blocked on purpose. The 3-D Secure pages open by navigating
 * the whole window, which no directive here governs. */
export const MOYASAR_API_ORIGIN = 'https://api.moyasar.com'
// Case-sensitive on purpose: the app redirects any other spelling of the path to this one. `deploy/Caddyfile` carries the same
// expression in its `map` and `deploy/shared/securityHeaders.test.mjs` pins the two together.
export const PAY_PATH = /^\/subscription\/pay\/[A-Za-z0-9_-]+\/?$/
const payPolicy = DOCUMENT_SECURITY_HEADERS['content-security-policy']
  .replace("connect-src 'self'", `connect-src 'self' ${MOYASAR_API_ORIGIN}`)

/** The referrer policy is a default: an upstream value that is already set survives. */
export const DEFAULT_ONLY_HEADERS = Object.freeze(new Set(['referrer-policy']))

function policyFor(path, defaultPolicy) {
  if (REGISTER_PATH.test(path)) return registerPolicy
  return PAY_PATH.test(path) ? payPolicy : defaultPolicy
}

/** Apply the document headers to one outgoing response's header map, in place.
 * A fixed header always wins over an upstream value (`defer` on the dedicated edge);
 * a default-only header never overwrites one the app already sent.
 */
export function applyDocumentHeaders(headers, path = '') {
  for (const [name, value] of Object.entries(DOCUMENT_SECURITY_HEADERS)) {
    if (DEFAULT_ONLY_HEADERS.has(name) && headers[name] !== undefined) continue
    headers[name] = name === 'content-security-policy' ? policyFor(path.split('?')[0], value) : value
  }
  return headers
}
