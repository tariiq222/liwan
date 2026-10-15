import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest'
import type { Pool } from 'pg'
import { signMock as signServiceRequest, mockSessionQuery } from './helpers/vendor-session.js'
import { createApp } from '../http.js'
import { enqueueSharedJob } from '../shared/job-store.js'
vi.mock('../shared/job-store.js', () => ({ enqueueSharedJob: vi.fn() }))
const key='shared-queue-http-synthetic-key-'.repeat(2)
const tenant='ad03d956-efef-4f80-baf3-9c23ea46e945'
const path=`/v1/shared/tenants/${tenant}/jobs`
const config={installationId:'queue-test',key,inventoryPath:'/unused',stateDir:'/unused',repositoryRoot:'/unused',python:'python3',tenantRegistryPath:'/unused/registry.json'}
const client={release(){},async query(sql:string,params:unknown[]=[]){
  const session=mockSessionQuery(sql,params);if(session)return session
  if(sql.startsWith('SELECT capabilities'))return {rows:[{capabilities:['vendor.operations.run']}],rowCount:1}
  if(sql.startsWith('INSERT INTO service_nonces'))return {rows:[{nonce:'fresh'}],rowCount:1}
  if(['BEGIN','COMMIT','ROLLBACK'].includes(sql)||sql.startsWith('DELETE FROM service_nonces'))return {rows:[],rowCount:0}
  throw Error('unexpected SQL:'+sql)
}}
const pool={connect:async()=>client} as unknown as Pool
const server=createApp(pool,config)
let origin:string
beforeAll(async()=>{
  vi.stubEnv('NASQ_TENANCY_MODE','shared')
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve))
  const address=server.address();if(!address||typeof address==='string')throw Error('missing address')
  origin=`http://127.0.0.1:${address.port}`
})
afterAll(async()=>{vi.unstubAllEnvs();await new Promise<void>(resolve=>server.close(()=>resolve()))})
beforeEach(()=>vi.mocked(enqueueSharedJob).mockReset())
async function post(value:unknown){
  const body=JSON.stringify(value)
  return fetch(origin+path,{method:'POST',body,headers:{...signServiceRequest({method:'POST',path,body,actor:7,issuer:config.installationId,key}),'content-type':'application/json'}})
}
it.each([false,true])('forwards signed identity and returns accepted/replay semantics (%s)',async replay=>{
  const job={schemaVersion:1,operation:'backup',requestId:tenant}
  const result={id:tenant,state:'queued',replay}
  vi.mocked(enqueueSharedJob).mockResolvedValue(result)
  const response=await post({reason:'Synthetic queue request',job})
  expect(response.status).toBe(replay?200:202)
  expect(await response.json()).toEqual(result)
  expect(enqueueSharedJob).toHaveBeenCalledWith(pool,tenant,{issuer:'queue-test',actorUid:7},job,'Synthetic queue request')
})
it('maps invalid job contract to422 without leaking validation internals',async()=>{
  const response=await post({reason:'Malformed job',job:{operation:'invalid'}})
  expect(response.status).toBe(422)
  expect((await response.json()).code).toBe('invalid')
})
it.each([
  {binding:{tenantId:'foreign'}},
  {policy:{modules:['unapproved']}},
  {catalog:{version:'caller-selected'}},
  {businessKey:'caller-selected'},
  {payloadDigest:'a'.repeat(64)},
])('rejects caller-owned job authority fields %j before enqueue',async extra=>{
  const response=await post({reason:'Injected authority',job:{schemaVersion:1,operation:'provision',requestId:tenant,...extra}})
  expect(response.status).toBe(422)
  expect(enqueueSharedJob).not.toHaveBeenCalled()
})
it('accepts restore with only approval id and forwards it to the store',async()=>{
  const job={schemaVersion:1,operation:'restore',requestId:tenant,approvalId:'ad03d956-efef-4f80-baf3-9c23ea46e945'}
  const result={id:'job-1',state:'queued',replay:false}
  vi.mocked(enqueueSharedJob).mockResolvedValue(result)
  const response=await post({reason:'Approved restore',job})
  expect(response.status).toBe(202)
  expect(await response.json()).toEqual(result)
  expect(enqueueSharedJob).toHaveBeenCalledWith(pool,tenant,{issuer:'queue-test',actorUid:7},job,'Approved restore')
})
it.each([
  {binding:{tenantId:'foreign'}},
  {backup:{schemaVersion:1,backupId:tenant,binding:{tenantId:'foreign',database:'db',filestore:'fs',registryRevision:1},databaseSha256:'a'.repeat(64),filestoreSha256:'b'.repeat(64),consistency:'verified'}},
  {policy:{modules:['unapproved']}},
  {catalog:{version:'caller-selected'}},
  {targetDatabase:'caller_selected'},
  {payloadDigest:'a'.repeat(64)},
])('rejects caller-owned authority fields on restore %j before enqueue',async extra=>{
  const response=await post({reason:'Injected restore authority',job:{schemaVersion:1,operation:'restore',requestId:tenant,approvalId:tenant,...extra}})
  expect(response.status).toBe(422)
  expect(enqueueSharedJob).not.toHaveBeenCalled()
})
it('rejects caller actor override before enqueue',async()=>{
  const response=await post({reason:'Forged actor',job:{},actorUid:999})
  expect(response.status).toBe(422)
  expect(enqueueSharedJob).not.toHaveBeenCalled()
})
