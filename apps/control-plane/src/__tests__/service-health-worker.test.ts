import { afterEach, describe, expect, it, vi } from 'vitest'
import { createCommercialScheduler } from '../commercial/scheduler.js'
import { HEARTBEAT_INTERVAL_MS, startWorkerHeartbeat } from '../service-health.js'

type Beat = { component: string; beatAt: Date; startedAt: Date; detail: Record<string, any> }
/** A pool that records every heartbeat write; `fail` makes the other queries, `failBeats` the heartbeat write, reject. */
function recordingPool(o: { fail?: boolean; failBeats?: boolean; hangBeats?: boolean } = {}) {
  const beats: Beat[] = []
  const query = async (sql: string, params: unknown[] = []) => {
    if (String(sql).includes('INSERT INTO service_heartbeats')) {
      if (o.failBeats) throw new Error('write failed at db.internal:5432')
      beats.push({ component: params[0] as string, beatAt: params[1] as Date, startedAt: params[2] as Date, detail: JSON.parse(params[3] as string) })
      if (o.hangBeats) return new Promise(() => {})
      return { rows: [], rowCount: 1 }
    }
    if (o.fail) throw new Error('database_hiccup')
    return { rows: [], rowCount: 0 }
  }
  return { pool: { query, connect: async () => ({ query, release() {} }) } as never, beats }
}

describe('the scheduler beat', () => {
  it('writes one beat on the first tick and then at most every 30 seconds', async () => {
    vi.spyOn(console, 'debug').mockImplementation(() => {})
    const { pool, beats } = recordingPool()
    let now = Date.parse('2026-11-22T10:00:00Z')
    const scheduler = createCommercialScheduler({ pool, config: {} as never, env: {}, clock: () => now, log: () => {} })
    for (const step of [0, 10_000, 19_000, 1_000]) { now += step; await scheduler.tick() }   // 0 s, 10 s, 29 s, 30 s
    expect(beats.map(b => b.beatAt.toISOString())).toEqual(['2026-11-22T10:00:00.000Z', '2026-11-22T10:00:30.000Z'])
    expect(beats.every(b => b.component === 'commercial_scheduler' && b.startedAt.toISOString() === '2026-11-22T10:00:00.000Z')).toBe(true)
    now += 20_000; await scheduler.tick()
    expect(beats).toHaveLength(2)
    now += 10_000; await scheduler.tick()
    expect(beats).toHaveLength(3)
  })

  it('carries the tick count, the last billing pass and the jobs that failed in the last tick', async () => {
    vi.spyOn(console, 'debug').mockImplementation(() => {})
    const { pool, beats } = recordingPool({ fail: true })
    const now = Date.parse('2026-11-22T10:00:00Z')
    const scheduler = createCommercialScheduler({ pool, config: {} as never, env: {}, clock: () => now, log: () => {} })
    await scheduler.tick()
    expect(beats).toHaveLength(1)
    expect(beats[0]!.detail).toMatchObject({ ticks: 1, last_billing_at: '2026-11-22T10:00:00.000Z' })
    expect(beats[0]!.detail.failed_jobs).toEqual(expect.arrayContaining(['paid-fulfillment-recovery', 'fulfillment', 'vendor-alerts']))
    expect(JSON.stringify(beats[0]!.detail)).not.toContain('database_hiccup')
  })

  it('has no billing pass to report before the first one and no failed jobs when none failed', async () => {
    vi.spyOn(console, 'debug').mockImplementation(() => {})
    const { pool, beats } = recordingPool()
    await createCommercialScheduler({ pool, config: {} as never, env: {}, clock: () => 0, log: () => {} }).tick()
    expect(beats[0]!.detail).toMatchObject({ ticks: 1, failed_jobs: [] })
  })

  it('writes no beat once the worker is stopping', async () => {
    vi.spyOn(console, 'debug').mockImplementation(() => {})
    const { pool, beats } = recordingPool()
    const stop = new AbortController(); stop.abort()
    await createCommercialScheduler({ pool, config: {} as never, env: {}, clock: () => 0, log: () => {}, signal: stop.signal }).tick()
    expect(beats).toEqual([])
  })

  it('logs a beat that could not be written and still finishes the tick', async () => {
    vi.spyOn(console, 'debug').mockImplementation(() => {})
    const { pool } = recordingPool({ failBeats: true })
    const log = vi.fn()
    await expect(createCommercialScheduler({ pool, config: {} as never, env: {}, clock: () => 0, log }).tick()).resolves.toBeUndefined()
    expect(log).toHaveBeenCalledWith('service heartbeat commercial_scheduler not written', expect.any(Error))
  })
})

describe('the worker heartbeat timer', () => {
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks() })

  it('beats at start and every interval, and stops on the shutdown signal', async () => {
    vi.useFakeTimers()
    const { pool, beats } = recordingPool()
    const stop = new AbortController()
    startWorkerHeartbeat(pool, { startedAt: new Date(0), signal: stop.signal, log: () => {} })
    await vi.advanceTimersByTimeAsync(0)
    expect(beats).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(HEARTBEAT_INTERVAL_MS * 3)
    expect(beats).toHaveLength(4)
    expect(beats.every(b => b.component === 'shared_worker' && b.detail && Object.keys(b.detail).length === 0)).toBe(true)
    stop.abort()
    expect(vi.getTimerCount()).toBe(0)
    await vi.advanceTimersByTimeAsync(HEARTBEAT_INTERVAL_MS * 5)
    expect(beats).toHaveLength(4)
  })

  it('does not keep the process alive and starts nothing when the worker is already stopping', async () => {
    vi.useFakeTimers()
    const spy = vi.spyOn(globalThis, 'setInterval')
    const { pool } = recordingPool()
    const stop = new AbortController()
    startWorkerHeartbeat(pool, { startedAt: new Date(0), signal: stop.signal, log: () => {} })
    expect((spy.mock.results[0]!.value as { hasRef(): boolean }).hasRef()).toBe(false)
    stop.abort()
    spy.mockClear()
    startWorkerHeartbeat(pool, { startedAt: new Date(0), signal: stop.signal, log: () => {} })
    expect(spy).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('keeps beating after a failed write, and does not pile up behind a write that hangs', async () => {
    vi.useFakeTimers()
    const failing = recordingPool({ failBeats: true })
    const log = vi.fn()
    const stop = new AbortController()
    startWorkerHeartbeat(failing.pool, { startedAt: new Date(0), signal: stop.signal, log })
    await vi.advanceTimersByTimeAsync(HEARTBEAT_INTERVAL_MS * 2)
    expect(log).toHaveBeenCalledTimes(3)
    const hanging = recordingPool({ hangBeats: true })
    startWorkerHeartbeat(hanging.pool, { startedAt: new Date(0), signal: stop.signal, log: () => {} })
    await vi.advanceTimersByTimeAsync(HEARTBEAT_INTERVAL_MS * 5)
    expect(hanging.beats).toHaveLength(1)
    stop.abort()
  })
})
