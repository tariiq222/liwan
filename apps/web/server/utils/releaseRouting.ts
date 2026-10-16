import { closeSync, existsSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync, realpathSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { AsyncLocalStorage } from 'node:async_hooks'
import { randomUUID } from 'node:crypto'

export type ReleasePin = { poolId: string; routeRevision: number; fence: number }
export type ReleaseRoute = ReleasePin & { schemaVersion: 1; tenantId: string; identityRevision: number; releaseId: string; state: 'serving' | 'maintenance'; aiStateVersion?: string; draining?: (ReleasePin & { releaseId: string })[] }
export type ReleasePool = { poolId: string; releaseId: string; odooUrl: string; webUrl: string; wsUrl: string; aiUrl?: string; aiStateVersion?: string }
export type ReleaseContext = ReleasePin & ReleasePool & { tenantId: string; identityRevision: number; aiMaintenance: boolean; admissionId?: string }
const writeContext = new AsyncLocalStorage<ReleaseContext>()
export function currentReleaseWrite(): ReleaseContext | undefined { return writeContext.getStore() }
const id = /^[a-z][a-z0-9_-]{0,62}$/
const positive = (n: unknown): n is number => Number.isSafeInteger(n) && Number(n) > 0
const failure = (message = 'release_route_unavailable') => Object.assign(new Error(message), { statusCode: 503 })

function identifier(value: unknown): asserts value is string {
  if (typeof value !== 'string' || !id.test(value)) throw failure()
}
function directory(root: string): string {
  const path = resolve(root)
  if (!root || realpathSync(path) !== path || !lstatSync(path).isDirectory()) throw failure()
  return path
}
function regularJson(path: string): unknown {
  const info = lstatSync(path)
  if (!info.isFile() || info.isSymbolicLink() || info.size > 1024 * 1024) throw failure()
  return JSON.parse(readFileSync(path, 'utf8'))
}
function revision(value: unknown): asserts value is ReleasePin {
  const v = value as ReleasePin
  identifier(v?.poolId)
  if (!positive(v.routeRevision) || !positive(v.fence)) throw failure()
}
export function readReleaseRoute(root: string, tenantId: string, allowMaintenance = false): ReleaseRoute {
  identifier(tenantId)
  const path = directory(root)
  if (!allowMaintenance && existsSync(join(path, `${tenantId}.maintenance`))) throw failure('tenant_maintenance')
  const route = regularJson(join(path, `${tenantId}.json`)) as ReleaseRoute
  revision(route)
  identifier(route.releaseId)
  if (route.schemaVersion !== 1 || route.tenantId !== tenantId || !positive(route.identityRevision) || !['serving', 'maintenance'].includes(route.state)) throw failure()
  if (route.draining !== undefined && (!Array.isArray(route.draining) || route.draining.length > 8)) throw failure()
  for (const prior of route.draining ?? []) { revision(prior); identifier(prior.releaseId); if (prior.routeRevision >= route.routeRevision || prior.fence >= route.fence) throw failure() }
  if (!allowMaintenance && (route.state === 'maintenance' || existsSync(join(path, `${tenantId}.maintenance`)))) throw failure('tenant_maintenance')
  return route
}
export function readReleasePools(root: string): Record<string, ReleasePool> {
  const data = regularJson(join(directory(root), 'pools.json')) as { schemaVersion: number; pools: Record<string, ReleasePool> }
  if (data?.schemaVersion !== 1 || !data.pools || Array.isArray(data.pools)) throw failure()
  for (const [key, pool] of Object.entries(data.pools)) {
    identifier(key); identifier(pool?.poolId); identifier(pool?.releaseId)
    if (pool.poolId !== key) throw failure()
    for (const field of ['odooUrl', 'webUrl', 'wsUrl', ...(pool.aiUrl ? ['aiUrl'] : [])] as const) {
      const value = pool[field as keyof ReleasePool]
      const url = new URL(value ?? '')
      if (url.protocol !== 'http:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw failure('release_pool_invalid')
    }
    if (pool.aiUrl && (typeof pool.aiStateVersion !== 'string' || !pool.aiStateVersion)) throw failure('release_ai_version_invalid')
  }
  return data.pools
}
export function selectReleaseRoute(tenant: { tenantId: string; registryRevision: number }, route: ReleaseRoute, pools: Record<string, ReleasePool>, pin?: ReleasePin): ReleaseContext {
  if (route.tenantId !== tenant.tenantId || route.identityRevision !== tenant.registryRevision || route.state !== 'serving') throw failure()
  const matches = (r: ReleasePin) => pin && r.poolId === pin.poolId && r.routeRevision === pin.routeRevision && r.fence === pin.fence
  const selected = !pin || matches(route) ? route : route.draining?.find(matches)
  if (!selected || !Object.hasOwn(pools, selected.poolId)) throw failure('release_pin_rejected')
  const pool = pools[selected.poolId]!
  if (pool.releaseId !== selected.releaseId) throw failure('release_pool_mismatch')
  return { ...pool, tenantId: tenant.tenantId, identityRevision: tenant.registryRevision, poolId: selected.poolId, routeRevision: selected.routeRevision, fence: selected.fence, aiMaintenance: false }
}
function sync(path: string) {
  const descriptor = openSync(path, 'r')
  try { fsyncSync(descriptor) } finally { closeSync(descriptor) }
}
/** A continuation may only use the still-held lease of its authenticated parent request. */
export function isReleaseContinuation(root: string, tenantId: string, pin: ReleasePin, admission?: string): boolean {
  if (!admission || !/^[a-f0-9-]{36}$/.test(admission)) return false
  try {
    const held = regularJson(join(directory(root), 'leases', tenantId, `${admission}.json`)) as ReleasePin & { tenantId: string }
    return held.tenantId === tenantId && held.poolId === pin.poolId && held.routeRevision === pin.routeRevision && held.fence === pin.fence
  } catch { return false }
}
/** Admission is recorded before checking the barrier; a migration waits for all leases. */
export function createReleaseLease(root: string, tenant: { tenantId: string; registryRevision: number }, pin?: ReleasePin, operation = 'http', parentAdmission?: string) {
  identifier(tenant.tenantId)
  const path = directory(root)
  const leases = join(path, 'leases')
  if (!existsSync(leases)) mkdirSync(leases, { mode: 0o700 })
  if (realpathSync(leases) !== leases) throw failure()
  const tenantLeases = join(leases, tenant.tenantId)
  if (!existsSync(tenantLeases)) mkdirSync(tenantLeases, { mode: 0o700 })
  if (realpathSync(tenantLeases) !== tenantLeases) throw failure()
  const admissionId = randomUUID()
  const lease = join(tenantLeases, `${admissionId}.json`)
  const descriptor = openSync(lease, 'wx', 0o600)
  try { writeFileSync(descriptor, JSON.stringify({ tenantId: tenant.tenantId, pid: process.pid, operation, poolId: 'pending', routeRevision: 0, fence: 0 })); fsyncSync(descriptor) } finally { closeSync(descriptor) }
  sync(tenantLeases)
  let closed = false
  const release = () => { if (!closed) { closed = true; unlinkSync(lease); sync(tenantLeases) } }
  try {
    const continuation = () => Boolean(pin && isReleaseContinuation(path, tenant.tenantId, pin, parentAdmission))
    const route = readReleaseRoute(path, tenant.tenantId, continuation())
    const context = selectReleaseRoute(tenant, route, readReleasePools(path), pin)
    const retired = join(path, `${tenant.tenantId}.${context.poolId}.${context.routeRevision}.retired`)
    if (existsSync(retired) && !continuation()) throw failure('release_generation_retired')
    const update = `${lease}.tmp`
    const handle = openSync(update, 'wx', 0o600)
    try { writeFileSync(handle, JSON.stringify({ tenantId: tenant.tenantId, pid: process.pid, operation, poolId: context.poolId, routeRevision: context.routeRevision, fence: context.fence })); fsyncSync(handle) } finally { closeSync(handle) }
    renameSync(update, lease); sync(tenantLeases)
    // Recheck after durable admission: a concurrent barrier or retirement wins.
    selectReleaseRoute(tenant, readReleaseRoute(path, tenant.tenantId, continuation()), readReleasePools(path), context)
    if (existsSync(retired) && !continuation()) throw failure('release_generation_retired')
    context.aiMaintenance = existsSync(join(path, 'ai.maintenance'))
    context.admissionId = admissionId
    return { context, release }
  } catch (error) { release(); throw error }
}
export async function withReleaseLease<T>(root: string, tenant: { tenantId: string; registryRevision: number }, pin: ReleasePin, action: () => Promise<T>, parentAdmission?: string): Promise<T> {
  const lease = createReleaseLease(root, tenant, pin, 'write', parentAdmission)
  try { return await writeContext.run(lease.context, action) } finally { lease.release() }
}
