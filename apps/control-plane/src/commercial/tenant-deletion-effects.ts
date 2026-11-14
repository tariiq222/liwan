import type { EffectPlan } from './tenant-deletion-plan.js'

/** The stages of `tools/shared_saas_lifecycle/tenant_drop_effect.py`. */
export type DropStage = 'verify' | 'stamp_marker' | 'drop_database' | 'remove_filestore' | 'remove_restore_copies' | 'purge_local_backups' | 'remove_side_files'
/** Called before every permit and on a heartbeat: throws when the runner no longer owns the request (lease or fence lost, withdrawn, authority gone). */
export type AssertOwned = () => Promise<void>

/**
 * What the runner may ask the outside world to do. The real implementation (`shared/tenant-deletion-effects-runner.ts`) spawns the Python effects under the
 * permit and heartbeat protocol; tests inject a fake. Every method is idempotent by observation and returns names and counts only, never a secret.
 */
export interface DeletionEffects {
  stage(input: { stage: DropStage; plan: EffectPlan; planDigest: string; dryRun: boolean; assertOwned: AssertOwned }): Promise<Record<string, unknown>>
  /** Deletes every off-site object of the tenant and verifies the prefix is empty; throws `offsite_not_empty` otherwise. */
  purgeOffsite(input: { tenantId: string; settleSeconds: number; assertOwned: AssertOwned }): Promise<Record<string, unknown>>
  /** Removes the tenant's bindings from the shared relay. `not_configured` when the control plane has no relay address and token. */
  unbindRelay(input: { tenantId: string; assertOwned: AssertOwned }): Promise<{ state: 'not_configured' | 'unbound' | 'absent' }>
  /** Removes the control plane's own backup artifacts of this tenant: each item is a backup id and the path its row holds, which must resolve strictly under the backup root as `<id>` or `<id>.json`. */
  removeBackupArtifacts(items: { id: string; path: string }[]): Promise<{ removed: number }>
}
