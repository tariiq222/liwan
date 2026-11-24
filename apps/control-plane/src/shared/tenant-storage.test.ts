import { describe, expect, it, vi } from 'vitest'
import type { Pool } from 'pg'
import { vendorActorIssuer } from '../admin-auth/grants.js'
import { runSharedLoop } from './job-loop.js'
import { recordTenantStorageRun, runTenantStorageDue, runTenantStorageLoop, storageBackoffSeconds, storageResponseSchema, requestTenantStorage, STORAGE_MAX_ATTEMPTS, type StorageClaim } from './tenant-storage.js'

const actor = { issuer: vendorActorIssuer('storage-unit'), actorUid: 7 }
const tenant = '11111111-1111-4111-8111-111111111111'
const run1 = '687674dc-5789-4a99-b151-12d69f010cc3'
const claim = (over: Partial<StorageClaim> = {}): StorageClaim => ({ tenantId: tenant, operation: 'ensure', requestId: run1, revision: 1, attempts: 0, ...over })
const pending = { operation: 'ensure', tenantId: 'acme', requestId: run1, state: 'pending_key', stage: 'key_stored', retryAfterSeconds: 480 } as const
const active = { operation: 'verify', tenantId: 'acme', requestId: run1, state: 'active', stage: 'verified' } as const
function poolRecording(rowCount = 1) {
  const query = vi.fn(async (_sql: string, _params?: unknown[]) => ({ rowCount, rows: [] as unknown[] }))
  return { pool: { query } as unknown as Pool, query }
}

describe('tenant storage response', () => {
  it('accepts exactly a pending answer with a wait or an active one at the last stage', () => {
    expect(storageResponseSchema.parse(pending)).toEqual(pending)
    expect(storageResponseSchema.parse(active)).toEqual(active)
  })
  it('refuses a malformed, extended or inconsistent answer', () => {
    for (const bad of [{ ...pending, retryAfterSeconds: undefined }, { ...active, retryAfterSeconds: 5 }, { ...active, stage: 'key_stored' }, { ...pending, stage: 'verified' },
      { ...pending, secret: 'x' }, { ...pending, requestId: 'nope' }, { ...pending, state: 'failed' }, { ...pending, retryAfterSeconds: 0 }, { ...pending, retryAfterSeconds: 99999 }, {}, null])
      expect(() => storageResponseSchema.parse(bad)).toThrow()
  })
})

describe('tenant storage backoff', () => {
  it('doubles from one minute and stops at an hour', () => {
    expect([1, 2, 3, 4, 5, 6, 7, 8].map(storageBackoffSeconds)).toEqual([60, 120, 240, 480, 960, 1920, 3600, 3600])
  })
})

