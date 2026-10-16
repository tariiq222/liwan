import { createApp } from '../http.js'
import { signMock as signServiceRequest, mockSessionQuery } from '../__tests__/helpers/vendor-session.js'
import { withPublicationLock } from './registry-publisher.js'
import { expect, it } from 'vitest'
import { registryMutationSchema, publishRegistryMutation, recoverRegistry } from './registry-store.js'
import { mkdtemp, readFile, access } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import type { Pool } from 'pg'
import { vendorActorIssuer } from '../admin-auth/grants.js'

const installation = 'test-vendor'
const actor = { issuer: vendorActorIssuer(installation), actorUid: 7 }
function fixture() {
  let state = { revision: 0, targets: [] as Record<string, unknown>[], audit: [] as unknown[][] }
  let backup = structuredClone(state)
  let tail = Promise.resolve()
  const flags = { authorized: true, commitUnknown: false, reservedHost: false, failInsert: false, onboarding: false, onboardingStage: 'activating', operationsEnabled: true, operationsCapability: true }
  const queries: string[] = []
  const pool = { connect: async () => {
    let releaseLock: () => void = () => {}
    return {
    release() {},
    async query(sql: string, values: unknown[] = []) {
      queries.push(sql)
      const result = (rows: unknown[] = []) => ({ rowCount: rows.length, rows })
      const session = mockSessionQuery(sql, values)
      if (session) return session
      if (sql === 'SELECT pg_advisory_lock($1)') { const before = tail; tail = new Promise<void>(r => { releaseLock = r }); await before; return result() }
      if (sql === 'SELECT pg_advisory_unlock($1)') { releaseLock(); return result() }
      if (sql === 'BEGIN') { backup = structuredClone(state); return result() }
      if (sql === 'ROLLBACK') { state = structuredClone(backup); return result() }
      if (sql === 'COMMIT') { backup = structuredClone(state); if (flags.commitUnknown) { flags.commitUnknown = false; throw new Error('connection_lost_after_commit') }; return result() }
      if (sql.startsWith('INSERT INTO service_nonces')) return result([{ nonce: values[1] }])
      if (sql.startsWith('DELETE FROM service_nonces')) return result()
      if (sql.includes('FROM shared_onboardings')) return result(flags.onboarding ? [{control_tenant_id: input.controlTenantId, issuer: actor.issuer, actor_uid: actor.actorUid, stage: flags.onboardingStage}] : [])
      if (sql.includes('FROM vendor_accounts WHERE id')) return result(flags.authorized ? [{}] : [])
      if (sql.includes('FROM vendor_account_roles')) return result(flags.operationsCapability ? [{ role: 'customer_success' }, { role: 'operations' }] : [{ role: 'customer_success' }])
      if (sql.includes('FROM shared_registry_state')) return result([{ revision: state.revision }])
      if (sql.includes('FROM tenants')) return result(sql.includes('operations_enabled=true') && !flags.operationsEnabled ? [] : [{ id: values[0] }])
      if (sql.includes('FROM shared_registry_hosts')) return result(flags.reservedHost ? [{ control_tenant_id: 'different-owner' }] : [])
      if (sql.includes('FROM shared_registry_bindings')) return result(state.targets)
      if (sql.startsWith('INSERT INTO shared_registry_bindings')) { if (flags.failInsert) throw new Error('insert_failed'); state.targets.push({ tenantId: values[1], host: values[2], database: values[3], filestore: values[4], enabled: values[5], registryRevision: values[6] }); return result() }
      if (sql.startsWith('UPDATE shared_registry_bindings')) { Object.assign(state.targets[0]!, { host: values[0], enabled: values[1], registryRevision: values[2] }); return result() }
      if (sql.startsWith('INSERT INTO shared_registry_hosts')) return result()
      if (sql.startsWith('UPDATE shared_registry_state')) { state.revision = Number(values[0]); return result() }
      if (sql.startsWith('INSERT INTO shared_registry_audit')) { state.audit.push(values); return result() }
      if (sql.startsWith('INSERT INTO audit_events')) { state.audit.push(values); return result() }
      throw new Error('unexpected_sql:' + sql)
    },
  } } } as unknown as Pool
  return { pool, flags, queries, state: () => state }
}
const publicationPath = async () => join(await mkdtemp(join(tmpdir(), 'webvue-registry-store-')), 'registry.json')

