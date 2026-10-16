import { timingSafeEqual } from 'node:crypto'
import { createError, getHeader, type H3Event } from 'h3'
import { readTenantRegistry } from './tenantRegistry'
import { resolveTenantHost } from './tenantHostResolver'

export function tenantRequest(event: H3Event) {
  const mode = process.env.WEBVUE_TENANCY_MODE ?? 'dedicated'
  if (mode === 'dedicated') return null
  if (mode !== 'shared') throw createError({ statusCode: 503, message: 'invalid_tenancy_mode' })
  try {
    const token = process.env.WEBVUE_SHARED_PROXY_TOKEN ?? ''
    const supplied = getHeader(event, 'x-webvue-proxy-token') ?? ''
    if (token.length < 32 || Buffer.byteLength(token) !== Buffer.byteLength(supplied) || !timingSafeEqual(Buffer.from(token), Buffer.from(supplied))) throw Error()
    const host = getHeader(event, 'host')
    const tenant = resolveTenantHost(host, readTenantRegistry(process.env.WEBVUE_TENANT_REGISTRY_PATH ?? '').targets)
    if (getHeader(event, 'x-webvue-tenant-revision') !== String(tenant.registryRevision)) throw Error()
    return { ...tenant, host: host! }
  } catch { throw createError({ statusCode: 403, message: 'tenant_boundary_rejected' }) }
}
export function tenantUpstreamHeaders(event: H3Event): Record<string, string> {
  const tenant = tenantRequest(event)
  return tenant ? { host: tenant.host, 'x-webvue-proxy-token': process.env.WEBVUE_SHARED_PROXY_TOKEN!, 'x-webvue-tenant-revision': String(tenant.registryRevision) } : {}
}
