// Exact host resolution shared by the request boundary and registry validation.
// Registry authority is server-side only; never construct targets from a request.
export type TenantHostTarget = {
  host: string
  tenantId: string
  database: string
  filestore: string
  enabled: boolean
  registryRevision: number
}

export type ResolvedTenantHost = Pick<TenantHostTarget, 'tenantId' | 'database' | 'filestore' | 'registryRevision'>

const hostPattern = /^(?=.{1,253}$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/
const tenantPattern = /^[a-z][a-z0-9_-]{0,62}$/
const resourcePattern = /^[a-z][a-z0-9_]{0,62}$/

function canonicalHost(value: unknown): string {
  if (typeof value !== 'string' || !/^[\x00-\x7F]*$/.test(value)) throw new Error('tenant_host_unavailable')
  const name = value.toLowerCase()
  if (hostPattern.exec(name)?.[0] !== name) throw new Error('tenant_host_unavailable')
  return name
}

/** Resolve a trusted, already-sanitized request Host against a complete registry snapshot. */
export function resolveTenantHost(host: unknown, targets: readonly TenantHostTarget[]): ResolvedTenantHost {
  const requested = canonicalHost(host)
  const hosts = new Set<string>()
  const tenants = new Set<string>()
  const databases = new Set<string>()
  const filestores = new Set<string>()
  let selected: TenantHostTarget | undefined
  if (!Array.isArray(targets) || targets.length === 0) throw new Error('tenant_host_unavailable')
  for (const target of targets) {
    if (!target || typeof target !== 'object' || typeof target.enabled !== 'boolean' || !Number.isSafeInteger(target.registryRevision) || target.registryRevision < 1 ||
        typeof target.tenantId !== 'string' || typeof target.database !== 'string' || typeof target.filestore !== 'string' ||
        !tenantPattern.test(target.tenantId) || !resourcePattern.test(target.database) || !resourcePattern.test(target.filestore)) throw new Error('tenant_registry_invalid')
    const name = canonicalHost(target.host)
    if (hosts.has(name) || tenants.has(target.tenantId) || databases.has(target.database) || filestores.has(target.filestore)) throw new Error('tenant_registry_invalid')
    hosts.add(name)
    tenants.add(target.tenantId)
    databases.add(target.database)
    filestores.add(target.filestore)
    if (name === requested) selected = target
  }
  if (!selected?.enabled) throw new Error('tenant_host_unavailable')
  return { tenantId: selected.tenantId, database: selected.database, filestore: selected.filestore, registryRevision: selected.registryRevision }
}
