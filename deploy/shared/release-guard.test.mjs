import { test } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { mkdtempSync, writeFileSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createGuard, sessionCodec } from './guard.mjs'
const token = 'release-proxy-token-'.repeat(3)
const keys = { first: 'release-session-key-'.repeat(3) }
const listen = s => new Promise(resolve => s.listen(0, '127.0.0.1', () => resolve(`http://127.0.0.1:${s.address().port}`)))
const call = (base, path, headers, method = 'GET') => new Promise((resolve, reject) => { const req = http.request(new URL(path, base), { method, headers }, res => { let body = ''; res.on('data', b => { body += b }); res.on('end', () => resolve({ status: res.statusCode, body })) }); req.on('error', reject); req.end() })
test('actual release routing keeps an old BFF request pinned across online cutover and fences it after drain', async t => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'liwan-release-http-')))
  const tenant = { tenantId: 'tenant_a', host: 'a.example.test', database: 'db_a', filestore: 'db_a', enabled: true, registryRevision: 1 }
  writeFileSync(join(root, 'registry.json'), JSON.stringify({ schemaVersion: 1, snapshotRevision: 1, targets: [tenant] }))
  const blue = http.createServer((req, res) => res.end('blue'))
  const green = http.createServer((req, res) => res.end('green'))
  const blueUrl = await listen(blue); const greenUrl = await listen(green)
  const pools = { blue: { poolId: 'blue', releaseId: 'r1', odooUrl: blueUrl, webUrl: blueUrl, wsUrl: blueUrl }, green: { poolId: 'green', releaseId: 'r2', odooUrl: greenUrl, webUrl: greenUrl, wsUrl: greenUrl } }
  writeFileSync(join(root, 'pools.json'), JSON.stringify({ schemaVersion: 1, pools }))
  const initial = { schemaVersion: 1, tenantId: 'tenant_a', identityRevision: 1, routeRevision: 1, releaseId: 'r1', poolId: 'blue', fence: 1, state: 'serving' }
  writeFileSync(join(root, 'tenant_a.json'), JSON.stringify(initial))
  const guard = createGuard({ registryPath: join(root, 'registry.json'), proxyToken: token, keys, activeKid: 'first', odooUrl: blueUrl, webUrl: blueUrl, releaseRoutesDir: root })
  const base = await listen(guard)
  t.after(() => { for (const server of [guard, blue, green]) { server.closeAllConnections(); server.close() } })
  const cookie = `session_id=${sessionCodec(keys, 'first').seal('same_session', tenant)}`
  assert.equal((await call(base, '/api/v1/me', { host: tenant.host, cookie })).body, 'blue')
  const next = { ...initial, routeRevision: 2, releaseId: 'r2', poolId: 'green', fence: 2, draining: [{ releaseId: 'r1', poolId: 'blue', routeRevision: 1, fence: 1 }] }
  writeFileSync(join(root, 'tenant_a.json'), JSON.stringify(next))
  assert.equal((await call(base, '/api/v1/me', { host: tenant.host, cookie })).body, 'green')
  const pinned = { host: tenant.host, cookie, 'x-liwan-proxy-token': token, 'x-liwan-tenant-revision': '1', 'x-liwan-release-pool': 'blue', 'x-liwan-release-revision': '1', 'x-liwan-release-fence': '1' }
  assert.equal((await call(base, '/api/v1/me', pinned)).body, 'blue')
  writeFileSync(join(root, 'tenant_a.json'), JSON.stringify({ ...next, draining: [] }))
  assert.equal((await call(base, '/api/v1/me', pinned)).status, 503)
  assert.equal((await call(base, '/api/v1/me', { host: tenant.host, 'x-liwan-release-pool': 'blue' })).status, 403)
  writeFileSync(join(root, 'tenant_a.maintenance'), '{}')
  assert.equal((await call(base, '/api/v1/me', { host: tenant.host, cookie })).status, 503)
})

