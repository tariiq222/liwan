import type { Pool } from 'pg'
import { SERVICE_COMPONENTS, serviceHealthSchema, type ServiceComponent, type ServiceHealthItem } from '@liwan/commercial-contracts'
import { logCode, logText } from './log-text.js'

// What is reported and when it is called stale lives in the migration's `service_health_states` function, the one place the thresholds are
// written: the host alert timer reads the same function, so the console and the alert cannot disagree.

/** How often the shared worker's own timer writes its beat, and the most often the scheduler writes its. The shortest stale limit is four times this. */
export const HEARTBEAT_INTERVAL_MS = 30_000

type Writer = Pick<Pool, 'query'>
type Log = (message: string, error?: unknown) => void
const defaultLog: Log = (message, error) => console.error('[service-health] %s %s', logText(message), logText(error ?? ''))

export type BeatComponent = 'shared_worker' | 'commercial_scheduler'
export type AvailabilityComponent = Exclude<ServiceComponent, BeatComponent>

const UPSERT = `INSERT INTO service_heartbeats(component,beat_at,started_at,detail) VALUES($1,$2,$3,$4::jsonb)
  ON CONFLICT (component) DO UPDATE SET beat_at=EXCLUDED.beat_at, started_at=EXCLUDED.started_at, detail=EXCLUDED.detail`

async function write(pool: Writer, component: ServiceComponent, input: { startedAt: Date; now?: Date; detail: Record<string, unknown>; log?: Log }) {
  const log = input.log ?? defaultLog
  try { await pool.query(UPSERT, [component, input.now ?? new Date(), input.startedAt, JSON.stringify(input.detail)]) }
  // A heartbeat is never worth stopping a tick or the worker for: the reader sees the gap as staleness.
  catch (error) { try { log(`service heartbeat ${component} not written`, error) } catch { /* never throw */ } }
}

/** One beat of a process: `startedAt` is when it started, `detail` holds fixed codes and counters only. Never throws. */
export function beat(pool: Writer, component: BeatComponent, input: { startedAt: Date; now?: Date; detail?: Record<string, unknown>; log?: Log }) {
  return write(pool, component, { ...input, detail: input.detail ?? {} })
}

/** Whether an adapter could be built. A failure is recorded as its code (or class name), never its message: a message may carry a URL or a secret. Never throws. */
export function recordAvailability(pool: Writer, component: AvailabilityComponent, input: { startedAt: Date; now?: Date; error?: unknown; log?: Log }) {
  const detail = input.error === undefined ? { available: true } : { available: false, code: logCode(input.error) }
  return write(pool, component, { startedAt: input.startedAt, now: input.now, detail, log: input.log })
}

/** The shared worker's own beat: one at start and one every `intervalMs`, from a timer that does not depend on the job loop (a long backup or restore holds the loop, not the timer).
 * The timer does not keep the process alive and ends with the shutdown signal. A write still running when the next one is due is not repeated. */
export function startWorkerHeartbeat(pool: Writer, input: { startedAt: Date; signal: AbortSignal; intervalMs?: number; log?: Log }): void {
  if (input.signal.aborted) return
  let writing = false
  const tick = () => {
    if (writing) return
    writing = true
    void beat(pool, 'shared_worker', { startedAt: input.startedAt, log: input.log }).finally(() => { writing = false })
  }
  tick()
  const timer = setInterval(tick, input.intervalMs ?? HEARTBEAT_INTERVAL_MS)
  timer.unref()
  input.signal.addEventListener('abort', () => clearInterval(timer), { once: true })
}

const SELECT = `SELECT component, state,
  to_char(since AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"') AS since,
  to_char(last_beat_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"') AS last_beat_at, detail, down
  FROM service_health_states($1)`

/** Every component's state at `now`. `detail` (the reasons) is returned only when `includeDetail`. Throws when the table cannot be read. */
export async function readHealth(pool: Writer, input: { now?: Date; includeDetail: boolean }): Promise<ServiceHealthItem[]> {
  const rows = (await pool.query(SELECT, [input.now ?? new Date()])).rows
  const items = rows.map(({ down: _down, ...row }) => ({ ...row, detail: input.includeDetail && row.state !== 'never_seen' ? row.detail : null }))
  return serviceHealthSchema.parse(items.sort((a, b) => SERVICE_COMPONENTS.indexOf(a.component) - SERVICE_COMPONENTS.indexOf(b.component)))
}

/** The components that need attention now (stale, or unavailable): an adapter of the worker is left out while the worker itself is down. Throws when the table cannot be read. */
export async function downComponents(pool: Writer, now: Date = new Date()): Promise<Array<{ component: ServiceComponent; state: 'stale' | 'unavailable'; since: string; last_beat_at: string }>> {
  const rows = (await pool.query(`${SELECT} WHERE down`, [now])).rows
  return rows.sort((a, b) => SERVICE_COMPONENTS.indexOf(a.component) - SERVICE_COMPONENTS.indexOf(b.component))
}
