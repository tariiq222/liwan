import { currentReleaseWrite } from './releaseRouting'
import { timingSafeEqual } from 'node:crypto'
import { isIP } from 'node:net'
import { createError, getHeader, type H3Event } from 'h3'
import { readTenantRegistrySnapshot, type TenantRegistrySnapshot } from './tenantRegistry'
import { isRestoreHost, type TenantHostTarget } from './tenantHostResolver'

// Weak ownership bounds retention to live requests; no identity/registry TTL crosses calls.
const snapshots = new WeakMap<H3Event, { snapshot: TenantRegistrySnapshot; tenant: Readonly<TenantHostTarget> }>()

export function tenantRequest(event: H3Event) {
  const mode = process.env.LIWAN_TENANCY_MODE ?? 'dedicated'
  if (mode === 'dedicated') {
    if (process.env.LIWAN_RELEASE_ROUTES_DIR) {
      const token = process.env.LIWAN_DEDICATED_PROXY_TOKEN ?? ''
      const supplied = getHeader(event, 'x-liwan-proxy-token') ?? ''
      if (token.length < 32 || Buffer.byteLength(token) !== Buffer.byteLength(supplied) || !timingSafeEqual(Buffer.from(token), Buffer.from(supplied)) ||
          getHeader(event, 'host') !== process.env.LIWAN_RELEASE_TENANT_HOST ||
          getHeader(event, 'x-liwan-tenant-revision') !== process.env.LIWAN_RELEASE_IDENTITY_REVISION) {
        throw createError({ statusCode: 403, message: 'tenant_boundary_rejected' })
      }
    }
    return null
  }
  if (mode !== 'shared') throw createError({ statusCode: 503, message: 'invalid_tenancy_mode' })
  try {
    const token = process.env.LIWAN_SHARED_PROXY_TOKEN ?? ''
    const supplied = getHeader(event, 'x-liwan-proxy-token') ?? ''
    if (token.length < 32 || Buffer.byteLength(token) !== Buffer.byteLength(supplied) || !timingSafeEqual(Buffer.from(token), Buffer.from(supplied))) throw Error()
    const host = getHeader(event, 'host')
    const previous = snapshots.get(event)
    let snapshot = readTenantRegistrySnapshot(process.env.LIWAN_TENANT_REGISTRY_PATH ?? '', previous?.snapshot)
    const name = typeof host === 'string' && /^[\x00-\x7F]*$/.test(host) ? host.toLowerCase() : undefined
    let tenant = name ? snapshot.hosts[name] : undefined
    if (!tenant && name && isRestoreHost(name)) {
      // Restore hosts live in the control plane's separate restore registry, which only restore hosts consult. The
      // guard has already refused a restore registry that is broken or clashes with the tenant registry; a missing
      // path or file refuses here. That is a boundary refusal (403), never a tenant-registry outage: a restore host
      // is an optional surface and must not turn every tenant request into a 503.
      try { snapshot = readTenantRegistrySnapshot(process.env.LIWAN_RESTORE_REGISTRY_PATH ?? '', previous?.snapshot) }
      catch { throw new Error('restore_registry_unavailable') }
      tenant = snapshot.hosts[name]
    }
    if (!tenant?.enabled || getHeader(event, 'x-liwan-tenant-revision') !== String(tenant.registryRevision)) throw Error()
    // A request never changes its tenant binding, even if configuration is replaced
    // while it waits. A new request may adopt the new, fully published revision.
    if (previous && (previous.snapshot.path !== snapshot.path || Object.keys(previous.tenant).some(key => previous.tenant[key as keyof TenantHostTarget] !== tenant[key as keyof TenantHostTarget]))) throw Error()
    snapshots.set(event, { snapshot, tenant })
    return { tenantId: tenant.tenantId, database: tenant.database, filestore: tenant.filestore, registryRevision: tenant.registryRevision, host: host! }
  } catch (error) {
    // A registry that is not published (a `.pending` barrier, an unreadable or replaced file) is an
    // unavailable service, not a boundary refusal; the machine-readable code mirrors the guard body.
    if ((error as { code?: string })?.code === 'tenant_registry_unavailable') {
      throw createError({
        statusCode: 503,
        message: 'tenant_registry_unavailable',
        data: { code: 'tenant_registry_unavailable', message: 'The tenant registry is not currently published. The service is unavailable, not refusing this tenant.' },
      })
    }
    throw createError({ statusCode: 403, message: 'tenant_boundary_rejected' })
  }
}
export function tenantUpstreamHeaders(event: H3Event): Record<string, string> {
  const tenant = tenantRequest(event)
  const release = event.context?.liwanRelease
  if (!tenant && !process.env.LIWAN_RELEASE_ROUTES_DIR) return {}
  if (process.env.LIWAN_RELEASE_ROUTES_DIR && !release) throw createError({ statusCode: 503, message: 'release_context_missing' })
  const host = tenant?.host ?? process.env.LIWAN_RELEASE_TENANT_HOST
  const token = tenant ? process.env.LIWAN_SHARED_PROXY_TOKEN : process.env.LIWAN_DEDICATED_PROXY_TOKEN
  const revision = tenant?.registryRevision ?? Number(process.env.LIWAN_RELEASE_IDENTITY_REVISION)
  if (!host || !token || token.length < 32 || !Number.isSafeInteger(revision)) throw createError({ statusCode: 503, message: 'release_boundary_missing' })
  const headers: Record<string, string> = { host, 'x-liwan-proxy-token': token, 'x-liwan-tenant-revision': String(revision) }
  if (!tenant) {
    const clientIp = getHeader(event, 'x-liwan-client-ip')
    const clientHost = getHeader(event, 'x-liwan-client-host')
    const clientProto = getHeader(event, 'x-liwan-client-proto')
    if (!clientIp || !isIP(clientIp) || clientHost !== host || !['http', 'https'].includes(clientProto ?? '')) {
      throw createError({ statusCode: 503, message: 'release_client_identity_missing' })
    }
    headers['x-liwan-client-ip'] = clientIp
    headers['x-liwan-client-host'] = clientHost
    headers['x-liwan-client-proto'] = clientProto!
  }
  if (release) {
    headers['x-liwan-release-pool'] = release.poolId
    headers['x-liwan-release-revision'] = String(release.routeRevision)
    headers['x-liwan-release-fence'] = String(release.fence)
    const writing = currentReleaseWrite()
    if (writing && (writing.tenantId !== release.tenantId || writing.poolId !== release.poolId || writing.fence !== release.fence)) throw createError({ statusCode: 503, message: 'release_write_context_mismatch' })
    const admission = writing?.admissionId ?? release.admissionId
    if (admission) headers['x-liwan-release-admission'] = admission
  }
  return headers
}
