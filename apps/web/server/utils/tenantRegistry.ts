import { lstatSync, readFileSync, statSync } from 'node:fs'
import { resolveTenantHost, type TenantHostTarget } from './tenantHostResolver.ts'

export type TenantRegistry = { schemaVersion: 1; snapshotRevision: number; targets: TenantHostTarget[] }
export function validateRegistry(value: unknown): TenantRegistry {
  const r = value as TenantRegistry
  if (!r || r.schemaVersion !== 1 || !Number.isSafeInteger(r.snapshotRevision) || r.snapshotRevision < 0 || !Array.isArray(r.targets)) throw new Error('tenant_registry_invalid')
  // Revision 0 without targets is the control plane's deny-all bootstrap snapshot.
  if (!r.targets.length) {
    if (r.snapshotRevision !== 0) throw new Error('tenant_registry_invalid')
    return structuredClone(r)
  }
  if (r.snapshotRevision < 1) throw new Error('tenant_registry_invalid')
  // Reuse the existing resolver, including global uniqueness checks, even when all rows are disabled.
  resolveTenantHost(r.targets[0]?.host, r.targets.map(t => ({ ...t, enabled: true })))
  if (r.targets.some(t => typeof t.enabled !== 'boolean' || t.host !== t.host.toLowerCase() || t.database !== t.filestore)) throw new Error('tenant_registry_invalid')
  return structuredClone(r)
}
function requireCompletedPublication(path: string): void {
  try { lstatSync(`${path}.pending`) }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return
    throw new Error('tenant_registry_unavailable')
  }
  throw new Error('tenant_registry_unavailable')
}
export function readTenantRegistry(path: string): TenantRegistry {
  if (!path) throw new Error('tenant_registry_unavailable')
  // A durable writer creates this barrier before committing authority changes.
  // An interrupted publication must deny access, never fall back to an old enable.
  requireCompletedPublication(path)
  const registry = validateRegistry(JSON.parse(readFileSync(path, 'utf8')))
  requireCompletedPublication(path)
  // Standalone readers always observe current publication state.
  return registry
}
/** Immutable parsed/indexed snapshot shared by active requests. A fresh filesystem
 * identity check, never a TTL, decides whether it may be reused. */
export type TenantRegistrySnapshot = {
  readonly path: string
  readonly signature: string
  readonly hosts: Readonly<Record<string, Readonly<TenantHostTarget>>>
}
// One weak entry shares the current generation without retaining a full index
// once its request owners are collected. Older active requests may hold older
// generations, but they still verify publication before using their binding.
let sharedSnapshot: WeakRef<TenantRegistrySnapshot> | undefined

function publicationSignature(path: string): string {
  const stat = statSync(path, { bigint: true })
  if (!stat.isFile()) throw new Error('tenant_registry_unavailable')
  return [stat.dev, stat.ino, stat.size, stat.mtimeNs, stat.ctimeNs].join(':')
}
export function readTenantRegistrySnapshot(path: string, previous?: TenantRegistrySnapshot): TenantRegistrySnapshot {
  if (!path) throw new Error('tenant_registry_unavailable')
  requireCompletedPublication(path)
  const signature = publicationSignature(path)
  const retained = previous?.path === path && previous.signature === signature ? previous : sharedSnapshot?.deref()
  if (retained?.path === path && retained.signature === signature) {
    requireCompletedPublication(path)
    // A writer may have completed and removed its marker after the first stat.
    if (publicationSignature(path) !== signature) throw new Error('tenant_registry_unavailable')
    return retained
  }
  const registry = readTenantRegistry(path)
  // Detect replacement/in-place mutation during the read; do not bind an uncertain snapshot.
  if (publicationSignature(path) !== signature) throw new Error('tenant_registry_unavailable')
  requireCompletedPublication(path)
  const hosts: Record<string, Readonly<TenantHostTarget>> = Object.create(null)
  for (const target of registry.targets) hosts[target.host] = Object.freeze(target)
  const snapshot = Object.freeze({ path, signature, hosts: Object.freeze(hosts) })
  sharedSnapshot = new WeakRef(snapshot)
  return snapshot
}
export type RegistryAudit = { actor: string; action: 'create' | 'update' | 'disable'; tenantId: string; snapshotRevision: number; registryRevision: number }
/** Trusted control-plane primitive, NOT an HTTP API. Authorization and durable atomic
 * snapshot+audit publication belong to the control-plane writer. No deletion/rebind. */
export function mutateRegistry(current: TenantRegistry, target: TenantHostTarget, authority: { actor: string; canManageRegistry: boolean }, expectedSnapshotRevision: number): { registry: TenantRegistry; audit: RegistryAudit } {
  const old = validateRegistry(current)
  if (!authority.canManageRegistry || !authority.actor) throw new Error('registry_forbidden')
  if (old.snapshotRevision !== expectedSnapshotRevision) throw new Error('registry_revision_conflict')
  const previous = old.targets.find(t => t.tenantId === target.tenantId)
  if (previous && (previous.database !== target.database || previous.filestore !== target.filestore)) throw new Error('tenant_binding_immutable')
  if (target.registryRevision !== (previous?.registryRevision ?? 0) + 1) throw new Error('registry_revision_conflict')
  const registry = validateRegistry({ schemaVersion: 1, snapshotRevision: old.snapshotRevision + 1, targets: [...old.targets.filter(t => t.tenantId !== target.tenantId), target] })
  return { registry, audit: { actor: authority.actor, action: !previous ? 'create' : !target.enabled ? 'disable' : 'update', tenantId: target.tenantId, snapshotRevision: registry.snapshotRevision, registryRevision: target.registryRevision } }
}