test('a shielded old write finishes through its child lease after the browser disconnects during retirement', async t => {
  const { createReleaseLease, withReleaseLease, currentReleaseWrite } = await import('../../apps/web/server/utils/releaseRouting.ts')
  const { existsSync } = await import('node:fs')
  const root=realpathSync(mkdtempSync(join(tmpdir(),'liwan-release-shield-')))
  const tenant={tenantId:'tenant_a',host:'a.example.test',database:'db_a',filestore:'db_a',enabled:true,registryRevision:1}
  writeFileSync(join(root,'registry.json'),JSON.stringify({schemaVersion:1,snapshotRevision:1,targets:[tenant]}))
  const old={schemaVersion:1,tenantId:'tenant_a',identityRevision:1,routeRevision:1,releaseId:'r1',poolId:'blue',fence:1,state:'serving'}
  writeFileSync(join(root,'tenant_a.json'),JSON.stringify(old))
  let commits=0, entered, continueOld, childEntered, continueChild, finish
  const ready=new Promise(resolve=>{entered=resolve}), childReady=new Promise(resolve=>{childEntered=resolve})
  const paused=new Promise(resolve=>{continueOld=resolve}), childPaused=new Promise(resolve=>{continueChild=resolve})
  const done=new Promise(resolve=>{finish=resolve})
  let base, parentAdmission
  const odoo=http.createServer((req,res)=>{commits++;res.end('committed')})
  const odooUrl=await listen(odoo)
  const web=http.createServer(async(req,res)=>{
    try {
      parentAdmission=req.headers['x-liwan-release-admission'];entered();await paused
      const pin={poolId:'blue',routeRevision:1,fence:1}
      await withReleaseLease(root,tenant,pin,async()=>{
        const child=currentReleaseWrite();childEntered();await childPaused
        const result=await call(base,'/api/v1/write',{host:tenant.host,'x-liwan-proxy-token':token,'x-liwan-tenant-revision':'1','x-liwan-release-pool':'blue','x-liwan-release-revision':'1','x-liwan-release-fence':'1','x-liwan-release-admission':child.admissionId},'POST')
        assert.equal(result.status,200);assert.equal(result.body,'committed')
      },parentAdmission)
      res.end('finished');finish()
    }catch(error){finish(error);res.end('failed')}
  })
  const webUrl=await listen(web)
  const pools={blue:{poolId:'blue',releaseId:'r1',odooUrl,webUrl,wsUrl:odooUrl},green:{poolId:'green',releaseId:'r2',odooUrl,webUrl,wsUrl:odooUrl}}
  writeFileSync(join(root,'pools.json'),JSON.stringify({schemaVersion:1,pools}))
  const guard=createGuard({registryPath:join(root,'registry.json'),proxyToken:token,keys,activeKid:'first',odooUrl,webUrl,releaseRoutesDir:root})
  base=await listen(guard)
  t.after(()=>{for(const server of [guard,odoo,web]){server.closeAllConnections();server.close()}})
  const browser=http.get(new URL('/slow',base),{headers:{host:tenant.host}})
  browser.on('error',()=>{})
  await ready
  writeFileSync(join(root,'tenant_a.json'),JSON.stringify({...old,poolId:'green',releaseId:'r2',routeRevision:2,fence:2,draining:[{poolId:'blue',releaseId:'r1',routeRevision:1,fence:1}]}))
  writeFileSync(join(root,'tenant_a.blue.1.retired'),'{}')
  assert.throws(()=>createReleaseLease(root,tenant,{poolId:'blue',routeRevision:1,fence:1}))
  continueOld();await childReady
  browser.destroy()
  const deadline=Date.now()+2000
  while(existsSync(join(root,'leases/tenant_a',`${parentAdmission}.json`))){
    assert.ok(Date.now()<deadline,'outer lease must close after disconnect')
    await new Promise(resolve=>setImmediate(resolve))
  }
  continueChild()
  const error=await done
  if(error)throw error
  assert.equal(commits,1)
})
