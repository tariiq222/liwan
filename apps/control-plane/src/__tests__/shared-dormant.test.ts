import { afterEach, expect, it, vi } from 'vitest'
import { resolveTargetLane } from '../http.js'
import { claimNext, executeClaimed } from '../worker.js'
import type { Pool } from 'pg'
import type { Config } from '../config.js'
import type { Claimed } from '../worker.js'
afterEach(() => vi.unstubAllEnvs())
it.each(['shared', 'typo'])('refuses %s target resolution before inventory or enqueue', async (mode) => {
  vi.stubEnv('LIWAN_TENANCY_MODE', mode)
  await expect(resolveTargetLane({} as Config, 'tenant_a', 'saas')).rejects.toThrow('Shared execution is unavailable')
})
it('does not claim legacy queue in shared process', async () => {
  vi.stubEnv('LIWAN_TENANCY_MODE', 'shared')
  const connect = vi.fn()
  expect(await claimNext({ connect } as unknown as Pool)).toBeNull()
  expect(connect).not.toHaveBeenCalled()
})
it('refuses already claimed shared work before any adapter invocation', async () => {
  vi.stubEnv('LIWAN_TENANCY_MODE', 'shared')
  const query = vi.fn(async () => ({ rowCount: 1, rows: [{}] }))
  const client = { query, release: vi.fn() }
  const pool = { query, connect: vi.fn(async () => client) } as unknown as Pool
  const invokeAdapter = vi.fn()
  const claimed = { operation: { id: 'test', type: 'tenant.create', tenant_id: 'test', payload: {} }, tenant: {}, client, lockKey: 'test' } as unknown as Claimed
  await executeClaimed(pool, claimed, { invokeAdapter } as unknown as Config)
  expect(invokeAdapter).not.toHaveBeenCalled()
  expect(query.mock.calls.some((call) => JSON.stringify(call).includes('shared_execution_unavailable'))).toBe(true)
})
