import { timingSafeEqual } from 'node:crypto'
import { createError, getHeader, type H3Event } from 'h3'
import { readTenantRegistry } from './tenantRegistry'
import { resolveTenantHost } from './tenantHostResolver'

export function tenantRequest(event: H3Event) {
  const mode = process.env.NASQ_TENANCY_MODE ?? 'dedicated'
  if (mode === 'dedicated') return null
  if (mode !== 'shared') throw createError({ statusCode: 503, message: 'invalid_tenancy_mode' })
  try {
    const token = process.env.NASQ_SHARED_PROXY_TOKEN ?? ''
    const supplied = getHeader(event, 'x-nasq-proxy-token') ?? ''
    if (token.length < 32 || Buffer.byteLength(token) !== Buffer.byteLength(supplied) || !timingSafeEqual(Buffer.from(token), Buffer.from(supplied))) throw Error()
    const host = getHeader(event, 'host')
    const tenant = resolveTenantHost(host, readTenantRegistry(process.env.NASQ_TENANT_REGISTRY_PATH ?? '').targets)
    if (getHeader(event, 'x-nasq-tenant-revision') !== String(tenant.registryRevision)) throw Error()
    return { ...tenant, host: host! }
  } catch { throw createError({ statusCode: 403, message: 'tenant_boundary_rejected' }) }
}
export function tenantUpstreamHeaders(event: H3Event): Record<string, string> {
  const tenant = tenantRequest(event)
  return tenant ? { host: tenant.host, 'x-nasq-proxy-token': process.env.NASQ_SHARED_PROXY_TOKEN!, 'x-nasq-tenant-revision': String(tenant.registryRevision) } : {}
}
