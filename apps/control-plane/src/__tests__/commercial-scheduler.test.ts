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
});