describe('recording a run', () => {
  it('an active answer stops the schedule and clears the error', async () => {
    const { pool, query } = poolRecording()
    expect(await recordTenantStorageRun(pool, claim({ operation: 'verify' }), { ok: true, response: active })).toBe(true)
    const [sql, params] = query.mock.calls[0]!
    expect(sql).toMatch(/state='active',stage='verified',error_code=NULL,attempts=0,next_run_at=NULL/)
    expect(params!.slice(0, 3)).toEqual([tenant, run1, 1])
  })
  it('a pending answer schedules verify after the wait, and a rotation keeps asking for rotate', async () => {
    for (const [operation, next] of [['ensure', 'verify'], ['verify', 'verify'], ['rotate', 'rotate']] as const) {
      const { pool, query } = poolRecording()
      await recordTenantStorageRun(pool, claim({ operation }), { ok: true, response: { ...pending, operation } })
      const params = query.mock.calls[0]![1]!
      expect(params[3]).toBe(next); expect(params[4]).toBe('key_stored'); expect(params[5]).toBe(480)
    }
  })
  it('a pending answer keeps the failure count, so a key that never starts to work still stops', async () => {
    const { pool, query } = poolRecording()
    await recordTenantStorageRun(pool, claim({ operation: 'rotate', attempts: 4 }), { ok: true, response: { ...pending, operation: 'rotate' } })
    expect(String(query.mock.calls[0]![0])).not.toMatch(/attempts/)
  })
  it('only an active answer clears the count', async () => {
    const { pool, query } = poolRecording()
    await recordTenantStorageRun(pool, claim({ attempts: 4 }), { ok: true, response: active })
    expect(String(query.mock.calls[0]![0])).toMatch(/attempts=0/)
  })
  it('never waits less than the minimum', async () => {
    const { pool, query } = poolRecording()
    await recordTenantStorageRun(pool, claim(), { ok: true, response: { ...pending, retryAfterSeconds: 1 } })
    expect(query.mock.calls[0]![1]![5]).toBe(30)
  })
  it('a failure counts, backs off, and asks for ensure (rotate stays rotate)', async () => {
    for (const [operation, next] of [['ensure', 'ensure'], ['verify', 'ensure'], ['rotate', 'rotate']] as const) {
      const { pool, query } = poolRecording()
      await recordTenantStorageRun(pool, claim({ operation, attempts: 2 }), { ok: false, code: 'oci_unreachable' })
      const [sql, params] = query.mock.calls[0]!
      expect(sql).toMatch(/state='failed'/); expect(sql).toMatch(/make_interval/)
      expect(params!.slice(3)).toEqual([next, 'oci_unreachable', 3, { error_code: 'oci_unreachable' }, 240])
    }
  })
  it('the last allowed failure stops the schedule', async () => {
    const { pool, query } = poolRecording()
    await recordTenantStorageRun(pool, claim({ attempts: STORAGE_MAX_ATTEMPTS - 1 }), { ok: false, code: 'key_not_valid' })
    const [sql, params] = query.mock.calls[0]!
    expect(sql).toMatch(/next_run_at=NULL/); expect(params).toHaveLength(8 - 1)
  })
  it('an unknown code is recorded as script_failed', async () => {
    const { pool, query } = poolRecording()
    await recordTenantStorageRun(pool, claim(), { ok: false, code: 'oracle said: secret' })
    expect(query.mock.calls[0]![1]).toContain('script_failed')
    expect(JSON.stringify(query.mock.calls)).not.toContain('secret')
  })
  it('a result for a superseded run is not recorded', async () => {
    const { pool } = poolRecording(0)
    expect(await recordTenantStorageRun(pool, claim(), { ok: true, response: active })).toBe(false)
  })
})