const input = { controlTenantId: 'ad03d956-efef-4f80-baf3-9c23ea46e945', expectedSnapshotRevision: 0, target: { host: 'a.invalid', tenantId: 'a', database: 'db_a', filestore: 'db_a', enabled: true, registryRevision: 1 }, reason: 'Enroll test tenant' }
it('publishes through signed HTTP and real store/filesystem with trusted audit identity', async () => {
  const f=fixture(), path=await publicationPath()
  const key='registry-publication-integration-synthetic-key-'.repeat(2)
  const server=createApp(f.pool,{installationId:installation,key,tenantRegistryPath:path,inventoryPath:'/unused',stateDir:'/unused',repositoryRoot:'/unused',python:'python3'})
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve))
  try {
    const address=server.address();if(!address||typeof address==='string')throw Error('missing address')
    const route='/v1/registry/mutations',body=JSON.stringify(input)
    const response=await fetch(`http://127.0.0.1:${address.port}${route}`,{method:'POST',body,headers:{...signServiceRequest({method:'POST',path:route,body,actor:actor.actorUid,issuer:installation,key}),'content-type':'application/json'}})
    expect(response.status).toBe(200);expect(await response.json()).toEqual({snapshotRevision:1})
    expect(JSON.parse(await readFile(path,'utf8'))).toEqual({schemaVersion:1,snapshotRevision:1,targets:[input.target]})
    expect(f.state().audit.flat()).toContain(actor.issuer)
    expect(f.state().audit.flat()).toContain(actor.actorUid)
    // New signed request, same stale CAS: domain conflict, not nonce replay.
    const stale=await fetch(`http://127.0.0.1:${address.port}${route}`,{method:'POST',body,headers:{...signServiceRequest({method:'POST',path:route,body,actor:actor.actorUid,issuer:installation,key}),'content-type':'application/json'}})
    expect(stale.status).toBe(409)
    expect((await stale.json()).code).toBe('registry_revision_conflict')
    expect(f.state().revision).toBe(1)
    expect(f.state().audit).toHaveLength(1)
    expect(JSON.parse(await readFile(path,'utf8'))).toEqual({schemaVersion:1,snapshotRevision:1,targets:[input.target]})
    await expect(access(`${path}.pending`)).rejects.toThrow()
    await expect(access(`${path}.publisher-lock`)).rejects.toThrow()
  } finally {await new Promise<void>(resolve=>server.close(()=>resolve()))}
})
it('recovers committed pending authority through signed HTTP without trusting the old file', async () => {
  const f=fixture(), path=await publicationPath()
  await publishRegistryMutation(f.pool,path,actor,input)
  f.flags.commitUnknown=true
  const disabled={...input,expectedSnapshotRevision:1,target:{...input.target,enabled:false,registryRevision:2}}
  await expect(publishRegistryMutation(f.pool,path,actor,disabled)).rejects.toThrow('connection_lost_after_commit')
  expect(JSON.parse(await readFile(path,'utf8')).targets[0].enabled).toBe(true)
  await access(`${path}.pending`)
  const key='registry-recovery-integration-synthetic-key-'.repeat(2)
  const server=createApp(f.pool,{installationId:installation,key,tenantRegistryPath:path,inventoryPath:'/unused',stateDir:'/unused',repositoryRoot:'/unused',python:'python3'})
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve))
  try {
    const address=server.address();if(!address||typeof address==='string')throw Error('missing address')
    const route='/v1/registry/recover',body=JSON.stringify({reason:'Recover synthetic uncertain commit'})
    const response=await fetch(`http://127.0.0.1:${address.port}${route}`,{method:'POST',body,headers:{...signServiceRequest({method:'POST',path:route,body,actor:actor.actorUid,issuer:installation,key}),'content-type':'application/json'}})
    expect(response.status).toBe(200);expect(await response.json()).toEqual({snapshotRevision:2})
    expect(JSON.parse(await readFile(path,'utf8'))).toEqual({schemaVersion:1,snapshotRevision:2,targets:[disabled.target]})
    expect(f.state().audit.at(-1)).toContain('registry.recovery_requested')
    await expect(access(`${path}.pending`)).rejects.toThrow()
    await expect(access(`${path}.publisher-lock`)).rejects.toThrow()
  } finally {await new Promise<void>(resolve=>server.close(()=>resolve()))}
})
it('refuses exhausted snapshot revision before creating a publication barrier', async () => {
  const f=fixture(),path=await publicationPath()
  f.state().revision=Number.MAX_SAFE_INTEGER-1
  await expect(publishRegistryMutation(f.pool,path,actor,{...input,expectedSnapshotRevision:Number.MAX_SAFE_INTEGER-1})).rejects.toThrow('registry_revision_exhausted')
  await expect(access(`${path}.pending`)).rejects.toThrow()
  expect(f.state().targets).toEqual([])
})
it('excludes both SQL mutation and recovery while another publisher retains filesystem ownership', async () => {
  const f = fixture(), path = await publicationPath()
  await withPublicationLock(path, async () => {
    await expect(publishRegistryMutation(f.pool,path,actor,input)).rejects.toThrow('registry_lock_unavailable')
    await expect(recoverRegistry(f.pool,path,actor,'Competing recovery')).rejects.toThrow('registry_lock_unavailable')
    expect(f.queries).toEqual([])
  })
  expect((await publishRegistryMutation(f.pool,path,actor,input)).snapshotRevision).toBe(1)
})
it('recovers a rolled-back first publication to an empty deny-all authority', async () => {
  const f = fixture(), path = await publicationPath()
  f.flags.failInsert = true
  await expect(publishRegistryMutation(f.pool, path, actor, input)).rejects.toThrow('insert_failed')
  await access(`${path}.pending`)
  const recovered = await recoverRegistry(f.pool, path, actor, 'Recover failed bootstrap')
  expect(recovered.targets).toEqual([])
  expect(recovered.snapshotRevision).toBe(0)
  await expect(access(`${path}.pending`)).rejects.toThrow()
  f.flags.failInsert = false
  expect((await publishRegistryMutation(f.pool, path, actor, input)).targets).toHaveLength(1)
})
it('never audits a failed missing-marker recovery as completed', async () => {
  const f = fixture(), path = await publicationPath()
  await publishRegistryMutation(f.pool, path, actor, input)
  await expect(recoverRegistry(f.pool, path, actor, 'No pending recovery')).rejects.toThrow()
  expect(f.state().audit.at(-1)?.[1]).toBe('registry.recovery_requested')
  expect(f.state().audit.flat()).not.toContain('registry.recovered')
})
it('publishes authorized mutations with matching audit and refuses a stale writer', async () => {
  const f = fixture(), path = await publicationPath()
  const published = await publishRegistryMutation(f.pool, path, actor, input)
  expect(published.snapshotRevision).toBe(1)
  expect(JSON.parse(await readFile(path, 'utf8'))).toEqual(published)
  expect(f.state().audit).toHaveLength(1)
  await expect(publishRegistryMutation(f.pool, path, actor, input)).rejects.toThrow('registry_revision_conflict')
  expect(f.state().revision).toBe(1)
})
it('never clears the barrier on uncertain commit and recovers disabled authority', async () => {
  const f = fixture(), path = await publicationPath()
  await publishRegistryMutation(f.pool, path, actor, input)
  f.flags.commitUnknown = true
  await expect(publishRegistryMutation(f.pool, path, actor, { ...input, expectedSnapshotRevision: 1, target: { ...input.target, enabled: false, registryRevision: 2 } })).rejects.toThrow('connection_lost_after_commit')
  await access(`${path}.pending`)
  expect(JSON.parse(await readFile(path, 'utf8')).targets[0].enabled).toBe(true)
  const recovered = await recoverRegistry(f.pool, path, actor, 'Recover after disconnect')
  expect(recovered.targets[0]!.enabled).toBe(false)
  expect(JSON.parse(await readFile(path, 'utf8')).targets[0].enabled).toBe(false)
  await expect(access(`${path}.pending`)).rejects.toThrow()
})
it('denies a revoked manager before writing a publication barrier', async () => {
  const f = fixture(), path = await publicationPath()
  f.flags.authorized = false
  await expect(publishRegistryMutation(f.pool, path, actor, input)).rejects.toThrow('registry_forbidden')
  await expect(access(`${path}.pending`)).rejects.toThrow()
  expect(f.state().audit).toHaveLength(0)
})
it('rejects reallocation of an existing identity and reuse of a reserved host', async () => {
  const f = fixture(), path = await publicationPath()
  await publishRegistryMutation(f.pool, path, actor, input)
  await expect(publishRegistryMutation(f.pool, path, actor, { ...input, expectedSnapshotRevision: 1, target: { ...input.target, database: 'other', filestore: 'other', registryRevision: 2 } })).rejects.toThrow('tenant_binding_immutable')
  f.flags.reservedHost = true
  await expect(publishRegistryMutation(f.pool, path, actor, { ...input, expectedSnapshotRevision: 1, target: { ...input.target, host: 'reserved.invalid', registryRevision: 2 } })).rejects.toThrow('registry_host_reserved')
  expect(f.state().revision).toBe(1)
  await expect(access(`${path}.pending`)).rejects.toThrow()
})
it('serializes competing mutations and accepts only one expected revision', async () => {
  const f = fixture(), path = await publicationPath()
  const results = await Promise.allSettled([publishRegistryMutation(f.pool, path, actor, input), publishRegistryMutation(f.pool, path, actor, input)])
  expect(results.map(r => r.status).sort()).toEqual(['fulfilled', 'rejected'])
  expect(f.state().audit).toHaveLength(1)
})
it('accepts explicit UUID mapping, canonical host and two revision controls', () => {
  expect(registryMutationSchema.parse(input)).toEqual(input)
})
it('rejects caller authority and mismatched filestore', () => {
  expect(() => registryMutationSchema.parse({ ...input, actorUid: 7 })).toThrow()
  expect(() => registryMutationSchema.parse({ ...input, target: { ...input.target, filestore: 'other' } })).toThrow()
})
it('rejects noncanonical hosts and unbounded revision', () => {
  expect(() => registryMutationSchema.parse({ ...input, target: { ...input.target, host: 'A.invalid' } })).toThrow()
  expect(() => registryMutationSchema.parse({ ...input, expectedSnapshotRevision: Number.MAX_SAFE_INTEGER + 1 })).toThrow()
})

