import {describe,it,expect} from 'vitest'
import { validateRealBackupManifest, realRestoreHost } from './odoo-backup.js'
const binding={tenantId:'alpha',database:'nasq_scratch_'+'a'.repeat(32),filestore:'nasq_scratch_'+'a'.repeat(32),registryRevision:2}
const id='687674dc-5789-4a99-b151-12d69f010cc3'
const manifest={schemaVersion:1,format:'odoo-pg-filestore-v1',backupId:id,controlTenantId:id,binding,businessKey:'backup-key',payloadDigest:'a'.repeat(64),databaseSha256:'b'.repeat(64),filestoreSha256:'c'.repeat(64),sourceImageId:'sha256:'+'d'.repeat(64),postgresImageId:'sha256:'+'e'.repeat(64),capturedAt:'2026-10-01T00:00:00.000Z',inventory:{databaseAttachments:[],attachments:[],projects:1,tasks:1,modules:[],profile:[]}}
describe('real backup authority',()=>{
 it('rejects synthetic artifacts and a mismatched source before physical execution',()=>{
  expect(validateRealBackupManifest(manifest,{backupId:id,binding,controlTenantId:id}).format).toBe('odoo-pg-filestore-v1')
  expect(()=>validateRealBackupManifest({...manifest,format:'reference'}, {backupId:id,binding,controlTenantId:id})).toThrow()
  expect(()=>validateRealBackupManifest(manifest,{backupId:id,binding:{...binding,database:'other'},controlTenantId:id})).toThrow()
  expect(()=>validateRealBackupManifest(manifest,{backupId:id,binding,controlTenantId:'b'.repeat(36)})).toThrow()
 })
 it('derives restore host only from a valid approval ID',()=>{
  expect(realRestoreHost(id,'saas.accept.nasq.test')).toBe('r687674dc57894a99b15112d69f010cc3.restore.saas.accept.nasq.test')
  expect(()=>realRestoreHost('../escape','saas.accept.nasq.test')).toThrow()
 })
})

it('public progress whitelists identities and never returns internal artifact or credential fields',async()=>{
 const {odooJobProgress}=await import('./odoo-backup.js')
 const pool={query:async()=>({rowCount:1,rows:[{id,state:'verified',operation:'backup',backup_id:id,artifact_path:'/private/backup',snapshot:{password:'secret'},receipt:{internal:'data'}}]})} as any
 expect(await odooJobProgress(pool,id,id)).toEqual({id,state:'verified',operation:'backup',backupId:id})
})
