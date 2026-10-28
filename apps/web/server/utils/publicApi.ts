import type { H3Event } from 'h3'
import { getProxyRequestHeaders } from 'h3'
import { legacyTenantResponse, tenantTransport } from './tenantTransport'
import { tenantUpstreamHeaders } from './tenantRequest'

/**
 * The one public namespace of the Odoo API: every route under it is `auth='public'`, answers
 * without a session and is reached by anonymous visitors (a payer, a booking guest). Nuxt forwards
 * it without the browser's cookies and drops any cookie Odoo would set, so a public request can
 * neither use nor create a session.
 */
export const PUBLIC_API_NAMESPACE = '/api/v1/public/'
export const PUBLIC_API_NAMESPACE_METHODS = ['GET', 'HEAD', 'POST'] as const
/** Public JSON bodies are small forms: a token and a few ids. */
export const MAX_PUBLIC_API_BODY = 16 * 1024

export function isPublicApiPath(apiPath: string): boolean {
  return apiPath.startsWith(PUBLIC_API_NAMESPACE)
}

/** Forward one public request to Odoo with no cookie either way. `path` is canonical and may carry a query. */
export async function forwardPublicApi(event: H3Event, odooUrl: string, path: string, options: { method: string; body?: Buffer }): Promise<Response> {
  const response = Object.keys(tenantUpstreamHeaders(event)).length
    ? await tenantTransport(event, odooUrl, path, { method: options.method, body: options.body, headers: { cookie: '' } })
    : await legacyTenantResponse(event, odooUrl, path, { method: options.method, body: options.body, headers: withoutCookie(getProxyRequestHeaders(event, { host: false })) })
  response.headers.delete('set-cookie')
  return response
}

function withoutCookie(headers: Record<string, string | undefined>): Record<string, string> {
  const kept: Record<string, string> = {}
  for (const [name, value] of Object.entries(headers)) if (value !== undefined && name.toLowerCase() !== 'cookie') kept[name] = value
  return kept
}
