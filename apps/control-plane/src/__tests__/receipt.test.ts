import { expect, it } from 'vitest'
import { publicReceipt, safeProfileFeatures } from '../worker.js'

it('exposes only bounded receipt fields and never private paths or error messages', () => {
  expect(publicReceipt({ status:'ok', stage:'backup', operation_id:'op_'+'a'.repeat(32), backup_id:'/private/backup', backup_dir:'/private/backup', error:{code:'failed',message:'/private/path'} })).toEqual({status:'ok',stage:'backup',operation_id:'op_'+'a'.repeat(32),error:{code:'failed'}})
})

it('accepts a direct validated feature snapshot and rejects untrusted shapes', () => {
  const profile = { commercial_mode:'saas',entitlement_source:'control_plane',policy_revision:3,features:{'users.limit':null,'storage.limit_mb':20,'pmo.enabled':true} }
  expect(safeProfileFeatures(profile,'saas')).toEqual({'users.limit':null,'storage.limit_mb':20,'pmo.enabled':true})
  expect(safeProfileFeatures({...profile,features:{features:{'users.limit':3}}},'saas')).toBeNull()
  expect(safeProfileFeatures({...profile,features:{'users.limit':-1,'storage.limit_mb':null}},'saas')).toBeNull()
  expect(safeProfileFeatures(profile,'non_saas')).toBeNull()
})
