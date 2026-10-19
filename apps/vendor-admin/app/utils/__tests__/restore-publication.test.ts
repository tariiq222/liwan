import { describe, expect, it } from 'vitest'
import { canPublishRestore } from '../restorePublication'

describe('restore publication control',()=>{
  const ready={type:'restore',status:'verified',restore_publication:{status:'not_requested'}}
  it('requires both operations and tenant-management capability',()=>{
    expect(canPublishRestore(ready,key=>['vendor.operations.run','vendor.tenants.manage'].includes(key))).toBe(true)
    expect(canPublishRestore(ready,key=>key==='vendor.operations.run')).toBe(false)
    expect(canPublishRestore(ready,()=>false)).toBe(false)
  })
  it('never republishes queued, uncertain or published restores',()=>{
    for(const status of ['queued','published','needs_intervention'])expect(canPublishRestore({...ready,restore_publication:{status}},()=>true)).toBe(false)
    expect(canPublishRestore({...ready,status:'running'},()=>true)).toBe(false)
    expect(canPublishRestore({type:'backup',status:'verified'},()=>true)).toBe(false)
    expect(canPublishRestore(null,()=>true)).toBe(false)
  })
})
