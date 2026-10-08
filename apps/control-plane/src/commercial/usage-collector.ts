import type { Pool } from 'pg'
import { recordUsage } from './usage.js'

export type UsageObservation = { database: string; observed_at: string; usage: Record<string, number>; limit_gates: Record<string, string[]> }
export type UsageObserveRunner = (input: { tenant_id: string; database: string }) => Promise<UsageObservation>

const LIMIT_KEY = /^(?:[a-z][a-z0-9_]*\.)+[a-z][a-z0-9_]*$/
const FRESH_MS = 15 * 60 * 1000
const SKEW_MS = 5 * 60 * 1000
const PER_TENANT_MS = 30_000
const DEFAULT_LIMIT = 50

/** The observation, when it is fresh usage of DATABASE keyed by limit keys with a gate list for every metric; otherwise null. */
export function acceptObservation(observed: unknown, database: string, now: Date): UsageObservation | null {
  if (!observed || typeof observed !== 'object') return null
  const value = observed as Record<string, unknown>
  if (value.database !== database || typeof value.observed_at !== 'string') return null
  const at = Date.parse(value.observed_at)
  if (!Number.isFinite(at) || at > now.getTime() + SKEW_MS || now.getTime() - at > FRESH_MS) return null
  const usage = value.usage
  if (!usage || typeof usage !== 'object' || Array.isArray(usage)) return null
  const entries = Object.entries(usage as Record<string, unknown>)
  if (!entries.length || entries.length > 256) return null
  if (!entries.every(([key, n]) => LIMIT_KEY.test(key) && typeof n === 'number' && Number.isSafeInteger(n) && n >= 0)) return null
  const gates = value.limit_gates
  if (!gates || typeof gates !== 'object' || Array.isArray(gates)) return null
  const gateEntries = Object.entries(gates as Record<string, unknown>)
  // Gates must cover exactly the observed metrics; a partial sample would make the downgrade check misjudge a reopen.
  if (gateEntries.length !== entries.length || !entries.every(([key]) => Object.hasOwn(gates, key))) return null
  if (!gateEntries.every(([, list]) => Array.isArray(list) && list.length <= 64 && list.every(g => typeof g === 'string' && LIMIT_KEY.test(g)))) return null
  return {
    database, observed_at: value.observed_at,
    usage: Object.fromEntries(entries) as Record<string, number>,
    limit_gates: Object.fromEntries(gateEntries.map(([key, list]) => [key, [...(list as string[])]])),
  }
}

const withTimeout = <T>(work: Promise<T>, ms: number): Promise<T> => {
  let timer: NodeJS.Timeout
  const timeout = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(Error('observe_timeout')), ms) })
  return Promise.race([work, timeout]).finally(() => clearTimeout(timer))
}

/** Persist Odoo's observed usage for enabled shared tenants with an applied subscription, oldest sample first,
 * at most LIMIT tenants per run (each bounded in time) so the scheduler tick is never held for long.
 * Nothing is recorded unless the observation names the bound database, is fresh, complete, and the
 * binding is unchanged after the observation; a rejected sample leaves the previous snapshot untouched.
 * One tenant's failure never stops the others. */
export async function collectUsage(pool: Pool, input: { runner: UsageObserveRunner; now?: () => Date; log?: (message: string) => void; limit?: number; timeout_ms?: number }) {
  const now = input.now ?? (() => new Date())
  const log = input.log ?? ((message: string) => console.error(`[usage-collector] ${message}`))
  const targets = (await pool.query(`SELECT s.tenant_id, b.database_name, b.registry_revision FROM subscriptions s
    JOIN shared_registry_bindings b ON b.control_tenant_id=s.tenant_id AND b.enabled=true
    LEFT JOIN LATERAL (SELECT max(observed_at) AS at FROM usage_snapshots u WHERE u.tenant_id=s.tenant_id) last ON true
    WHERE s.applied_revision_id IS NOT NULL ORDER BY last.at ASC NULLS FIRST, s.tenant_id LIMIT $1`, [input.limit ?? DEFAULT_LIMIT])).rows as Array<{ tenant_id: string; database_name: string; registry_revision: string }>
  const result = { recorded: 0, skipped: 0 }
  for (const target of targets) {
    try {
      const raw = await withTimeout(input.runner({ tenant_id: target.tenant_id, database: target.database_name }), input.timeout_ms ?? PER_TENANT_MS)
      const observed = acceptObservation(raw, target.database_name, now())
      if (!observed) { result.skipped++; continue }
      const still = await pool.query('SELECT 1 FROM shared_registry_bindings WHERE control_tenant_id=$1 AND enabled=true AND database_name=$2 AND registry_revision=$3',
        [target.tenant_id, target.database_name, target.registry_revision])
      if (!still.rowCount) { result.skipped++; continue }
      await recordUsage(pool, { tenant_id: target.tenant_id, observed_at: new Date(observed.observed_at), metrics: observed.usage, limit_gates: observed.limit_gates, source: 'odoo.observe' })
      result.recorded++
    } catch (error) {
      result.skipped++
      log(`tenant ${target.tenant_id}: ${error instanceof Error ? error.message : 'observe_failed'}`)
    }
  }
  return result
}
