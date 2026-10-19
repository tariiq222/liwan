import type { Pool } from 'pg'
import { recordUsage } from './usage.js'

export type UsageObservation = { database: string; observed_at: string; usage: Record<string, number>; limit_gates: Record<string, string[]> }
/** The runner must stop its work when SIGNAL aborts; its raw result is validated by acceptObservation. */
export type UsageObserveRunner = (input: { tenant_id: string; database: string; signal?: AbortSignal }) => Promise<unknown>

const LIMIT_KEY = /^(?:[a-z][a-z0-9_]*\.)+[a-z][a-z0-9_]*$/
export const FRESH_MS = 15 * 60 * 1000
const SKEW_MS = 5 * 60 * 1000
export const PER_TENANT_MS = 30_000
const DEFAULT_LIMIT = 50
/** Fallback per-run budget: 80% of the default 300 s scheduler interval (the scheduler passes 80% of the real interval). */
export const BUDGET_MS = 240_000
// Two-int advisory lock: a different key space from every single-bigint lock in the control plane
// (1397969233 migrate, REGISTRY_ADVISORY_LOCK 1397969234, hashtext(...) worker locks), so it can never collide with them.
export const USAGE_LOCK_CLASS = 1397969235
export const USAGE_LOCK_OBJECT = 1
// Same set as the Python validate_observation: a sample without these is partial.
const REQUIRED = ['users.limit', 'storage.limit_mb', 'branches.extra_limit']
const LIVE_STATES = ['trialing', 'active', 'past_due']

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
  if (entries.length > 256 || !REQUIRED.every(key => Object.hasOwn(usage, key))) return null
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

/** Runs WORK with an AbortSignal that aborts after MS; the rejection says observe_timeout. */
async function withDeadline<T>(work: (signal: AbortSignal) => Promise<T>, ms: number, stop?: AbortSignal): Promise<T> {
  const controller = new AbortController()
  let timer: NodeJS.Timeout | undefined
  let onStop: () => void = () => {}
  const stopped = new Promise<never>((_, reject) => { onStop = () => { controller.abort(); reject(Error('observe_aborted')) } })
  stopped.catch(() => {})
  if (stop?.aborted) onStop(); else stop?.addEventListener('abort', onStop, { once: true })
  const timeout = new Promise<never>((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(Error('observe_timeout')) }, ms) })
  try { return await Promise.race([work(controller.signal), timeout, stopped]) } finally { clearTimeout(timer); stop?.removeEventListener('abort', onStop) }
}

/** Persist Odoo's observed usage for live shared tenants (trialing/active/past_due, operations enabled), the
 * least recently ATTEMPTED first, at most LIMIT tenants and BUDGET_MS per run (each observation bounded and
 * cancelled on timeout), so a run is short and a failing tenant cannot starve the others. Only one run
 * collects at a time across workers (advisory lock; a second caller returns { locked: true }).
 * Nothing is recorded unless the observation names the bound database, is fresh, complete, and the
 * binding is unchanged after the observation; a rejected sample leaves the previous snapshot untouched. */
export async function collectUsage(pool: Pool, input: { runner: UsageObserveRunner; now?: () => Date; clock?: () => number; log?: (message: string) => void; limit?: number; timeout_ms?: number; budget_ms?: number; signal?: AbortSignal; busy?: () => Promise<boolean> }) {
  const now = input.now ?? (() => new Date())
  const clock = input.clock ?? Date.now
  const log = input.log ?? ((message: string) => console.error(`[usage-collector] ${message}`))
  const result: { recorded: number; skipped: number; locked: boolean; busy?: boolean } = { recorded: 0, skipped: 0, locked: false }
  if (input.signal?.aborted) return result
  const lock = await pool.connect()
  let broken = false
  try {
    if (!(await lock.query('SELECT pg_try_advisory_lock($1,$2) AS ok', [USAGE_LOCK_CLASS, USAGE_LOCK_OBJECT])).rows[0].ok) return { ...result, locked: true }
    try {
      const targets = (await pool.query(`SELECT x.tenant_id, x.database_name, x.registry_revision FROM (
          SELECT DISTINCT ON (b.control_tenant_id) s.tenant_id, b.database_name, b.registry_revision
          FROM subscriptions s
          JOIN tenants t ON t.id=s.tenant_id AND t.operations_enabled=true
          JOIN shared_registry_bindings b ON b.control_tenant_id=s.tenant_id AND b.enabled=true
          WHERE s.applied_revision_id IS NOT NULL AND s.state = ANY($2::text[])
          ORDER BY b.control_tenant_id, s.id) x
        LEFT JOIN usage_collection_attempts a ON a.tenant_id=x.tenant_id
        ORDER BY a.attempted_at ASC NULLS FIRST, x.tenant_id LIMIT $1`, [input.limit ?? DEFAULT_LIMIT, LIVE_STATES])).rows as Array<{ tenant_id: string; database_name: string; registry_revision: string }>
      const deadline = clock() + (input.budget_ms ?? BUDGET_MS)
      for (const target of targets) {
        if (clock() >= deadline || input.signal?.aborted) break
        // A provision, backup or restore owns the shared runtime: an observation container would
        // collide with its writer check, so stop before this tenant (and retry soon). A check
        // that cannot be answered counts as busy.
        if (input.busy && await input.busy().catch(() => true)) { result.busy = true; break }
        try {
          // The attempt is recorded before observing, so a hang or failure still moves the tenant to the back.
          await pool.query('INSERT INTO usage_collection_attempts(tenant_id,attempted_at) VALUES($1,clock_timestamp()) ON CONFLICT (tenant_id) DO UPDATE SET attempted_at=excluded.attempted_at', [target.tenant_id])
          const raw = await withDeadline(signal => input.runner({ tenant_id: target.tenant_id, database: target.database_name, signal }),
            Math.max(1, Math.min(input.timeout_ms ?? PER_TENANT_MS, deadline - clock())), input.signal)
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
    } finally {
      // A failed unlock leaves the session lock on the connection: discard it instead of pooling it.
      try { await lock.query('SELECT pg_advisory_unlock($1,$2)', [USAGE_LOCK_CLASS, USAGE_LOCK_OBJECT]) } catch { broken = true }
    }
  } finally {
    lock.release(broken)
  }
}
