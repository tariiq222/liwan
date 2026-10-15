import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Pool } from 'pg'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { vendorSession } from './helpers/vendor-session.js'
import { migrate } from '../db.js'
import { createApp } from '../http.js'
import { claimNext, executeClaimed, expireLeases, finishClaim } from '../worker.js'

const url = process.env.CONTROL_TEST_DATABASE_URL
if (url) {
  const parsed = new URL(url)
  if (!['127.0.0.1','localhost','::1'].includes(parsed.hostname) || !/^nasq_control_scratch_[a-z0-9]+$/.test(parsed.pathname.slice(1))) throw new Error('CONTROL_TEST_DATABASE_URL must select a unique loopback nasq_control_scratch database')
}
if (!url) describe.skip('control-plane PostgreSQL integration (requires CONTROL_TEST_DATABASE_URL)', () => {})
else describe('control-plane PostgreSQL integration', () => {
  const pool = new Pool({ connectionString: url })
  const key = 'test-key-'.repeat(8)
  const repositoryRoot = fileURLToPath(new URL('../../../../', import.meta.url))
  const config = { installationId: 'vendor-scratch', key, inventoryPath: '', repositoryRoot, python: 'python3', stateDir: '/nonexistent-state' }
  let server: ReturnType<ReturnType<typeof createApp>['listen']>
  let origin: string
  let fixtureDir: string
  let s7: Awaited<ReturnType<typeof vendorSession>>
  let s8: Awaited<ReturnType<typeof vendorSession>>

  beforeAll(async () => {
    await migrate(pool)
    await pool.query('TRUNCATE tenants, package_revisions, commercial_packages, catalog_entries CASCADE')
    await pool.query('DELETE FROM vendor_memberships')
    fixtureDir = await mkdtemp(join(tmpdir(), 'nasq-control-test-'))
    const classification = join(fixtureDir, 'classification.json')
    await writeFile(classification, JSON.stringify({ schema_version:1,database:'scratch_control_a',commercial_mode:'saas',entitlement_source:'control_plane',expected_valid_until:null,valid_until_action:'preserve' }))
    const classification2 = join(fixtureDir, 'classification-two.json')
    await writeFile(classification2, JSON.stringify({ schema_version:1,database:'scratch_control_b',commercial_mode:'saas',entitlement_source:'control_plane',expected_valid_until:null,valid_until_action:'preserve' }))
    config.inventoryPath = join(fixtureDir, 'inventory.json')
    await writeFile(config.inventoryPath, JSON.stringify({ version:2,targets:{'scratch-one':{database:'scratch_control_a',kind:'scratch',classification_file:classification},'scratch-two':{database:'scratch_control_b',kind:'scratch',classification_file:classification2}} }))
    const source = await readFile(join(repositoryRoot, 'deploy/catalog/solutions/platform.json'))
    await pool.query('INSERT INTO catalog_entries(id,version,status,solution,source_sha256,published_at) VALUES($1,$2,$3,$4,$5,now())', [crypto.randomUUID(),'test-v1','published',JSON.parse(source.toString('utf8')),createHash('sha256').update(source).digest('hex')])
    s7 = await vendorSession(pool, config.installationId, ['vendor.read','vendor.tenants.manage','vendor.operations.run'])
    server = createApp(pool, config).listen(0, '127.0.0.1')
    await new Promise<void>((resolve) => server.once('listening', resolve))
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('missing address')
    origin = `http://127.0.0.1:${address.port}`
  })
  afterAll(async () => { await new Promise<void>((resolve) => server.close(() => resolve())); await pool.end(); await rm(fixtureDir, { recursive:true, force:true }) })

  async function call(method: string, path: string, body = '', nonce?: string, session = s7) {
    const headers = session.headers(method, path, body, nonce)
    return fetch(origin + path, { method, headers: { ...headers, 'content-type': 'application/json' }, body: body || undefined })
  }

  it('requires a valid signature, stores nonce, and denies replay', async () => {
    expect((await fetch(origin + '/v1/context')).status).toBe(401)
    const noMembership = await vendorSession(pool, config.installationId, [])
    await pool.query('DELETE FROM vendor_memberships WHERE actor_uid=$1', [noMembership.accountId])
    const nonce = crypto.randomUUID()
    expect((await call('GET','/v1/context','',nonce)).status).toBe(200)
    expect((await call('GET','/v1/context','',nonce)).status).toBe(401)
    expect((await call('GET','/v1/context','',undefined,noMembership)).status).toBe(403)
    const other = (await vendorSession(pool, 'wrong-installation', ['vendor.read'])).headers('GET','/v1/context')
    expect((await fetch(origin+'/v1/context',{headers:other})).status).toBe(401)
  })

  it('revocation denies the next signed request', async () => {
    await pool.query('UPDATE vendor_memberships SET revoked_at = now() WHERE issuer=$1 AND actor_uid=$2', [config.installationId, s7.accountId])
    expect((await call('GET','/v1/context')).status).toBe(403)
    await pool.query('UPDATE vendor_memberships SET revoked_at = NULL WHERE issuer=$1 AND actor_uid=$2', [config.installationId, s7.accountId])
  })

  it('registers tenant and durably deduplicates queued operation by actor, tenant and payload', async () => {
    const create = JSON.stringify({ name: 'Scratch', commercial_mode: 'saas', hosting_model: 'managed', inventory_target: 'scratch-one', catalog_version:'test-v1',catalog_tier:'core',reason: 'Register scratch' })
    const created = await call('POST','/v1/tenants',create)
    expect(created.status).toBe(201)
    const tenant = await created.json() as { id: string }
    const request_id = crypto.randomUUID()
    const operation = JSON.stringify({ type: 'tenant.create', request_id, reason: 'Provision now' })
    const first = await call('POST',`/v1/tenants/${tenant.id}/operations`,operation)
    expect(first.status).toBe(202)
    const firstBody = await first.json() as { id: string; status: string }
    expect(firstBody.status).toBe('queued')
    const second = await call('POST',`/v1/tenants/${tenant.id}/operations`,operation)
    expect(second.status).toBe(200)
    expect((await second.json() as {id:string}).id).toBe(firstBody.id)
    const changed = await call('POST',`/v1/tenants/${tenant.id}/operations`,JSON.stringify({ type:'tenant.create', request_id, reason:'Different' }))
    expect(changed.status).toBe(409)
    const result = await pool.query('SELECT count(*)::int AS count FROM operations WHERE tenant_id=$1', [tenant.id])
    expect(result.rows[0].count).toBe(1)
  })

  it('rejects tenant classification mismatch before registration', async () => {
    const body = JSON.stringify({ name:'Wrong', commercial_mode:'non_saas', hosting_model:'managed', inventory_target:'scratch-two', reason:'Registration' })
    expect((await call('POST','/v1/tenants',body)).status).toBe(422)
  })

  it('rejects a globally reused request ID across actors without exposing the original', async () => {
    const row = await pool.query("SELECT tenant_id,request_id FROM operations WHERE type='tenant.create' LIMIT 1")
    s8 = await vendorSession(pool, config.installationId, ['vendor.operations.run'])
    const body = JSON.stringify({type:'tenant.create',request_id:row.rows[0].request_id,reason:'Another actor'})
    const response = await call('POST',`/v1/tenants/${row.rows[0].tenant_id}/operations`,body,undefined,s8)
    expect(response.status).toBe(409)
    expect(JSON.stringify(await response.json())).not.toContain(row.rows[0].tenant_id)
  })

  it('rechecks the grant immediately before worker execution', async () => {
    const claim = await claimNext(pool)
    expect(claim).not.toBeNull()
    await pool.query('UPDATE vendor_memberships SET revoked_at=now() WHERE issuer=$1 AND actor_uid=$2', [config.installationId, s7.accountId])
    await executeClaimed(pool, claim!, config)
    const row = await pool.query('SELECT status,stage FROM operations WHERE id=$1', [claim!.operation.id])
    expect(row.rows[0]).toEqual({ status:'failed', stage:'grant_revoked' })
    await pool.query('UPDATE vendor_memberships SET revoked_at=NULL WHERE issuer=$1 AND actor_uid=$2', [config.installationId, s7.accountId])
  })

  it('never records a late worker success after its mutation lease expires', async () => {
    const tenant = await pool.query("SELECT id FROM tenants WHERE inventory_target='scratch-one'")
    const operation = JSON.stringify({ type:'tenant.create', request_id:crypto.randomUUID(), reason:'Try again' })
    expect((await call('POST',`/v1/tenants/${tenant.rows[0].id}/operations`,operation)).status).toBe(202)
    const claim = await claimNext(pool)
    expect(claim).not.toBeNull()
    await pool.query("UPDATE operations SET lease_until=now()-interval '1 second' WHERE id=$1", [claim!.operation.id])
    expect(await expireLeases(pool)).toBe(1)
    expect(await finishClaim(pool,claim!,'succeeded','health_verified',{status:'ok'},{'users.limit':null})).toBe(false)
    const row = await pool.query('SELECT status FROM operations WHERE id=$1', [claim!.operation.id])
    expect(row.rows[0].status).toBe('needs_intervention')
    await claim!.client.query('SELECT pg_advisory_unlock(hashtext($1))', [claim!.lockKey])
    claim!.client.release()
  })

  it('blocks new and previously queued mutations after an unresolved lease', async () => {
    const tenant = await pool.query("SELECT id FROM tenants WHERE inventory_target='scratch-one'")
    const id = tenant.rows[0].id
    const body = JSON.stringify({type:'backup',request_id:crypto.randomUUID(),reason:'Blocked backup'})
    const response = await call('POST',`/v1/tenants/${id}/operations`,body)
    expect(response.status).toBe(409)
    expect((await response.json() as {code:string}).code).toBe('reconciliation_required')
    const queuedId = crypto.randomUUID()
    await pool.query("INSERT INTO operations(id,tenant_id,actor_uid,issuer,type,request_id,reason,payload,payload_digest) VALUES($1,$2,$5,$3,'backup',$4,'Already queued','{}','queued-before-intervention')", [queuedId,id,config.installationId,crypto.randomUUID(),s7.accountId])
    const claimed = await claimNext(pool)
    expect(claimed).toBeNull()
    const blocked = await pool.query('SELECT status,stage FROM operations WHERE id=$1',[queuedId])
    expect(blocked.rows[0]).toEqual({status:'failed',stage:'reconciliation_required'})
  })

  it('persists an inspected feature map directly with its revision', async () => {
    const tenant = await pool.query("SELECT id FROM tenants WHERE inventory_target='scratch-one'")
    const body = JSON.stringify({ type:'tenant.inspect',request_id:crypto.randomUUID(),reason:'Inspect current policy' })
    expect((await call('POST',`/v1/tenants/${tenant.rows[0].id}/operations`,body)).status).toBe(202)
    const claim = await claimNext(pool)
    expect(claim).not.toBeNull()
    const features = { 'users.limit':10,'storage.limit_mb':null }
    expect(await finishClaim(pool,claim!,'succeeded','snapshot',{policy_revision:4},undefined,features)).toBe(true)
    const row = await pool.query('SELECT observed_policy,policy_revision FROM tenants WHERE id=$1',[tenant.rows[0].id])
    expect(row.rows[0]).toEqual({observed_policy:features,policy_revision:4})
    await claim!.client.query('SELECT pg_advisory_unlock(hashtext($1))', [claim!.lockKey])
    claim!.client.release()
  })

  it('fails closed for incomplete create without the trusted scratch lane marker', async () => {
    const tenant = await pool.query("SELECT id FROM tenants WHERE inventory_target='scratch-one' LIMIT 1")
    expect(tenant.rowCount).toBe(1)
    await pool.query(`INSERT INTO operations(id,tenant_id,actor_uid,issuer,type,request_id,reason,payload,payload_digest,status,stage,result)
      VALUES($1,$2,$6,$3,'tenant.create',$4,'Markerless incomplete create','{}','markerless-fixture','needs_intervention','deployment_incomplete',$5)`, [
      crypto.randomUUID(), tenant.rows[0].id, config.installationId, crypto.randomUUID(),
      {status:'ok',policy_verified:true,deployment_ready:false}, s7.accountId,
    ])

    const blocked = await call('POST',`/v1/tenants/${tenant.rows[0].id}/operations`,JSON.stringify({type:'backup',request_id:crypto.randomUUID(),reason:'Markerless result stays unresolved'}))
    expect(blocked.status).toBe(409)
    expect((await blocked.json() as {code:string}).code).toBe('reconciliation_required')
  })

  it('retains verified desired and observed policy after incomplete create without activating tenant', async () => {
    const create = JSON.stringify({name:'Second scratch',commercial_mode:'saas',hosting_model:'managed',inventory_target:'scratch-two',catalog_version:'test-v1',catalog_tier:'core',reason:'Register scratch'})
    const tenant = await (await call('POST','/v1/tenants',create)).json() as {id:string}
    const body = JSON.stringify({type:'tenant.create',request_id:crypto.randomUUID(),reason:'Provision scratch'})
    expect((await call('POST',`/v1/tenants/${tenant.id}/operations`,body)).status).toBe(202)
    const claim = await claimNext(pool)
    expect(claim).not.toBeNull()
    const features = {'users.limit':null,'storage.limit_mb':null}
    expect(await finishClaim(pool,claim!,'needs_intervention','deployment_incomplete',{status:'ok',policy_revision:1,policy_verified:true,deployment_ready:false,_control_lane:'scratch'},features,features)).toBe(true)
    const row = await pool.query('SELECT status,desired_policy,observed_policy,policy_revision FROM tenants WHERE id=$1',[tenant.id])
    expect(row.rows[0]).toEqual({status:'needs_intervention',desired_policy:features,observed_policy:features,policy_revision:1})
    await claim!.client.query('SELECT pg_advisory_unlock(hashtext($1))', [claim!.lockKey])
    claim!.client.release()
    const prior = await pool.query("SELECT request_id FROM operations WHERE tenant_id<>$1 ORDER BY created_at LIMIT 1",[tenant.id])
    expect((await call('POST',`/v1/tenants/${tenant.id}/operations`,JSON.stringify({type:'backup',request_id:prior.rows[0].request_id,reason:'Cross tenant request'}))).status).toBe(409)
    expect((await call('POST',`/v1/tenants/${tenant.id}/operations`,JSON.stringify({type:'backup',request_id:crypto.randomUUID(),reason:'Known database-ready state'}))).status).toBe(202)
  })
})
