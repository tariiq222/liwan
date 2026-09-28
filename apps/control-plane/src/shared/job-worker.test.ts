import { expect, it, vi } from 'vitest'
import type { Pool } from 'pg'
import { recoverSharedJob, expireSharedLeases, runSharedJob } from './job-worker.js'
import { businessKey, payloadDigest } from './provisioning.js'
const id = 'ad03d956-efef-4f80-baf3-9c23ea46e945'
function fixture() {
  const binding = { tenantId: 'a', database: 'db_a', filestore: 'db_a', registryRevision: 1 }
  const job = { schemaVersion: 1, requestId: id, binding, operation: 'backup' }
  const row: Record<string, any> = { id, control_tenant_id: id, payload: job, business_key: businessKey(job), payload_digest: payloadDigest(job), issuer: 'vendor', actor_uid: 7, fence: 0, journal: null, state: 'queued' }
  const flags = { owned: true, enabled: true, authorized: true, rejectCompletion: false, unresolved: false, registryRevision: 1, revokeAfterClaim: false, loseVerifiedCommitAck: false }
  const events: string[] = []
  let snapshot: { row: Record<string, any>; events: string[] } | undefined
  const client = { release() {}, async query(sql: string, values: any[] = []) {
    const result = (rows: unknown[] = []) => ({ rows, rowCount: rows.length })
    if (sql === 'BEGIN') { snapshot = { row: structuredClone(row), events: [...events] }; return result() }
    if (sql === 'COMMIT') {
      snapshot = undefined
      if(flags.revokeAfterClaim && row.state==='running') flags.authorized=false
      if(flags.loseVerifiedCommitAck && row.state==='verified') { flags.loseVerifiedCommitAck=false; throw Error('connection_lost_after_verified_commit') }
      return result()
    }
    if (sql === 'ROLLBACK') {
      if (snapshot) {
        for (const key of Object.keys(row)) delete row[key]
        Object.assign(row, snapshot.row); events.splice(0, events.length, ...snapshot.events)
      }
      snapshot = undefined; return result()
    }
    if (sql.startsWith('SELECT pg_advisory')) return result()
    if (sql.includes("state IN ('running','needs_intervention')")) return result(flags.unresolved ? [{id:'another-job'}] : [])
    if (sql.startsWith('SELECT * FROM shared_jobs')) return result((sql.includes("state='queued'") ? row.state === 'queued' : sql.includes("state='needs_intervention'") ? row.state === 'needs_intervention' : flags.owned && row.state === 'running') ? [{ ...row }] : [])
    if (sql.includes('FROM vendor_memberships')) return result(flags.authorized ? [{}] : [])
    if (sql.includes('FROM tenants')) return result([{}])
    if (sql.includes('FROM shared_registry_bindings')) return result([{ ...binding, registryRevision:flags.registryRevision, host:'a.invalid', enabled:flags.enabled }])
    if (sql.startsWith("UPDATE shared_jobs SET state='running'")) { Object.assign(row,{ state:'running',attempt_id:values[0],fence:values[1] }); return result() }
    if (sql.startsWith('INSERT INTO audit_events')) return result()
    if (sql.startsWith('INSERT INTO shared_job_events')) { events.push(values[4]); return result() }
    if (sql.startsWith('UPDATE shared_jobs SET journal=') && sql.includes("state='verified'") && flags.rejectCompletion) return result()
    if (sql.startsWith('UPDATE shared_jobs SET journal=')) { row.journal=values[0]; if (sql.includes("state='verified'")) { row.state='verified'; row.receipt=values[1] }; return result([{id}]) }
    if (sql.startsWith("UPDATE shared_jobs SET state='needs_intervention'")) { row.state='needs_intervention'; return result() }
    throw Error('unexpected_sql:'+sql)
  } }
  return { inTransaction:()=>snapshot !== undefined, pool:{ connect:async()=>client } as unknown as Pool, row, flags, events, job, present:{ state:'present', binding, businessKey:businessKey(job), payloadDigest:payloadDigest(job), verified:true } }
}
it('persists intent before effect and completes receipt only after exact readback', async () => {
  const f=fixture(); let effects=0
  const result=await runSharedJob(f.pool,id,{ observe:async()=>effects ? f.present : {state:'absent'}, applyFenced:async context=>{ await context.assertOwned(); expect(f.events).toEqual(['prepared','started']); effects++ } })
  expect(result.state).toBe('verified'); expect(effects).toBe(1)
  expect(f.events).toEqual(['prepared','started','verified']); expect(f.row.receipt.binding).toEqual(f.job.binding)
})
it('rejects stale ownership before effect and does not write a stale receipt', async () => {
  const f=fixture(); const applyFenced=vi.fn()
  await expect(runSharedJob(f.pool,id,{ observe:async()=>{ f.flags.owned=false; return {state:'absent'} },applyFenced })).rejects.toThrow('shared_lease_lost')
  expect(applyFenced).not.toHaveBeenCalled(); expect(f.events).toEqual([]); expect(f.row.receipt).toBeUndefined()
})
it('never repeats a started effect whose readback is absent', async () => {
  const f=fixture(); f.row.journal={schemaVersion:1,job:f.job,attemptId:id,sequence:2,stage:'started'}
  const applyFenced=vi.fn()
  expect((await runSharedJob(f.pool,id,{ observe:async()=>({state:'absent'}),applyFenced })).state).toBe('needs_intervention')
  expect(applyFenced).not.toHaveBeenCalled(); expect(f.events).toEqual(['needs_intervention'])
})
it('quarantines adapter crash without claiming success', async () => {
  const f=fixture()
  await expect(runSharedJob(f.pool,id,{ observe:async()=>({state:'absent'}),applyFenced:async()=>{throw Error('worker_crash')} })).rejects.toThrow('worker_crash')
  expect(f.events).toEqual(['prepared','started','needs_intervention']); expect(f.row.state).toBe('needs_intervention'); expect(f.row.receipt).toBeUndefined()
})
it.each(['partial','unknown'])('quarantines %s observation without an effect', async state => {
  const f=fixture(), applyFenced=vi.fn()
  expect((await runSharedJob(f.pool,id,{observe:async()=>({state}),applyFenced})).state).toBe('needs_intervention')
  expect(applyFenced).not.toHaveBeenCalled(); expect(f.row.receipt).toBeUndefined()
})
it('never invokes an effect against a disabled binding', async () => {
  const f=fixture(); f.flags.enabled=false
  const observe=vi.fn(), applyFenced=vi.fn()
  await expect(runSharedJob(f.pool,id,{observe,applyFenced})).rejects.toThrow('tenant_unavailable')
  expect(observe).not.toHaveBeenCalled(); expect(applyFenced).not.toHaveBeenCalled()
})
it('rejects a foreign effect readback instead of persisting a verified receipt', async () => {
  const f=fixture(); let applied=false
  await expect(runSharedJob(f.pool,id,{observe:async()=>applied ? {...f.present,binding:{...f.job.binding,tenantId:'foreign'}} : {state:'absent'},applyFenced:async()=>{applied=true} })).rejects.toThrow('tenant_binding_mismatch')
  expect(f.row.receipt).toBeUndefined(); expect(f.row.state).toBe('needs_intervention')
})
it('expires shared leases to intervention, never back to queued', async () => {
  const query=vi.fn(async(_sql:string)=>({rowCount:2,rows:[]}))
  expect(await expireSharedLeases({query} as unknown as Pool)).toBe(2)
  const sql=query.mock.calls[0]?.[0] as string
  expect(sql).toContain("state='needs_intervention'")
  expect(sql).toContain('fence=fence+1')
  expect(sql).toContain('lease_until<=clock_timestamp()')
  expect(sql).not.toContain("state='queued'")
  expect(sql).toContain('INSERT INTO audit_events')
  expect(sql).toContain('shared_job.lease_expired')
})
it('rejects corrupted stored job digest before observing or applying effects', async () => {
  const f=fixture();f.row.payload_digest='0'.repeat(64)
  const observe=vi.fn(),applyFenced=vi.fn()
  await expect(runSharedJob(f.pool,id,{observe,applyFenced})).rejects.toThrow('shared_job_identity_corrupt')
  expect(observe).not.toHaveBeenCalled();expect(applyFenced).not.toHaveBeenCalled()
})
it('requires fresh matching readback inside completion instead of reusing an earlier observation', async () => {
  const f=fixture();let reads=0
  await expect(runSharedJob(f.pool,id,{observe:async()=>{reads++;return reads===1?{state:'absent'}:reads===2?f.present:{state:'unknown'}},applyFenced:async()=>{} })).rejects.toThrow('receipt_not_verified')
  expect(f.row.receipt).toBeUndefined();expect(f.row.state).toBe('needs_intervention')
})
it('recovers expired started work by readback only, without invoking an effect', async () => {
  const f=fixture();f.row.state='needs_intervention';f.row.attempt_id=id;f.row.journal={schemaVersion:1,job:f.job,attemptId:id,sequence:2,stage:'started'};f.row.attempt_id=id;f.row.fence=2
  const applyFenced=vi.fn()
  expect((await recoverSharedJob(f.pool,id,{issuer:'vendor',actorUid:7},'Inspect crashed worker',{observe:async()=>f.present,applyFenced})).state).toBe('verified')
  expect(applyFenced).not.toHaveBeenCalled();expect(f.row.receipt.binding).toEqual(f.job.binding)
})
it('keeps absent recovery quarantined without another creation', async () => {
  const f=fixture();f.row.state='needs_intervention';f.row.attempt_id=id;f.row.journal={schemaVersion:1,job:f.job,attemptId:id,sequence:2,stage:'started'}
  const applyFenced=vi.fn()
  expect((await recoverSharedJob(f.pool,id,{issuer:'vendor',actorUid:7},'Inspect absent effect',{observe:async()=>({state:'absent'}),applyFenced})).state).toBe('needs_intervention')
  expect(applyFenced).not.toHaveBeenCalled();expect(f.row.receipt).toBeUndefined()
})
it('keeps explicit intervention sticky even if a later readback looks verified', async () => {
  const f=fixture();f.row.state='needs_intervention';f.row.attempt_id=id;f.row.journal={schemaVersion:1,job:f.job,attemptId:id,sequence:3,stage:'needs_intervention'}
  const applyFenced=vi.fn()
  expect((await recoverSharedJob(f.pool,id,{issuer:'vendor',actorUid:7},'Inspect sticky intervention',{observe:async()=>f.present,applyFenced})).state).toBe('needs_intervention')
  expect(applyFenced).not.toHaveBeenCalled();expect(f.row.receipt).toBeUndefined()
})
it('rolls back verified event when completion CAS loses ownership', async () => {
  const f = fixture(); f.flags.rejectCompletion = true
  let applied = false
  await expect(runSharedJob(f.pool, id, {
    observe: async () => applied ? f.present : { state: 'absent' },
    applyFenced: async () => { applied = true },
  })).rejects.toThrow('shared_lease_lost')
  expect(f.events).toEqual(['prepared', 'started', 'needs_intervention'])
  expect(f.row.receipt).toBeUndefined()
  expect(f.row.journal.sequence).toBe(3)
})
it('checks current recovery authority before reading any external effect', async () => {
  const f = fixture(); f.row.state = 'needs_intervention'; f.flags.authorized = false
  const observe = vi.fn(), applyFenced = vi.fn()
  await expect(recoverSharedJob(f.pool, id, { issuer: 'vendor', actorUid: 7 }, 'Revoked operator', { observe, applyFenced })).rejects.toThrow('shared_job_forbidden')
  expect(observe).not.toHaveBeenCalled()
  expect(applyFenced).not.toHaveBeenCalled()
  expect(f.row.state).toBe('needs_intervention')
})
it('rejects disabled recovery binding before external observation', async () => {
  const f = fixture(); f.row.state = 'needs_intervention'; f.flags.enabled = false
  const observe = vi.fn(async () => f.present), applyFenced = vi.fn()
  await expect(recoverSharedJob(f.pool, id, { issuer: 'vendor', actorUid: 7 }, 'Disabled tenant recovery', { observe, applyFenced })).rejects.toThrow('tenant_unavailable')
  expect(observe).not.toHaveBeenCalled()
  expect(applyFenced).not.toHaveBeenCalled()
})
it('refuses another operation when a tenant has unresolved work', async () => {
  const f = fixture(); f.flags.unresolved = true
  const observe = vi.fn(), applyFenced = vi.fn()
  await expect(runSharedJob(f.pool,id,{observe,applyFenced})).rejects.toThrow('shared_reconciliation_required')
  expect(f.row.state).toBe('queued'); expect(observe).not.toHaveBeenCalled()
})
it('never certifies an effect after registry revision changes', async () => {
  const f = fixture()
  await expect(runSharedJob(f.pool,id,{observe:async()=>({state:'absent'}),applyFenced:async()=>{f.flags.registryRevision=2}})).rejects.toThrow('tenant_binding_mismatch')
  expect(f.row.receipt).toBeUndefined()
  expect(f.events).toEqual(['prepared','started'])
})
it('refuses recovery journal belonging to a different attempt before observation', async () => {
  const f=fixture(); f.row.state='needs_intervention'; f.row.attempt_id='687674dc-5789-4a99-b151-12d69f010cc3'
  f.row.journal={schemaVersion:1,job:f.job,attemptId:id,sequence:2,stage:'started'}
  const observe=vi.fn(async()=>f.present), applyFenced=vi.fn()
  await expect(recoverSharedJob(f.pool,id,{issuer:'vendor',actorUid:7},'Inspect corrupt attempt',{observe,applyFenced})).rejects.toThrow('shared_job_identity_corrupt')
  expect(observe).not.toHaveBeenCalled()
})
it('validates queued journal identity before claiming or observing', async () => {
  const f=fixture()
  f.row.journal={schemaVersion:1,job:{...f.job,binding:{...f.job.binding,tenantId:'foreign'}},attemptId:id,sequence:2,stage:'started'}
  const observe=vi.fn(async()=>({state:'absent'})),applyFenced=vi.fn()
  await expect(runSharedJob(f.pool,id,{observe,applyFenced})).rejects.toThrow('tenant_binding_mismatch')
  expect(observe).not.toHaveBeenCalled()
  expect(f.row.state).toBe('queued')
  expect(f.row.fence).toBe(0)
})
it.each([String(Number.MAX_SAFE_INTEGER), '9007199254740993', '-1', 'not-a-fence'])('refuses unsafe stored fence %s before claiming', async fence => {
  const f=fixture(); f.row.fence=fence
  const observe=vi.fn(),applyFenced=vi.fn()
  await expect(runSharedJob(f.pool,id,{observe,applyFenced})).rejects.toThrow('shared_fence_invalid')
  expect(f.row.state).toBe('queued')
  expect(observe).not.toHaveBeenCalled()
})
it.each(['9007199254740993','-1','invalid'])('rejects unsafe recovery fence %s before observation', async fence => {
  const f=fixture(); f.row.state='needs_intervention'; f.row.fence=fence
  const observe=vi.fn(async()=>f.present),applyFenced=vi.fn()
  await expect(recoverSharedJob(f.pool,id,{issuer:'vendor',actorUid:7},'Check recovery fence',{observe,applyFenced})).rejects.toThrow('shared_fence_invalid')
  expect(observe).not.toHaveBeenCalled()
})
it.each(['absent','unknown','present'])('keeps claim-before-intent crash quarantined for %s readback', async state => {
  const f=fixture(); f.row.state='needs_intervention'; f.row.attempt_id=id; f.row.journal=null
  const applyFenced=vi.fn()
  const result=await recoverSharedJob(f.pool,id,{issuer:'vendor',actorUid:7},'Crash before prepared intent',{
    observe:async()=>state==='present'?f.present:{state},applyFenced,
  })
  expect(result.state).toBe('needs_intervention')
  expect(f.row.journal).toBeNull(); expect(f.row.receipt).toBeUndefined()
  expect(f.events).toEqual([]); expect(applyFenced).not.toHaveBeenCalled()
})
it('rejects malformed journal before external recovery observation', async () => {
  const f=fixture(); f.row.state='needs_intervention'; f.row.attempt_id=id
  f.row.journal={attemptId:id,sequence:'invalid'}
  const observe=vi.fn(),applyFenced=vi.fn()
  await expect(recoverSharedJob(f.pool,id,{issuer:'vendor',actorUid:7},'Inspect malformed journal',{observe,applyFenced})).rejects.toThrow()
  expect(observe).not.toHaveBeenCalled();expect(applyFenced).not.toHaveBeenCalled()
  expect(f.row.receipt).toBeUndefined()
})
it('rechecks ownership and authority after claim commit before first observation', async () => {
  const f=fixture();f.flags.revokeAfterClaim=true
  const observe=vi.fn(async()=>({state:'absent'})),applyFenced=vi.fn()
  await expect(runSharedJob(f.pool,id,{observe,applyFenced})).rejects.toThrow('shared_job_forbidden')
  expect(observe).not.toHaveBeenCalled();expect(applyFenced).not.toHaveBeenCalled()
  expect(f.row.receipt).toBeUndefined()
})
it('refuses exhausted journal sequence before appending an event', async () => {
  const f=fixture();f.row.journal={schemaVersion:1,job:f.job,attemptId:id,sequence:Number.MAX_SAFE_INTEGER,stage:'prepared'}
  const applyFenced=vi.fn()
  await expect(runSharedJob(f.pool,id,{observe:async()=>({state:'absent'}),applyFenced})).rejects.toThrow('shared_sequence_invalid')
  expect(f.events).toEqual([]);expect(applyFenced).not.toHaveBeenCalled()
})
it.each(['run','recover'])('keeps persisted restore unavailable at %s boundary without durable approval authority', async mode => {
  const f=fixture()
  const job={schemaVersion:1,operation:'restore',requestId:id,binding:f.job.binding,approvalId:id,
    backup:{schemaVersion:1,backupId:id,binding:f.job.binding,databaseSha256:'a'.repeat(64),filestoreSha256:'b'.repeat(64),consistency:'verified'}}
  f.row.payload=job;f.row.business_key=businessKey(job);f.row.payload_digest=payloadDigest(job)
  if(mode==='recover') {f.row.state='needs_intervention';f.row.attempt_id=id;f.row.journal={schemaVersion:1,job,attemptId:id,sequence:2,stage:'started'}}
  const observe=vi.fn(async()=>({state:'absent'})),applyFenced=vi.fn()
  const action=mode==='run'?runSharedJob(f.pool,id,{observe,applyFenced}):recoverSharedJob(f.pool,id,{issuer:'vendor',actorUid:7},'Inspect unsupported restore',{observe,applyFenced})
  await expect(action).rejects.toThrow('shared_restore_authority_unavailable')
  expect(observe).not.toHaveBeenCalled();expect(applyFenced).not.toHaveBeenCalled();expect(f.row.receipt).toBeUndefined()
})
it('rolls back recovery verified event when completion CAS fails', async () => {
  const f=fixture();f.row.state='needs_intervention';f.row.attempt_id=id;f.flags.rejectCompletion=true
  f.row.journal={schemaVersion:1,job:f.job,attemptId:id,sequence:2,stage:'started'}
  const applyFenced=vi.fn()
  await expect(recoverSharedJob(f.pool,id,{issuer:'vendor',actorUid:7},'Recovery CAS failure',{observe:async()=>f.present,applyFenced})).rejects.toThrow('shared_lease_lost')
  expect(f.row.state).toBe('needs_intervention')
  expect(f.row.journal.sequence).toBe(2)
  expect(f.row.journal.stage).toBe('started')
  expect(f.events).toEqual([])
  expect(f.row.receipt).toBeUndefined()
  expect(applyFenced).not.toHaveBeenCalled()
})
it('does not repeat a committed effect when verified commit acknowledgement is lost', async () => {
  const f=fixture();f.flags.loseVerifiedCommitAck=true
  let effects=0
  const adapter={observe:async()=>effects?f.present:{state:'absent'},applyFenced:async()=>{effects++}}
  await expect(runSharedJob(f.pool,id,adapter)).rejects.toThrow('connection_lost_after_verified_commit')
  expect(f.row.state).toBe('verified');expect(f.row.receipt).toBeDefined()
  expect(f.events).toEqual(['prepared','started','verified'])
  await expect(runSharedJob(f.pool,id,adapter)).rejects.toThrow('shared_job_not_claimable')
  expect(effects).toBe(1)
})
it('performs all execution observations outside control-plane transactions', async () => {
  const f=fixture();let effects=0
  const result=await runSharedJob(f.pool,id,{
    observe:async()=>{expect(f.inTransaction()).toBe(false);return effects?f.present:{state:'absent'}},
    applyFenced:async()=>{effects++},
  })
  expect(result.state).toBe('verified');expect(effects).toBe(1)
})
it('observes recovery outside transactions and rechecks fencing after readback', async () => {
  const f=fixture();f.row.state='needs_intervention';f.row.attempt_id=id
  f.row.journal={schemaVersion:1,job:f.job,attemptId:id,sequence:2,stage:'started'}
  let reads=0
  await expect(recoverSharedJob(f.pool,id,{issuer:'vendor',actorUid:7},'Recovery fencing race',{
    observe:async()=>{expect(f.inTransaction()).toBe(false);if(++reads===2)f.row.fence++;return f.present},applyFenced:vi.fn(),
  })).rejects.toThrow('shared_lease_lost')
  expect(f.events).toEqual([]);expect(f.row.receipt).toBeUndefined()
})
it.each(['authority','binding','journal','attempt'])('rejects recovery %s changes during unlocked observation', async change => {
  const f=fixture();f.row.state='needs_intervention';f.row.attempt_id=id
  f.row.journal={schemaVersion:1,job:f.job,attemptId:id,sequence:2,stage:'started'}
  let reads=0
  const applyFenced=vi.fn()
  await expect(recoverSharedJob(f.pool,id,{issuer:'vendor',actorUid:7},'Concurrent recovery change',{
    observe:async()=>{
      expect(f.inTransaction()).toBe(false)
      if(++reads===2){
        if(change==='authority')f.flags.authorized=false
        if(change==='binding')f.flags.registryRevision++
        if(change==='journal')f.row.journal={...f.row.journal,sequence:3}
        if(change==='attempt')f.row.attempt_id='81e71f13-a412-4d5d-b230-c6cd1dd45d35'
      }
      return f.present
    },applyFenced,
  })).rejects.toThrow()
  expect(f.events).toEqual([]);expect(f.row.receipt).toBeUndefined()
  expect(f.row.state).toBe('needs_intervention');expect(applyFenced).not.toHaveBeenCalled()
})
it.each(['absent','unknown','partial','foreign'])('refuses recovery success when second observation becomes %s', async state => {
  const f=fixture();f.row.state='needs_intervention';f.row.attempt_id=id
  f.row.journal={schemaVersion:1,job:f.job,attemptId:id,sequence:2,stage:'started'}
  let reads=0
  const applyFenced=vi.fn()
  await expect(recoverSharedJob(f.pool,id,{issuer:'vendor',actorUid:7},'Readback changed',{
    observe:async()=>++reads===1?f.present:state==='foreign'?{...f.present,binding:{...f.job.binding,tenantId:'foreign'}}:{state},applyFenced,
  })).rejects.toThrow()
  expect(reads).toBe(2);expect(f.events).toEqual([]);expect(f.row.receipt).toBeUndefined()
  expect(f.row.state).toBe('needs_intervention');expect(applyFenced).not.toHaveBeenCalled()
})
it('refuses before storage or claim when no trusted fenced effect adapter exists', async () => {
  const connect = vi.fn()
  await expect(runSharedJob({ connect } as unknown as Pool, 'ad03d956-efef-4f80-baf3-9c23ea46e945')).rejects.toThrow('shared_adapter_unavailable')
  expect(connect).not.toHaveBeenCalled()
})
