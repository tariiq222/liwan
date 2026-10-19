import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest'
import type { Pool } from 'pg'
import { signMock as signServiceRequest, mockSessionQuery } from './helpers/vendor-session.js'
import { createApp } from '../http.js'
import { requestRestorePublication,restorePublication } from '../shared/restore-publication.js'
import { vendorActorIssuer } from '../admin-auth/grants.js'
vi.mock('../shared/restore-publication.js',()=>({requestRestorePublication:vi.fn(),restorePublication:vi.fn()}))
vi.mock('../shared/runtime-config.js',()=>({loadSharedRuntimeConfig:()=>({projectName:'webvue-shared-publication'})}))
const key='shared-queue-http-synthetic-key-'.repeat(2)
const tenant='ad03d956-efef-4f80-baf3-9c23ea46e945'
const approval="b68cb353-8e9b-4ad7-84a3-b634a8f346ca"
const path=`/v1/shared/tenants/${tenant}/restore-publications/${approval}`
const config={installationId:'queue-test',key,inventoryPath:'/unused',stateDir:'/unused',repositoryRoot:'/unused',python:'python3',tenantRegistryPath:'/unused/registry.json',sharedRuntimeConfigPath:'/unused/runtime.json'}
let roles=['operations','customer_success'];let fresh=true
const client={release(){},async query(sql:string,params:unknown[]=[]){
  const session=mockSessionQuery(sql,params);if(session){if(sql.includes('FROM vendor_sessions') && !fresh)for(const row of session.rows)row.step_up_at=new Date(0);return session}
  if(sql.startsWith('SELECT 1 FROM vendor_accounts WHERE id'))return {rows:[{}],rowCount:1}
  if(sql.startsWith('SELECT role FROM vendor_account_roles'))return {rows:roles.map(role=>({role})),rowCount:roles.length}
  if(sql.startsWith('INSERT INTO service_nonces'))return {rows:[{nonce:'fresh'}],rowCount:1}
  if(['BEGIN','COMMIT','ROLLBACK'].includes(sql)||sql.startsWith('DELETE FROM service_nonces'))return {rows:[],rowCount:0}
  throw Error('unexpected SQL:'+sql)
}}
const pool={connect:async()=>client} as unknown as Pool
const server=createApp(pool,config)
let origin:string
beforeAll(async()=>{
  vi.stubEnv('WEBVUE_TENANCY_MODE','shared')
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve))
  const address=server.address();if(!address||typeof address==='string')throw Error('missing address')
  origin=`http://127.0.0.1:${address.port}`
})
afterAll(async()=>{vi.unstubAllEnvs();await new Promise<void>(resolve=>server.close(()=>resolve()))})
beforeEach(()=>{vi.mocked(requestRestorePublication).mockReset();roles=['operations','customer_success'];fresh=true})
async function post(value:unknown){
  const body=JSON.stringify(value)
  return fetch(origin+path,{method:'POST',body,headers:{...signServiceRequest({method:'POST',path,body,actor:7,issuer:config.installationId,key}),'content-type':'application/json'}})
}
it('authenticated stepped-up operator queues only an approval and reason',async()=>{
  vi.mocked(requestRestorePublication).mockResolvedValue({approvalId:approval,status:'queued',code:null,host:null})
  const response=await post({reason:'Restore verified'})
  expect(response.status).toBe(202)
  expect(await response.json()).toMatchObject({approvalId:approval,status:'queued'})
  expect(requestRestorePublication).toHaveBeenCalledWith(pool,{projectName:'webvue-shared-publication'},{issuer:vendorActorIssuer('queue-test'),actorUid:7},tenant,approval,'Restore verified')
})
it('caller cannot choose the target host or physical observation',async()=>{
  const response=await post({reason:'Injected target',host:'attacker.invalid',verified:true})
  expect(response.status).toBe(422);expect(requestRestorePublication).not.toHaveBeenCalled()
})
it('unsigned publication is rejected',async()=>{
  const response=await fetch(origin+path,{method:'POST',body:JSON.stringify({reason:'Restore verified'})})
  expect(response.status).toBe(401);expect(requestRestorePublication).not.toHaveBeenCalled()
})

it.each([['operations'],['customer_success'],['support']])('missing publication grant is rejected (%j)',async(...grants)=>{
  roles=grants
  const response=await post({reason:'Restore verified'})
  expect(response.status).toBe(403);expect(requestRestorePublication).not.toHaveBeenCalled()
})
it('expired step-up cannot queue publication',async()=>{
  fresh=false
  const response=await post({reason:'Restore verified'})
  expect(response.status).toBe(403);expect(requestRestorePublication).not.toHaveBeenCalled()
})
