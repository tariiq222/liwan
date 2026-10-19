import { describe,expect,it } from 'vitest'
import { subscriptionObservationRequest } from '../shared/odoo-adapter.js'
describe('source subscription observation binding',()=>{
 const binding={tenantId:'tenant-a',database:'source',filestore:'source',registryRevision:1,host:'a.invalid'}
 it('keeps the exact current source binding',()=>{
  expect(subscriptionObservationRequest(binding,{database:'source'})).toMatchObject({tenant:{database:'source',host:'a.invalid'},releaseBinding:binding})
 })
 it('refuses an isolated target through the source observer before execution',()=>{
  expect(()=>subscriptionObservationRequest(binding,{database:'restore-target'})).toThrow('tenant_binding_mismatch')
  expect(()=>subscriptionObservationRequest({...binding,filestore:'other'},{database:'source'})).toThrow('tenant_binding_mismatch')
 })
})
