import { tenantRequest } from './tenantRequest'
import { tenantTransport } from './tenantTransport'
import type { H3Event } from 'h3'
import { MeSchema } from '@nasq/contracts'
import { signVendorForward } from './vendor-signature'

type VendorRuntimeConfig = {
  vendorWorkspaceEnabled?: boolean | string
  vendorControlUrl?: string
  vendorServiceKey?: string
  vendorInstallationId?: string
  vendorPublicOrigin?: string
  odooUrl?: string
}

function fail(statusCode: number, code: string, message: string): never {
  throw createError({ statusCode, data: { code, message } })
}

export function vendorEnabled(config: VendorRuntimeConfig): boolean {
  return config.vendorWorkspaceEnabled === true || config.vendorWorkspaceEnabled === 'true'
}

export function vendorControlBase(config: VendorRuntimeConfig): URL {
  if (!config.vendorControlUrl) fail(503, 'vendor_unavailable', 'Vendor service is not configured')
  let url: URL
  try { url = new URL(config.vendorControlUrl) } catch { return fail(503, 'vendor_unavailable', 'Vendor service is not configured') }
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) fail(503, 'vendor_unavailable', 'Vendor service requires a secure connection')
  if (url.username || url.password) fail(503, 'vendor_unavailable', 'Vendor service configuration is invalid')
  return url
}

export function assertVendorMutationOrigin(event: H3Event, config: VendorRuntimeConfig): void {
  const contentType = getHeader(event, 'content-type')?.split(';', 1)[0]?.trim().toLowerCase()
  if (contentType !== 'application/json') fail(415, 'unsupported_media_type', 'JSON requests are required')
  const site = getHeader(event, 'sec-fetch-site')
  if (site && site !== 'same-origin' && site !== 'none') fail(403, 'cross_site_request', 'Cross-site request rejected')
  let expected: URL
  try { expected = new URL(config.vendorPublicOrigin ?? '') } catch { return fail(503, 'vendor_unavailable', 'Vendor origin is not configured') }
  if (!['http:', 'https:'].includes(expected.protocol) || expected.origin !== config.vendorPublicOrigin) fail(503, 'vendor_unavailable', 'Vendor origin is not configured')
  const origin = getHeader(event, 'origin')
  if (!origin || origin !== expected.origin) fail(403, 'cross_site_request', 'Request origin rejected')
}

export async function vendorActor(event: H3Event, config: VendorRuntimeConfig) {
  const cookie = getHeader(event, 'cookie')
  if (!cookie) fail(401, 'unauthorized', 'A signed-in company session is required')
  let me: unknown
  try {
    if (tenantRequest(event)) {
      const response = await tenantTransport(event, config.odooUrl ?? '', '/api/v1/me')
      if (!response.ok) throw new Error('tenant_actor_unavailable')
      me = await response.json()
    } else me = await $fetch(`${config.odooUrl}/api/v1/me`, { headers: { cookie }, redirect: 'error', signal: AbortSignal.timeout(5000) })
  } catch {
    fail(401, 'unauthorized', 'The company session is not valid')
  }
  const parsed = MeSchema.safeParse(me)
  if (!parsed.success) fail(401, 'unauthorized', 'The company session is not valid')
  const issuer = config.vendorInstallationId
  if (!issuer) fail(503, 'vendor_unavailable', 'Vendor service is not configured')
  return { id: parsed.data.id, issuer }
}

export async function forwardVendorRequest(event: H3Event): Promise<unknown> {
  const config = useRuntimeConfig(event) as VendorRuntimeConfig & { odooUrl: string }
  if (!vendorEnabled(config)) fail(404, 'not_found', 'Not found')
  const method = getMethod(event).toUpperCase()
  if (!['GET', 'POST', 'PATCH', 'DELETE'].includes(method)) fail(405, 'method_not_allowed', 'Method not allowed')
  const isMutation = !['GET', 'HEAD', 'OPTIONS'].includes(method)
  if (isMutation) assertVendorMutationOrigin(event, config)
  if (!config.vendorServiceKey || config.vendorServiceKey.length < 32 || !config.vendorInstallationId) fail(503, 'vendor_unavailable', 'Vendor service is not configured')

  const actor = await vendorActor(event, config)
  const incoming = getRequestURL(event)
  const suffix = incoming.pathname.replace(/^\/api\/vendor/, '')
  const upstream = vendorControlBase(config)
  const target = new URL(suffix + incoming.search, upstream)
  const declaredLength = Number(getHeader(event, 'content-length') ?? 0)
  if (declaredLength > 1024 * 1024) fail(413, 'payload_too_large', 'Request body is too large')
  const rawBody = isMutation ? await readRawBody(event, 'utf8') : undefined
  if (isMutation && (!rawBody || Buffer.byteLength(rawBody) > 1024 * 1024)) fail(rawBody ? 413 : 400, rawBody ? 'payload_too_large' : 'invalid_json', rawBody ? 'Request body is too large' : 'A JSON object body is required')
  let body: unknown
  if (rawBody !== undefined) {
    try { body = JSON.parse(rawBody) } catch { fail(400, 'invalid_json', 'A valid JSON object body is required') }
    if (body === null || typeof body !== 'object' || Array.isArray(body)) fail(400, 'invalid_json', 'A JSON object body is required')
  }
  const issuer = config.vendorInstallationId
  const signed = signVendorForward({ method, path: `${target.pathname}${target.search}`, rawBody, actor: actor.id, issuer, key: config.vendorServiceKey })
  const headers = { ...signed, 'content-type': 'application/json', accept: 'application/json' }
  try {
    const response = await $fetch.raw(target.toString(), { method: method as any, body: rawBody, headers, redirect: 'error', signal: AbortSignal.timeout(10000) })
    setResponseStatus(event, response.status)
    return response._data
  } catch (cause: any) {
    const status = Number(cause?.statusCode ?? cause?.response?.status)
    if (status >= 400 && status < 500) throw createError({ statusCode: status, data: cause.data ?? { code: 'vendor_request_failed', message: 'Vendor request failed' } })
    fail(503, 'vendor_unavailable', 'Vendor service is temporarily unavailable')
  }
}