describe('the pass', () => {
  function pass(claims: StorageClaim[], rowCount = 1) {
    const calls: Array<[string, unknown[] | undefined]> = []
    const query = vi.fn(async (sql: string, params?: unknown[]) => {
      calls.push([sql, params])
      if (sql.includes('INSERT INTO tenant_storage')) return { rowCount: 0, rows: [] }
      if (sql.includes('WITH due AS')) return { rowCount: claims.length, rows: claims }
      return { rowCount, rows: [] }
    })
    return { pool: { query } as unknown as Pool, calls }
  }
  const updates = (calls: Array<[string, unknown[] | undefined]>) => calls.filter(([sql]) => sql.startsWith('UPDATE tenant_storage'))
  it('runs the claimed tenant with its run id and records the answer', async () => {
    const { pool, calls } = pass([claim()])
    const runner = vi.fn(async () => pending)
    expect(await runTenantStorageDue(pool, runner, { signal: new AbortController().signal })).toEqual({ ran: 1, recorded: 1 })
    expect(runner).toHaveBeenCalledWith(expect.objectContaining({ tenant_id: tenant, operation: 'ensure', request_id: run1 }))
    expect(updates(calls)).toHaveLength(1)
  })
  it('records a refusal by its code and any other error as script_failed, and keeps going', async () => {
    for (const [thrown, code] of [[Error('oci_refused'), 'oci_refused'], [Error('private path /x'), 'script_failed'], ['text', 'script_failed']] as const) {
      const { pool, calls } = pass([claim()])
      await runTenantStorageDue(pool, async () => { throw thrown }, { signal: new AbortController().signal })
      expect(updates(calls)[0]![1]).toContain(code)
    }
  })
  it('treats an answer for another run or operation, or a malformed one, as a failure', async () => {
    for (const answer of [{ ...pending, requestId: '5f1c6f9e-0d68-4a5b-9d0c-2a52d3a1c001' }, { ...pending, operation: 'rotate' }, { nope: 1 }, null]) {
      const { pool, calls } = pass([claim()])
      await runTenantStorageDue(pool, async () => answer, { signal: new AbortController().signal })
      expect(updates(calls)[0]![1]).toContain('script_failed')
    }
  })
  it('records nothing when the worker is stopping, so the lease expires and the run is repeated', async () => {
    const controller = new AbortController()
    const { pool, calls } = pass([claim()])
    const result = await runTenantStorageDue(pool, async () => { controller.abort(); throw Error('script_failed') }, { signal: controller.signal })
    expect(result).toEqual({ ran: 1, recorded: 0 })
    expect(updates(calls)).toHaveLength(0)
  })
  it('runs nothing when nothing is due', async () => {
    const { pool } = pass([])
    const runner = vi.fn()
    expect(await runTenantStorageDue(pool, runner, { signal: new AbortController().signal })).toEqual({ ran: 0, recorded: 0 })
    expect(runner).not.toHaveBeenCalled()
  })
  it('only an enabled SaaS tenant with an active onboarding is ever discovered, claimed or asked for', async () => {
    const { pool, calls } = pass([])
    await runTenantStorageDue(pool, vi.fn(), { signal: new AbortController().signal })
    for (const [sql] of calls.filter(([s]) => s.includes('INSERT INTO tenant_storage') || s.includes('WITH due AS'))) {
      expect(sql).toMatch(/enabled=true/); expect(sql).toMatch(/commercial_mode='saas'/)
    }
    expect(calls[0]![0]).toMatch(/o\.stage='active'/)
    for (const operation of ['ensure', 'rotate'] as const) {
      const sql: string[] = []
      const client = { release() {}, async query(text: string) { sql.push(text); return { rowCount: text.startsWith('INSERT INTO tenant_storage') || text.startsWith('SELECT 1') ? 0 : 1, rows: [] } } }
      await expect(requestTenantStorage({ connect: async () => client } as unknown as Pool, tenant, operation, actor, 'rotate keys')).rejects.toThrow('tenant_operations_unavailable')
      expect(sql.find(text => /^(INSERT INTO tenant_storage|SELECT 1)/.test(text))).toMatch(/commercial_mode='saas'[\s\S]*o\.stage='active'/)
      expect(sql).toContain('ROLLBACK'); expect(sql.some(text => text.includes('audit_events'))).toBe(false)
    }
  })
  it('a rotation needs a key that was stored once: otherwise it is refused as not ready and nothing is audited', async () => {
    const sql: string[] = []
    const client = { release() {}, async query(text: string) { sql.push(text); return { rowCount: text.startsWith('UPDATE tenant_storage') ? 0 : 1, rows: [] } } }
    await expect(requestTenantStorage({ connect: async () => client } as unknown as Pool, tenant, 'rotate', actor, 'rotate keys')).rejects.toThrow('tenant_storage_not_ready')
    expect(sql.find(text => text.startsWith('UPDATE tenant_storage'))).toMatch(/stage IS NOT NULL/)
    expect(sql.some(text => text.startsWith('INSERT INTO tenant_storage'))).toBe(false)  // a rotation never creates the row
    expect(sql).toContain('ROLLBACK'); expect(sql.some(text => text.includes('audit_events'))).toBe(false)
  })
  it('writes the audit row with the operator, the operation and the reason in the same transaction', async () => {
    for (const operation of ['ensure', 'rotate'] as const) {
      const calls: Array<[string, unknown[] | undefined]> = []
      const client = { release() {}, async query(text: string, params?: unknown[]) { calls.push([text, params]); return { rowCount: 1, rows: [] } } }
      await requestTenantStorage({ connect: async () => client } as unknown as Pool, tenant, operation, actor, 'rotate keys')
      const audit = calls.find(([text]) => text.startsWith('INSERT INTO audit_events'))!
      expect(calls[0]![0]).toBe('BEGIN'); expect(calls.at(-1)![0]).toBe('COMMIT')
      expect(audit[1]!.slice(1)).toEqual(['account:7', 'tenant_storage.requested', tenant, `${operation}: rotate keys`])
    }
  })
  it('rejects a bad tenant id or reason before the database', async () => {
    const { pool, calls } = pass([])
    await expect(requestTenantStorage(pool, 'x', 'rotate', actor, 'rotate keys')).rejects.toThrow()
    await expect(requestTenantStorage(pool, tenant, 'rotate', actor, 'x')).rejects.toThrow()
    expect(calls).toHaveLength(0)
  })
})

