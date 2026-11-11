import { createError, getHeader, getRequestProtocol, type H3Event } from 'h3'
import { authCookiesAreSecure } from './authCookies'
import { isPublicApiPath, PROVIDER_HOOK_PATHS } from './publicApi'

const SAFE_METHODS = ['GET', 'HEAD', 'OPTIONS']

function crossSiteRefusal() {
  return createError({ statusCode: 403, data: { code: 'cross_site_request', message: 'cross-site request rejected' } })
}

// These endpoints mint or drop the Odoo session cookie, so a cross-site form POST
// must never reach them. Requiring a JSON body defeats the plain <form> attack
// (a form can only send urlencoded/multipart/text), and Sec-Fetch-Site rejects
// anything a browser labels as coming from another origin. Requests without the
// header (curl, older browsers) still pass — the JSON check carries those.
export function assertSameSiteJson(event: H3Event): void {
  if (!getHeader(event, 'content-type')?.startsWith('application/json')) {
    throw createError({ statusCode: 415, data: { code: 'unsupported_media_type', message: 'JSON only' } })
  }
  const site = getHeader(event, 'sec-fetch-site')
  if (site && site !== 'same-origin' && site !== 'none') throw crossSiteRefusal()
}

// The /api/v1 paths a write may reach without being same-origin; nothing else is exempt.
// - the public namespace: auth='public' routes for anonymous visitors (a payer, a booking guest); Nuxt forwards them
//   without the browser's cookies and drops any cookie Odoo sets, so there is no session for a forged request to ride.
// - the inbox provider webhooks: the providers call them from their own servers and sign every POST (HMAC), which
//   Odoo verifies; they carry no browser fetch metadata and no session.
// Not exempt on purpose: the server-only paths (404 before this check), the AI service's service-authorized report
// (a server-only path Nuxt writes to Odoo directly, never through the proxy), and /api/v1/auth/* (the browser reaches
// those through /api/auth/*, which has its own guard).
// A state-changing request to the /api/v1 proxy must come from this origin. Odoo accepts a body-less POST of any
// content type, so a plain cross-site <form> would otherwise carry the session cookie to an action route; SameSite
// cannot separate tenants that are sibling subdomains. A browser that sends Sec-Fetch-Site must say `same-origin`
// (`none` is a user-typed navigation, never a write); one that does not must send an Origin equal to this origin
// (scheme and host as the tenant sees them). A write with neither is refused.
export function assertSameOriginWrite(event: H3Event, apiPath: string, upstreamHeaders: Record<string, string>): void {
  if (SAFE_METHODS.includes(event.method) || isPublicApiPath(apiPath) || PROVIDER_HOOK_PATHS.has(apiPath)) return
  const site = getHeader(event, 'sec-fetch-site')
  if (site) {
    if (site === 'same-origin') return
    throw crossSiteRefusal()
  }
  const origin = getHeader(event, 'origin')
  const host = getHeader(event, 'host')
  if (origin && host) {
    const secure = authCookiesAreSecure(event, upstreamHeaders) || getRequestProtocol(event, { xForwardedProto: true }) === 'https'
    if (origin.toLowerCase() === `${secure ? 'https' : 'http'}://${host.toLowerCase()}`) return
  }
  throw crossSiteRefusal()
}
