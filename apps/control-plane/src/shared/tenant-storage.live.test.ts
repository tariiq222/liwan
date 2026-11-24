// Parent-only execution against a dedicated loopback control scratch database.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { Pool } from 'pg'
import { randomUUID } from 'node:crypto'
import { migrate } from '../db.js'
import { vendorActorIssuer } from '../admin-auth/grants.js'
import { claimTenantStorage, discoverTenantStorage, readTenantStorage, recordTenantStorageRun, requestTenantStorage, runTenantStorageDue, STORAGE_MAX_ATTEMPTS } from './tenant-storage.js'

const url = process.env.CONTROL_TEST_DATABASE_URL
if (url) { const u = new URL(url); if (!['localhost', '127.0.0.1', '::1'].includes(u.hostname) || !/^liwan_control_scratch_[a-z0-9]+$/.test(u.pathname.slice(1))) throw Error('isolated control test database required') }

describe.skipIf(!url)('tenant storage state (live PostgreSQL)', () => {
  const pool = new Pool({ connectionString: url, max: 4 })
  const signal = new AbortController().signal
  const actor = { issuer: vendorActorIssuer('storage-live'), actorUid: 7 }
  const state = (id: string) => pool.query('SELECT * FROM tenant_storage WHERE control_tenant_id=$1', [id]).then(r => r.rows[0])
  const answer = (requestId: string, over: Record<string, unknown> = {}) => ({ operation: 'ensure', tenantId: 'x', requestId, state: 'pending_key', stage: 'key_stored', retryAfterSeconds: 480, ...over })
  async function tenant(opts: { mode?: string; enabled?: boolean; onboarding?: string | null; operations?: boolean } = {}) {
    const id = randomUUID(), slug = 't' + id.replaceAll('-', '').slice(0, 20), db = 'liwan_scratch_' + id.replaceAll('-', '')
    await pool.query("INSERT INTO tenants(id,name,commercial_mode,hosting_model,inventory_target,operations_enabled) VALUES($1,'Storage fixture',$2,'shared_managed',$3,$4)",
      [id, opts.mode ?? 'saas', 'fixture-' + id, opts.operations ?? true])
    await pool.query('INSERT INTO shared_registry_bindings(control_tenant_id,tenant_id,host,database_name,filestore,enabled,registry_revision) VALUES($1,$2,$3,$4,$4,$5,1)',
      [id, slug, slug + '.invalid', db, opts.enabled ?? true])
    if (opts.onboarding !== null) {
      await pool.query("INSERT INTO shared_onboardings(request_id,control_tenant_id,issuer,actor_uid,request_digest,admin_name,admin_login,host,tenant_slug,database_name) VALUES($1,$1,'issuer',1,$2,'A','a@b.test',$3,$4,$5)",
        [id, 'a'.repeat(64), slug + '.h.test', slug, db])
      await pool.query('UPDATE shared_onboardings SET stage=$2 WHERE control_tenant_id=$1', [id, opts.onboarding ?? 'active'])
    }
    return id
  }
  beforeAll(async () => { await migrate(pool) })
  // Fixtures of earlier tests stay in the scratch database: switch them off so that each test sees only its own tenants.
  beforeEach(async () => { await pool.query('DELETE FROM tenant_storage'); await pool.query('UPDATE tenants SET operations_enabled=false') })
  afterAll(async () => { await pool.end() })

  it('discovers only an enabled SaaS tenant with an active onboarding, once', async () => {
    const ready = await tenant(), pending = await tenant({ onboarding: 'queued' }), none = await tenant({ onboarding: null }),
      off = await tenant({ enabled: false }), mode = await tenant({ mode: 'non_saas' }), blocked = await tenant({ operations: false })
    await discoverTenantStorage(pool); await discoverTenantStorage(pool)
    expect((await state(ready)).state).toBe('queued')
    expect((await state(ready)).operation).toBe('ensure')
    for (const id of [pending, none, off, mode, blocked]) expect(await state(id)).toBeUndefined()
  })

  it('claims a due tenant once: the lease keeps it from a second claim, and concurrent claims never share a tenant', async () => {
    const ids: string[] = await Promise.all([tenant(), tenant(), tenant()])
    await discoverTenantStorage(pool)
    const claims = (await Promise.all([claimTenantStorage(pool, 1), claimTenantStorage(pool, 1), claimTenantStorage(pool, 1), claimTenantStorage(pool, 1)])).flat()
    expect(claims).toHaveLength(3)
    expect(new Set(claims.map(c => c.tenantId)).size).toBe(3)
    expect(claims.every(c => ids.includes(c.tenantId) && c.operation === 'ensure' && c.revision === 1)).toBe(true)
    expect(await claimTenantStorage(pool, 5)).toEqual([])
    expect((await state(claims[0]!.tenantId)).request_id).toBe(claims[0]!.requestId)
  })

  it('a pending answer schedules a later verify, then an active one ends the schedule', async () => {
    const id = await tenant()
    let seen: unknown[] = []
    const runner = async (input: { operation: string; request_id: string }) => {
      seen.push(input.operation)
      return input.operation === 'ensure' ? answer(input.request_id) : answer(input.request_id, { operation: 'verify', state: 'active', stage: 'verified', retryAfterSeconds: undefined })
    }
    expect(await runTenantStorageDue(pool, runner, { signal })).toEqual({ ran: 1, recorded: 1 })
    let row = await state(id)
    expect([row.state, row.operation, row.stage, row.attempts]).toEqual(['pending_key', 'verify', 'key_stored', 0])
    expect(new Date(row.next_run_at).getTime() - Date.now()).toBeGreaterThan(400_000)
    expect(await runTenantStorageDue(pool, runner, { signal })).toEqual({ ran: 0, recorded: 0 })
    await pool.query('UPDATE tenant_storage SET next_run_at=clock_timestamp() WHERE control_tenant_id=$1', [id])
    await runTenantStorageDue(pool, runner, { signal })
    row = await state(id)
    expect([row.state, row.stage, row.error_code, row.next_run_at]).toEqual(['active', 'verified', null, null])
    expect(seen).toEqual(['ensure', 'verify'])
    expect(JSON.stringify(row.response)).not.toMatch(/secret|key_id|accessKey/i)
    expect(await runTenantStorageDue(pool, runner, { signal })).toEqual({ ran: 0, recorded: 0 })
  })

  it('failures back off, count, and stop for good after the last attempt', async () => {
    const id = await tenant()
    const runner = async () => { throw Error('oci_unreachable') }
    for (let attempt = 1; attempt <= STORAGE_MAX_ATTEMPTS; attempt++) {
      await pool.query('UPDATE tenant_storage SET next_run_at=clock_timestamp() WHERE control_tenant_id=$1', [id]).catch(() => undefined)
      await runTenantStorageDue(pool, runner, { signal })
      const row = await state(id)
      expect([row.state, row.error_code, row.attempts, row.operation]).toEqual(['failed', 'oci_unreachable', attempt, 'ensure'])
      if (attempt < STORAGE_MAX_ATTEMPTS) expect(new Date(row.next_run_at).getTime() - Date.now()).toBeGreaterThan(30_000)
      else expect(row.next_run_at).toBeNull()
    }
    expect(await claimTenantStorage(pool, 5)).toEqual([])
    // an operator asks again: back to queued, counters reset
    await requestTenantStorage(pool, id, 'ensure', actor, 'Retry after fixing the key')
    const row = await state(id)
    expect([row.state, row.error_code, row.attempts, row.revision]).toEqual(['queued', null, 0, 2])
    const audit = await pool.query("SELECT actor,reason FROM audit_events WHERE action='tenant_storage.requested' AND subject=$1", [id])
    expect(audit.rows).toEqual([{ actor: 'account:7', reason: 'ensure: Retry after fixing the key' }])
    expect(await claimTenantStorage(pool, 5)).toHaveLength(1)
  })

  it('an operator request supersedes a run in flight: its late answer is not recorded and the rotation runs next', async () => {
    const id = await tenant()
    await discoverTenantStorage(pool)
    const [inFlight] = await claimTenantStorage(pool, 1)
    await pool.query("UPDATE tenant_storage SET state='pending_key',stage='key_stored' WHERE control_tenant_id=$1", [id])  // a key was stored once
    await requestTenantStorage(pool, id, 'rotate', actor, 'Rotate the tenant key')
    expect(await recordTenantStorageRun(pool, inFlight!, { ok: true, response: answer(inFlight!.requestId) as never })).toBe(false)
    let row = await state(id)
    expect([row.operation, row.state, row.request_id, row.revision]).toEqual(['rotate', 'pending_key', null, 2])
    const [next] = await claimTenantStorage(pool, 1)
    expect(next).toMatchObject({ tenantId: id, operation: 'rotate', revision: 2 })
    await recordTenantStorageRun(pool, next!, { ok: true, response: answer(next!.requestId, { operation: 'rotate' }) as never })
    row = await state(id)
    expect([row.operation, row.state]).toEqual(['rotate', 'pending_key'])  // a rotation keeps asking for rotate
    expect(await readTenantStorage(pool, id)).toMatchObject({ operation: 'rotate', state: 'pending_key', stage: 'key_stored', errorCode: null })
    expect(Object.keys((await readTenantStorage(pool, id))!).sort()).toEqual(['attempts', 'errorCode', 'nextRunAt', 'operation', 'stage', 'state', 'updatedAt'])
  })

  it('a rotation of a tenant that never stored a key is refused as not ready: nothing changes and nothing is audited', async () => {
    const id = await tenant()
    await discoverTenantStorage(pool)
    await expect(requestTenantStorage(pool, id, 'rotate', actor, 'Rotate the tenant key')).rejects.toThrow('tenant_storage_not_ready')
    const row = await state(id)
    expect([row.operation, row.revision, row.stage]).toEqual(['ensure', 1, null])
    expect((await pool.query("SELECT 1 FROM audit_events WHERE action='tenant_storage.requested' AND subject=$1", [id])).rowCount).toBe(0)
    const none = await tenant()  // no row at all: a rotation does not create one
    await expect(requestTenantStorage(pool, none, 'rotate', actor, 'Rotate the tenant key')).rejects.toThrow('tenant_storage_not_ready')
    expect(await state(none)).toBeUndefined()
  })

  it('a rotation whose candidate never verifies stops after the allowed failures instead of issuing keys for ever', async () => {
    const id = await tenant()
    await discoverTenantStorage(pool)
    await pool.query("UPDATE tenant_storage SET state='active',stage='verified',next_run_at=NULL WHERE control_tenant_id=$1", [id])
    await requestTenantStorage(pool, id, 'rotate', actor, 'Rotate the tenant key')
    let pendings = 0
    const runner = async (input: { request_id: string; operation: string }) => {
      if (pendings === failuresSeen) { pendings++; return answer(input.request_id, { operation: 'rotate' }) }  // a new candidate is stored
      throw Error('key_not_valid')  // and it never verifies
    }
    let failuresSeen = 0
    for (let guard = 0; guard < 40; guard++) {
      const row = await state(id)
      if (row.next_run_at === null) break
      await pool.query('UPDATE tenant_storage SET next_run_at=clock_timestamp() WHERE control_tenant_id=$1', [id])
      await runTenantStorageDue(pool, runner, { signal })
      if ((await state(id)).state === 'failed') failuresSeen++
    }
    const row = await state(id)
    expect([row.state, row.error_code, row.attempts, row.next_run_at, row.operation]).toEqual(['failed', 'key_not_valid', STORAGE_MAX_ATTEMPTS, null, 'rotate'])
    expect(pendings).toBe(STORAGE_MAX_ATTEMPTS)  // one new candidate key per failed attempt, never more
  })

  it('an operator cannot ask for a tenant that is not a ready enabled SaaS tenant, and nothing is audited', async () => {
    const bad: string[] = [await tenant({ mode: 'non_saas' }), await tenant({ enabled: false }), await tenant({ onboarding: 'queued' }), await tenant({ operations: false }), randomUUID()]
    for (const id of bad) await expect(requestTenantStorage(pool, id, 'rotate', actor, 'Rotate the tenant key')).rejects.toThrow('tenant_operations_unavailable')
    expect((await pool.query("SELECT 1 FROM audit_events WHERE action='tenant_storage.requested' AND subject=ANY($1)", [bad])).rowCount).toBe(0)
    expect((await pool.query('SELECT 1 FROM tenant_storage WHERE control_tenant_id=ANY($1)', [bad])).rowCount).toBe(0)
  })

  it('a tenant disabled after it was queued is never claimed', async () => {
    const id = await tenant()
    await discoverTenantStorage(pool)
    await pool.query('UPDATE shared_registry_bindings SET enabled=false,registry_revision=registry_revision+1 WHERE control_tenant_id=$1', [id])
    expect(await claimTenantStorage(pool, 5)).toEqual([])
  })

  it('a tenant whose operations are switched off after it was queued is never claimed', async () => {
    const id = await tenant()
    await discoverTenantStorage(pool)
    await pool.query('UPDATE tenants SET operations_enabled=false WHERE id=$1', [id])
    expect(await claimTenantStorage(pool, 5)).toEqual([])
  })

  it('the table refuses an active row without a verified stage or with an error', async () => {
    const id = await tenant()
    await discoverTenantStorage(pool)
    await expect(pool.query("UPDATE tenant_storage SET state='active' WHERE control_tenant_id=$1", [id])).rejects.toThrow()
    await expect(pool.query("UPDATE tenant_storage SET state='active',stage='verified',error_code='oci_refused' WHERE control_tenant_id=$1", [id])).rejects.toThrow()
    await expect(pool.query("UPDATE tenant_storage SET error_code='Bad Text' WHERE control_tenant_id=$1", [id])).rejects.toThrow()
  })
})
