import { beforeEach, expect, it, vi } from 'vitest'
import type { Pool } from 'pg'
import { dispatchSharedOnce } from './job-dispatcher.js'
import { expireSharedLeases, runSharedJob } from './job-worker.js'
vi.mock('./job-worker.js', () => ({ expireSharedLeases: vi.fn(), runSharedJob: vi.fn() }))
beforeEach(() => { vi.resetAllMocks(); vi.mocked(expireSharedLeases).mockResolvedValue(0) })
it.each(['shared_job_not_claimable','shared_reconciliation_required'])('treats %s as candidate contention, not permission to retry an effect', async message => {
  const pool={query:async()=>({rows:[{id:'job-id'}]})} as unknown as Pool
  vi.mocked(runSharedJob).mockRejectedValue(new Error(message))
  expect(await dispatchSharedOnce(pool,{observe:vi.fn(),applyFenced:vi.fn()})).toEqual({state:'contended'})
  expect(runSharedJob).toHaveBeenCalledTimes(1)
})
it('propagates adapter failure without retrying or reporting idle', async () => {
  const pool={query:async()=>({rows:[{id:'job-id'}]})} as unknown as Pool
  vi.mocked(runSharedJob).mockRejectedValue(new Error('effect_failed'))
  await expect(dispatchSharedOnce(pool,{observe:vi.fn(),applyFenced:vi.fn()})).rejects.toThrow('effect_failed')
  expect(runSharedJob).toHaveBeenCalledTimes(1)
})
it('does not select a candidate when expiry fails', async () => {
  const query=vi.fn()
  vi.mocked(expireSharedLeases).mockRejectedValue(new Error('database_disconnected'))
  await expect(dispatchSharedOnce({query} as unknown as Pool,{observe:vi.fn(),applyFenced:vi.fn()})).rejects.toThrow('database_disconnected')
  expect(query).not.toHaveBeenCalled(); expect(runSharedJob).not.toHaveBeenCalled()
})
it('refuses unconfigured execution without touching the database', async () => {
  const query=vi.fn()
  await expect(dispatchSharedOnce({query} as unknown as Pool)).rejects.toThrow('shared_adapter_unavailable')
  expect(query).not.toHaveBeenCalled()
})
it('expires leases before selecting eligible work and delegates trusted adapter', async () => {
  vi.mocked(expireSharedLeases).mockResolvedValue(1)
  vi.mocked(runSharedJob).mockResolvedValue({state:'needs_intervention'})
  const adapter={observe:vi.fn(),applyFenced:vi.fn()}
  const query=vi.fn(async(sql:string)=>{
    expect(expireSharedLeases).toHaveBeenCalled()
    expect(sql).toContain('tenant.operations_enabled=true')
    expect(sql).toContain('binding.enabled=true')
    expect(sql).toContain("queued.payload->>'operation' IN ('provision','backup')")
    expect(sql).toContain("queued.payload->'binding'=jsonb_build_object(")
    expect(sql).toContain("'tenantId',binding.tenant_id")
    expect(sql).toContain("'database',binding.database_name")
    expect(sql).toContain("'filestore',binding.filestore")
    expect(sql).toContain("'registryRevision',binding.registry_revision")
    expect(sql).toContain('membership.revoked_at IS NULL')
    expect(sql).toContain("'vendor.operations.run'=ANY(membership.capabilities)")
    expect(sql).toContain('membership.issuer=queued.issuer')
    expect(sql).toContain('membership.actor_uid=queued.actor_uid')
    expect(sql).toContain('NOT EXISTS')
    expect(sql).toContain("'needs_intervention'")
    return {rows:[{id:'job-id'}]}
  })
  const pool={query} as unknown as Pool
  expect(await dispatchSharedOnce(pool,adapter)).toEqual({state:'needs_intervention'})
  expect(runSharedJob).toHaveBeenCalledWith(pool,'job-id',adapter)
})
it('returns idle when no eligible job exists', async () => {
  vi.mocked(runSharedJob).mockClear()
  const pool={query:async()=>({rows:[]})} as unknown as Pool
  expect(await dispatchSharedOnce(pool,{observe:vi.fn(),applyFenced:vi.fn()})).toEqual({state:'idle'})
  expect(runSharedJob).not.toHaveBeenCalled()
})