it.each(['operationsEnabled','operationsCapability'] as const)('rechecks %s inside first-route publication before opening the barrier', async revoked => {
  const f=fixture(), path=await publicationPath()
  f.flags.onboarding=true
  f.flags[revoked]=false
  await expect(publishRegistryMutation(f.pool,path,actor,input)).rejects.toMatchObject({code:revoked==='operationsEnabled'?'tenant_operations_unavailable':'shared_onboarding_forbidden'})
  expect(f.state().targets).toEqual([])
  expect(f.queries.some(sql=>sql.startsWith('INSERT INTO shared_registry_bindings'))).toBe(false)
  expect(f.queries.some(sql=>sql.includes('FROM vendor_accounts WHERE id') && sql.endsWith('FOR SHARE'))).toBe(true)
  await expect(access(`${path}.pending`)).rejects.toThrow()
})
it.each(['operationsEnabled','operationsCapability'] as const)('recovery preserves fail-closed barrier when %s is revoked after commit', async revoked => {
  const f=fixture(), path=await publicationPath()
  f.flags.onboarding=true
  f.flags.commitUnknown=true
  await expect(publishRegistryMutation(f.pool,path,actor,input)).rejects.toThrow('connection_lost_after_commit')
  await access(`${path}.pending`)
  f.flags[revoked]=false
  await expect(recoverRegistry(f.pool,path,actor,'Recover interrupted activation')).rejects.toMatchObject({code:revoked==='operationsEnabled'?'tenant_operations_unavailable':'shared_onboarding_forbidden'})
  await access(`${path}.pending`)
})

it('cannot recover an enabled pending snapshot after readiness was quarantined', async()=>{
  const f=fixture(),path=await publicationPath()
  f.flags.onboarding=true;f.flags.commitUnknown=true
  await expect(publishRegistryMutation(f.pool,path,actor,input)).rejects.toThrow('connection_lost_after_commit')
  f.flags.onboardingStage='needs_intervention'
  await expect(recoverRegistry(f.pool,path,actor,'Readiness was lost')).rejects.toMatchObject({code:'shared_onboarding_readiness_required'})
  await access(`${path}.pending`)
})