describe('the storage loop', () => {
  const idlePool = () => ({ query: vi.fn(async (sql: string) => sql.includes('WITH due AS') ? { rowCount: 1, rows: [claim()] } : { rowCount: 0, rows: [] }) }) as unknown as Pool
  const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve() }
  it('runs one pass at a time: a run in flight is not joined by a second one', async () => {
    let release!: (value: unknown) => void
    const runner = vi.fn(() => new Promise<unknown>(resolve => { release = resolve }))
    const controller = new AbortController()
    const loop = runTenantStorageLoop(idlePool(), runner, { signal: controller.signal, wait: async () => {}, idleMs: 0, busyMs: 0 })
    await flush(); await flush()
    expect(runner).toHaveBeenCalledTimes(1)
    release(pending); await flush()
    expect(runner.mock.calls.length).toBeGreaterThanOrEqual(2)
    controller.abort(); release(pending); await loop
  })
  it('does not hold back the job loop: dispatch keeps going while a storage run is in flight', async () => {
    let release!: (value: unknown) => void
    const runner = vi.fn(() => new Promise<unknown>(resolve => { release = resolve }))
    const controller = new AbortController()
    const loop = runTenantStorageLoop(idlePool(), runner, { signal: controller.signal, wait: async () => {} })
    await flush()
    expect(runner).toHaveBeenCalledTimes(1)  // the storage run is now in flight and unresolved
    let dispatched = 0
    await runSharedLoop({ dispatch: async () => ({ state: ++dispatched < 5 ? 'verified' : 'idle' }), isStopping: () => dispatched >= 5, isTransient: () => false, wait: async () => {} })
    expect(dispatched).toBe(5)
    expect(runner).toHaveBeenCalledTimes(1)  // still in flight: the dispatches did not wait for it
    controller.abort(); release(pending); await loop
  })
  it('logs a failing pass and keeps going, and waits longer when nothing was due', async () => {
    const waits: number[] = []
    const controller = new AbortController()
    const pool = { query: vi.fn(async () => { if (waits.length === 0) throw Error('database down'); return { rowCount: 0, rows: [] } }) } as unknown as Pool
    const log = vi.fn()
    await runTenantStorageLoop(pool, vi.fn(), { signal: controller.signal, log, idleMs: 111, wait: async ms => { waits.push(ms); if (waits.length === 2) controller.abort() } })
    expect(log).toHaveBeenCalledWith('tenant-storage pass failed', expect.any(Error))
    expect(waits).toEqual([111, 111])
  })
  it('stops at once when the worker stops', async () => {
    const controller = new AbortController(); controller.abort()
    const runner = vi.fn()
    await runTenantStorageLoop(idlePool(), runner, { signal: controller.signal })
    expect(runner).not.toHaveBeenCalled()
  })
})
