import type { H3Event } from 'h3'
import { getProxyRequestHeaders } from 'h3'
import { legacyTenantResponse, MAX_PUBLIC_HOOK_BODY, MAX_PUBLIC_MFA_BODY, tenantTransport } from './tenantTransport'
import { tenantUpstreamHeaders } from './tenantRequest'
import { withUiLocale } from './uiLocale'

/**
 * The one public namespace of the Odoo API: every route under it is `auth='public'`, answers
 * without a session and is reached by anonymous visitors (a payer, a booking guest). Nuxt forwards
 * it without the browser's cookies and drops any cookie Odoo would set, so a public request can
 * neither use nor create a session.
 */
export const PUBLIC_API_NAMESPACE = '/api/v1/public/'
export const PUBLIC_API_NAMESPACE_METHODS = ['GET', 'HEAD', 'POST'] as const
/** The invited requester's booking-link routes: the one public surface a visitor can open on a page that retries,
 * so they take their own admission pool instead of the shared public one (sign-in must never queue behind them). */
export const BOOKING_API_PREFIX = '/api/v1/public/appointments/'
/** Public JSON bodies are small forms: a token and a few ids. */
export const MAX_PUBLIC_API_BODY = 16 * 1024

// The auth='public' routes outside the public namespace: login-page branding, the second step of a
// sign-in (which needs the pre-login session cookie) and the inbox provider webhooks (WhatsApp and TikTok sign
// every POST with HMAC; Odoo verifies it). Everything under the public namespace is public too, without cookies;
// everything else requires a session cookie.
export const PUBLIC_API_METHODS = new Map<string, readonly string[]>([
  ['/api/v1/branding', ['GET', 'HEAD']],
  ['/api/v1/auth/channels', ['GET']],
  ['/api/v1/auth/code', ['POST']],
  ['/api/v1/auth/verify', ['POST']],
  ['/api/v1/auth/device', ['POST']],
  ['/api/v1/inbox/hooks/whatsapp', ['GET', 'POST']],
  ['/api/v1/inbox/hooks/tiktok', ['POST']],
])
export const PUBLIC_BODY_LIMITS = new Map<string, number>([
  ['/api/v1/auth/channels', MAX_PUBLIC_MFA_BODY],
  ['/api/v1/auth/code', MAX_PUBLIC_MFA_BODY],
  ['/api/v1/auth/verify', MAX_PUBLIC_MFA_BODY],
  ['/api/v1/auth/device', MAX_PUBLIC_MFA_BODY],
  ['/api/v1/inbox/hooks/whatsapp', MAX_PUBLIC_HOOK_BODY],
  ['/api/v1/inbox/hooks/tiktok', MAX_PUBLIC_HOOK_BODY],
])

export function isPublicApiPath(apiPath: string): boolean {
  return apiPath.startsWith(PUBLIC_API_NAMESPACE)
}

/** Whether a public path is one of the invited requester's booking-link routes, which draw on the `booking` pool. */
export function isBookingApiPath(apiPath: string): boolean {
  return apiPath.startsWith(BOOKING_API_PREFIX)
}

/** Forward one public request to Odoo with no cookie either way. `path` is canonical and may carry a query. */
export async function forwardPublicApi(event: H3Event, odooUrl: string, path: string, options: { method: string; body?: Buffer }): Promise<Response> {
  const response = Object.keys(tenantUpstreamHeaders(event)).length
    ? await tenantTransport(event, odooUrl, path, { method: options.method, body: options.body, headers: { cookie: '' } })
    : await legacyTenantResponse(event, odooUrl, path, { method: options.method, body: options.body, headers: withUiLocale(event, withoutCookie(getProxyRequestHeaders(event, { host: false }))) })
  response.headers.delete('set-cookie')
  return response
}

function withoutCookie(headers: Record<string, string | undefined>): Record<string, string> {
  const kept: Record<string, string> = {}
  for (const [name, value] of Object.entries(headers)) if (value !== undefined && name.toLowerCase() !== 'cookie') kept[name] = value
  return kept
}
