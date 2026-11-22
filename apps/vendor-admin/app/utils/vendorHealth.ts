import type { ServiceComponent, ServiceHealthItem, ServiceState } from '@liwan/commercial-contracts'
import type { StatusTone } from '@liwan/ui/app/utils/statusTone'

/** A state the page shows: the recorded one, or `unknown` for what a stopped worker last recorded about its own adapters. */
export type HealthDisplayState = ServiceState | 'unknown'
export type Elapsed = { unit: 'minutes' | 'hours' | 'days', count: number }
export type HealthChip = {
  component: ServiceComponent
  state: HealthDisplayState
  tone: Extract<StatusTone, 'success' | 'destructive' | 'neutral'>
  icon: `i-lucide-${string}`
  /** The time since the last beat, for a process that beats; null for an adapter. */
  lastBeat: Elapsed | null
  /** The reason code of an unavailable adapter, only when the server sent the detail. */
  code: string | null
  /** The jobs that failed in the scheduler's last tick, only when the server sent the detail. */
  failedJobs: string[]
}

const MINUTE_MS = 60_000
const HOUR_MS = 60 * MINUTE_MS
const DAY_MS = 24 * HOUR_MS
/** The components that report a beat; the others report only whether they could be built. */
const BEATING: readonly ServiceComponent[] = ['shared_worker', 'commercial_scheduler']
/** Built and recorded by the shared worker, so what they say is unknown while the worker is not running. */
const WORKER_ADAPTERS: readonly ServiceComponent[] = ['payment_adapter', 'mail_adapter', 'alert_channel']

/** Whole minutes, hours or days since `since`; never negative. */
export function elapsedSince(since: string, now: Date): Elapsed {
  const ms = Math.max(0, now.getTime() - Date.parse(since))
  if (ms >= DAY_MS) return { unit: 'days', count: Math.floor(ms / DAY_MS) }
  if (ms >= HOUR_MS) return { unit: 'hours', count: Math.floor(ms / HOUR_MS) }
  return { unit: 'minutes', count: Math.floor(ms / MINUTE_MS) }
}

const STYLE: Record<HealthDisplayState, Pick<HealthChip, 'tone' | 'icon'>> = {
  ok: { tone: 'success', icon: 'i-lucide-circle-check' },
  stale: { tone: 'destructive', icon: 'i-lucide-server-off' },
  unavailable: { tone: 'destructive', icon: 'i-lucide-plug-zap' },
  never_seen: { tone: 'neutral', icon: 'i-lucide-circle-dashed' },
  unknown: { tone: 'neutral', icon: 'i-lucide-circle-help' },
}

const text = (value: unknown) => typeof value === 'string' && value ? value : null
const names = (value: unknown) => Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : []

export function healthChips(items: readonly ServiceHealthItem[], now: Date): HealthChip[] {
  const workerStopped = items.find(i => i.component === 'shared_worker')?.state === 'stale'
  return items.map((item) => {
    const state: HealthDisplayState = workerStopped && WORKER_ADAPTERS.includes(item.component) && item.state !== 'never_seen' ? 'unknown' : item.state
    return {
      component: item.component, state, ...STYLE[state],
      lastBeat: BEATING.includes(item.component) && item.last_beat_at ? elapsedSince(item.last_beat_at, now) : null,
      code: text(item.detail?.code),
      failedJobs: names(item.detail?.failed_jobs),
    }
  })
}
