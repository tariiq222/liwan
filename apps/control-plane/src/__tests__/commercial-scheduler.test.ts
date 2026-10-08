import { describe, expect, it, vi } from 'vitest';
import { createCommercialScheduler } from '../commercial/scheduler.js';

describe('commercial scheduler', () => {
  it('exports the shared-worker scheduler factory', () => {
    expect(createCommercialScheduler).toBeTypeOf('function');
  });

  it('starts usage collection in the background, once at a time, without holding the tick', async () => {
    vi.spyOn(console, 'debug').mockImplementation(() => {})
    const row = { tenant_id: 't', database_name: 'd', registry_revision: '1' }
    const pool = {
      connect: async () => ({ query: async () => ({ rows: [{ ok: true }] }), release() {} }),
      query: async (sql: string) => (String(sql).includes('usage_collection_attempts') && String(sql).includes('SELECT x.tenant_id') ? { rows: [row], rowCount: 1 } : { rows: [], rowCount: 0 }),
    }
    let calls = 0
    let now = 0
    const scheduler = createCommercialScheduler({
      pool: pool as never, config: {} as never, env: {}, clock: () => now, log: () => {},
      usageRunner: () => { calls++; return new Promise(() => {}) },
    })
    await scheduler.tick()
    await new Promise(r => setTimeout(r, 20))
    expect(calls).toBe(1)
    now += 10 * 60 * 1000
    await scheduler.tick()
    await new Promise(r => setTimeout(r, 20))
    expect(calls).toBe(1)  // single flight: the first run is still in progress
  });

  it('uses a wall-clock interval (default 300 s, clamped to 600 s), not a tick count', async () => {
    vi.spyOn(console, 'debug').mockImplementation(() => {})
    const run = async (env: Record<string, string>, stepMs: number, ticks: number) => {
      let calls = 0, now = 1_000_000
      const pool = {
        connect: async () => ({ query: async () => ({ rows: [{ ok: true }] }), release() {} }),
        query: async (sql: string) => (String(sql).includes('SELECT x.tenant_id') ? { rows: [{ tenant_id: 't', database_name: 'd', registry_revision: '1' }], rowCount: 1 } : { rows: [], rowCount: 0 }),
      }
      const scheduler = createCommercialScheduler({ pool: pool as never, config: {} as never, env, clock: () => now, log: () => {}, usageRunner: async () => { calls++; return null } })
      for (let i = 0; i < ticks; i++) { await scheduler.tick(); await scheduler.usageIdle(); now += stepMs }
      return calls
    }
    expect(await run({}, 1000, 20)).toBe(1)                       // 20 s of ticks: one run
    expect(await run({}, 100_000, 7)).toBe(3)                     // 600 s: runs at 0, 300, 600 s
    expect(await run({ NASQ_COMMERCIAL_USAGE_INTERVAL_SEC: '999999' }, 100_000, 7)).toBe(2)  // clamped to 600 s: runs at 0 and 600 s
    expect(await run({ NASQ_COMMERCIAL_USAGE_INTERVAL_SEC: 'junk' }, 100_000, 7)).toBe(3)    // invalid: default
  });

  it('retries a lock-skipped usage run after 30 s, logs it once, and then waits a full interval after a real run', async () => {
    vi.spyOn(console, 'debug').mockImplementation(() => {})
    let locked = true, now = 1_000_000, calls = 0
    const logs: string[] = []
    const pool = {
      connect: async () => ({ query: async (sql: string) => { if (sql.includes('pg_try_advisory_lock')) calls++; return { rows: [{ ok: sql.includes('unlock') ? true : !locked }] } }, release() {} }),
      query: async () => ({ rows: [], rowCount: 0 }),
    }
    const scheduler = createCommercialScheduler({ pool: pool as never, config: {} as never, env: {}, clock: () => now, log: m => { logs.push(m) }, usageRunner: async () => null })
    const step = async (ms: number) => { now += ms; await scheduler.tick(); await scheduler.usageIdle() }
    await scheduler.tick(); await scheduler.usageIdle()
    await step(10_000); await step(10_000)           // within 30 s: no new attempt
    await step(15_000); await step(31_000)           // retried twice, still locked
    expect(logs.filter(m => m.startsWith('usage skipped'))).toHaveLength(1)
    locked = false
    await step(31_000)                               // runs for real
    const after = logs.length
    await step(100_000); await step(100_000)         // under the 300 s interval: nothing
    expect(logs).toHaveLength(after)
    await step(120_000)
    expect(calls).toBe(5)  // 0 s, 35 s, 66 s (locked) retries, 97 s real, then 317 s
  });

  it('does not start a usage run once the worker is stopping', async () => {
    vi.spyOn(console, 'debug').mockImplementation(() => {})
    const stop = new AbortController(); stop.abort()
    let calls = 0
    const pool = { connect: async () => ({ query: async () => ({ rows: [{ ok: true }] }), release() {} }), query: async () => ({ rows: [], rowCount: 0 }) }
    const scheduler = createCommercialScheduler({ pool: pool as never, config: {} as never, env: {}, log: () => {}, signal: stop.signal, usageRunner: async () => { calls++; return null } })
    await scheduler.tick(); await scheduler.usageIdle()
    expect(calls).toBe(0)
  });
});
