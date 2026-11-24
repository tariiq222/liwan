import { describe,expect,it } from 'vitest'
import { reconcileAfterFailure } from '../shared/odoo-adapter.js'

describe('reconcile after a failed shared apply',()=>{
  it('repairs a failure that may have left the shared odoo stopped',()=>{
    for(const code of ['odoo_restart_failed','shared_effect_unverified','authority_lost','backup_key_unavailable','inventory_too_large'])
      expect(reconcileAfterFailure('backup',Error(code))).toBe(true)
    expect(reconcileAfterFailure('restore',Error('restore_readback_mismatch'))).toBe(true)
  })

  it('never repairs a refusal that ran no effect',()=>{
    // This refusal happens before the runtime gate, and its job is not necessarily the tenant whose intent
    // the effect would read: reconciling there would start the shared Odoo in the middle of another capture.
    // The effect's own reconcile refuses another attempt's gate or live container and reports
    // `shared_effect_unverified`, so that code is deliberately reconciled and repairs nothing.
    expect(reconcileAfterFailure('backup',Error('runtime_writer_present'))).toBe(false)
    expect(reconcileAfterFailure('restore',Error('runtime_writer_present'))).toBe(false)
  })

  it('never reconciles a provision job',()=>{
    // Provision does not stop the shared Odoo; there is nothing of its own to start again.
    expect(reconcileAfterFailure('provision',Error('anything'))).toBe(false)
    expect(reconcileAfterFailure('provision',Error('runtime_writer_present'))).toBe(false)
  })

  it('treats an error without a code as a possible stop',()=>{
    expect(reconcileAfterFailure('backup',new Error(''))).toBe(true)
    expect(reconcileAfterFailure('backup','not an error')).toBe(true)
  })
})
