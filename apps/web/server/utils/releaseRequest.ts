import { createError, getHeader, type H3Event } from 'h3'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { readReleaseRoute, readReleasePools, selectReleaseRoute, withReleaseLease, isReleaseContinuation, type ReleasePin } from './releaseRouting'

/** Called only after tenantRequest has proved the shared boundary. Dedicated uses operator binding. */
export function installReleaseContext(event: H3Event): void {
  const root = process.env.WEBVUE_RELEASE_ROUTES_DIR
  if (!root) return
  try {
    const mode = process.env.WEBVUE_TENANCY_MODE ?? 'dedicated'
    const shared = event.context.tenant as { tenantId: string; registryRevision: number } | null
    const tenant = mode === 'shared' ? shared : { tenantId: process.env.WEBVUE_RELEASE_TENANT_ID!, registryRevision: Number(process.env.WEBVUE_RELEASE_IDENTITY_REVISION) }
    if (!tenant) throw Error('tenant_boundary_rejected')
    const parentAdmission = getHeader(event, 'x-webvue-release-admission')
    const incoming = { poolId: getHeader(event, 'x-webvue-release-pool') ?? '', routeRevision: Number(getHeader(event, 'x-webvue-release-revision')), fence: Number(getHeader(event, 'x-webvue-release-fence')) }
    const continuation = isReleaseContinuation(root,tenant.tenantId,incoming,parentAdmission)
    const route = readReleaseRoute(root, tenant.tenantId, continuation)
    let pin: ReleasePin
    if (mode === 'shared') {
      pin = { poolId: getHeader(event, 'x-webvue-release-pool') ?? '', routeRevision: Number(getHeader(event, 'x-webvue-release-revision')), fence: Number(getHeader(event, 'x-webvue-release-fence')) }
    } else {
      if (getHeader(event, 'host') !== process.env.WEBVUE_RELEASE_TENANT_HOST) throw Error('tenant_boundary_rejected')
      const poolId = process.env.WEBVUE_RELEASE_POOL_ID
      const admitted = [route, ...(route.draining ?? [])].find(item => item.poolId === poolId)
      if (!admitted) throw Error('release_pin_rejected')
      pin = { poolId: admitted.poolId, routeRevision: admitted.routeRevision, fence: admitted.fence }
    }
    const release = selectReleaseRoute(tenant, route, readReleasePools(root), pin)
    if (existsSync(join(root, `${tenant.tenantId}.${release.poolId}.${release.routeRevision}.retired`)) && !continuation) throw Error('release_generation_retired')
    release.admissionId = parentAdmission
    release.aiMaintenance = existsSync(join(root, 'ai.maintenance'))
    event.context.webvueRelease = release
    event.context.webvueReleaseWritePermit = <T>(action: () => Promise<T>) => withReleaseLease(root, tenant, pin, action, parentAdmission)
  } catch (error) {
    throw createError({ statusCode: 503, data: { code: error instanceof Error && error.message === 'tenant_maintenance' ? 'tenant_maintenance' : 'release_unavailable', message: 'The tenant is temporarily unavailable for a verified update.' } })
  }
}
