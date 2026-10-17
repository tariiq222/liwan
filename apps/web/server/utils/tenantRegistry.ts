import { lstatSync, readFileSync } from 'node:fs'
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
  // No process cache: each request/WS handshake observes current publication state.
  return registry
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
