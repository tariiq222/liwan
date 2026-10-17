import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, mkdirSync, existsSync, readdirSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readReleaseRoute, selectReleaseRoute, withReleaseLease, createReleaseLease, currentReleaseWrite } from '../../apps/web/server/utils/releaseRouting.ts'

function fixture() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'webvue-release-')))
  const tenant = { tenantId: 'tenant_a', registryRevision: 1 }
  const route = { schemaVersion: 1, tenantId: 'tenant_a', identityRevision: 1, routeRevision: 1, releaseId: 'r1', poolId: 'blue', fence: 1, state: 'serving' }
  const pools = { blue: { poolId: 'blue', releaseId: 'r1', odooUrl: 'http://odoo-blue:8069', webUrl: 'http://web-blue:3000', wsUrl: 'http://odoo-blue:8072', aiUrl: 'http://ai-blue:8600', aiStateVersion: '1' }, green: { poolId: 'green', releaseId: 'r2', odooUrl: 'http://odoo-green:8069', webUrl: 'http://web-green:3000', wsUrl: 'http://odoo-green:8072' } }
  writeFileSync(join(root, 'tenant_a.json'), JSON.stringify(route))
  writeFileSync(join(root, 'pools.json'), JSON.stringify({ schemaVersion: 1, pools }))
  return { root, tenant, route, pools }
}
test('release cutover preserves identity and allows admitted prior request until drained', () => {
  const f = fixture()
  const next = { ...f.route, routeRevision: 2, releaseId: 'r2', poolId: 'green', fence: 2, draining: [{ releaseId: 'r1', poolId: 'blue', routeRevision: 1, fence: 1 }] }
  writeFileSync(join(f.root, 'tenant_a.json'), JSON.stringify(next))
  assert.equal(selectReleaseRoute(f.tenant, readReleaseRoute(f.root, 'tenant_a'), f.pools).poolId, 'green')
  assert.equal(selectReleaseRoute(f.tenant, next, f.pools, { poolId: 'blue', routeRevision: 1, fence: 1 }).poolId, 'blue')
  assert.equal(next.identityRevision, 1)
  assert.throws(() => selectReleaseRoute(f.tenant, { ...next, draining: [] }, f.pools, { poolId: 'blue', routeRevision: 1, fence: 1 }))
  assert.throws(() => selectReleaseRoute(f.tenant, next, f.pools, { poolId: 'outside', routeRevision: 1, fence: 1 }))
})
test('maintenance and malformed target deny that tenant without global publication barrier', () => {
  const f = fixture()
  writeFileSync(join(f.root, 'tenant_b.json'), JSON.stringify({ ...f.route, tenantId: 'tenant_b' }))
  writeFileSync(join(f.root, 'tenant_a.maintenance'), '{}')
  assert.throws(() => readReleaseRoute(f.root, 'tenant_a'), e => e.statusCode === 503)
  assert.equal(readReleaseRoute(f.root, 'tenant_b').poolId, 'blue')
  assert.equal(existsSync(join(f.root, '.pending')), false)
  assert.throws(() => readReleaseRoute(f.root, '../tenant_b'))
})
test('durable write lease blocks maintenance race and is released after action settles', async () => {
  const f = fixture()
  let done
  const pending = withReleaseLease(f.root, f.tenant, { poolId: 'blue', routeRevision: 1, fence: 1 }, async () => {
    assert.equal(readdirSync(join(f.root, 'leases/tenant_a')).length, 1)
    await new Promise(resolve => { done = resolve })
    return 'committed'
  })
  assert.equal(readdirSync(join(f.root, 'leases/tenant_a')).length, 1)
  done()
  assert.equal(await pending, 'committed')
  assert.equal(readdirSync(join(f.root, 'leases/tenant_a')).length, 0)
  writeFileSync(join(f.root, 'tenant_a.maintenance'), '{}')
  let executed = false
  await assert.rejects(withReleaseLease(f.root, f.tenant, { poolId: 'blue', routeRevision: 1, fence: 1 }, async () => { executed = true }))
  assert.equal(executed, false)
})

test('admitted continuation survives retirement and shielded dispatch uses its own child lease', async () => {
  const f=fixture()
  const pin={poolId:'blue',routeRevision:1,fence:1}
  const outer=createReleaseLease(f.root,f.tenant,pin)
  writeFileSync(join(f.root,'tenant_a.json'),JSON.stringify({...f.route,routeRevision:2,fence:2,poolId:'green',releaseId:'r2',draining:[{...pin,releaseId:'r1'}]}))
  writeFileSync(join(f.root,'tenant_a.blue.1.retired'),'{}')
  assert.throws(()=>createReleaseLease(f.root,f.tenant,pin))
  await withReleaseLease(f.root,f.tenant,pin,async()=>{
    const writing=currentReleaseWrite()
    assert.ok(writing.admissionId && writing.admissionId!==outer.context.admissionId)
    outer.release() // browser disconnect; the claimed write still owns its child lease.
    const dispatched=createReleaseLease(f.root,f.tenant,pin,'http',writing.admissionId)
    dispatched.release()
  },outer.context.admissionId)
  assert.equal(currentReleaseWrite(),undefined)
  assert.equal(readdirSync(join(f.root,'leases/tenant_a')).length,0)
  assert.throws(()=>createReleaseLease(f.root,f.tenant,pin,'http',outer.context.admissionId))
})
