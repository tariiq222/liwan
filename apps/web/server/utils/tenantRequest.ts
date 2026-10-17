import { currentReleaseWrite } from './releaseRouting'
import { timingSafeEqual } from 'node:crypto'
import { isIP } from 'node:net'
import { createError, getHeader, type H3Event } from 'h3'
import { readTenantRegistry } from './tenantRegistry'
import { resolveTenantHost } from './tenantHostResolver'

export function tenantRequest(event: H3Event) {
  const mode = process.env.WEBVUE_TENANCY_MODE ?? 'dedicated'
  if (mode === 'dedicated') {
    if (process.env.WEBVUE_RELEASE_ROUTES_DIR) {
      const token = process.env.WEBVUE_DEDICATED_PROXY_TOKEN ?? ''
      const supplied = getHeader(event, 'x-webvue-proxy-token') ?? ''
      if (token.length < 32 || Buffer.byteLength(token) !== Buffer.byteLength(supplied) || !timingSafeEqual(Buffer.from(token), Buffer.from(supplied)) ||
          getHeader(event, 'host') !== process.env.WEBVUE_RELEASE_TENANT_HOST ||
          getHeader(event, 'x-webvue-tenant-revision') !== process.env.WEBVUE_RELEASE_IDENTITY_REVISION) {
        throw createError({ statusCode: 403, message: 'tenant_boundary_rejected' })
      }
    }
    return null
  }
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
  const release = event.context?.webvueRelease
  if (!tenant && !process.env.WEBVUE_RELEASE_ROUTES_DIR) return {}
  if (process.env.WEBVUE_RELEASE_ROUTES_DIR && !release) throw createError({ statusCode: 503, message: 'release_context_missing' })
  const host = tenant?.host ?? process.env.WEBVUE_RELEASE_TENANT_HOST
  const token = tenant ? process.env.WEBVUE_SHARED_PROXY_TOKEN : process.env.WEBVUE_DEDICATED_PROXY_TOKEN
  const revision = tenant?.registryRevision ?? Number(process.env.WEBVUE_RELEASE_IDENTITY_REVISION)
  if (!host || !token || token.length < 32 || !Number.isSafeInteger(revision)) throw createError({ statusCode: 503, message: 'release_boundary_missing' })
  const headers: Record<string, string> = { host, 'x-webvue-proxy-token': token, 'x-webvue-tenant-revision': String(revision) }
  if (!tenant) {
    const clientIp = getHeader(event, 'x-webvue-client-ip')
    const clientHost = getHeader(event, 'x-webvue-client-host')
    const clientProto = getHeader(event, 'x-webvue-client-proto')
    if (!clientIp || !isIP(clientIp) || clientHost !== host || !['http', 'https'].includes(clientProto ?? '')) {
      throw createError({ statusCode: 503, message: 'release_client_identity_missing' })
    }
    headers['x-webvue-client-ip'] = clientIp
    headers['x-webvue-client-host'] = clientHost
    headers['x-webvue-client-proto'] = clientProto!
  }
  if (release) {
    headers['x-webvue-release-pool'] = release.poolId
    headers['x-webvue-release-revision'] = String(release.routeRevision)
    headers['x-webvue-release-fence'] = String(release.fence)
    const writing = currentReleaseWrite()
    if (writing && (writing.tenantId !== release.tenantId || writing.poolId !== release.poolId || writing.fence !== release.fence)) throw createError({ statusCode: 503, message: 'release_write_context_mismatch' })
    const admission = writing?.admissionId ?? release.admissionId
    if (admission) headers['x-webvue-release-admission'] = admission
  }
  return headers
}
