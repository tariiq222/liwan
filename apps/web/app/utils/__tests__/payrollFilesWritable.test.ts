import { describe, expect, it } from 'vitest'
import { payrollFilesWritable } from '../payrollFilesWritable'

const identity = (writable: string[]) => ({ entitlements: { 'hr.enabled': true, 'hr.payroll': true }, platform: { readable_features: ['hr.enabled', 'hr.payroll'], writable_features: writable } })

describe('payrollFilesWritable', () => {
  it('is closed without a /me or without the platform policy, whatever the entitlements say', () => {
    expect(payrollFilesWritable(null)).toBe(false)
    expect(payrollFilesWritable({ entitlements: { 'hr.enabled': true, 'hr.payroll': true } })).toBe(false)
  })

  it('is closed when the writable list is empty', () => {
    expect(payrollFilesWritable(identity([]))).toBe(false)
  })

  it('opens only when both hr.enabled and hr.payroll are writable', () => {
    expect(payrollFilesWritable(identity(['hr.enabled', 'hr.payroll']))).toBe(true)
  })

  it('stays closed with only one of the two', () => {
    expect(payrollFilesWritable(identity(['hr.enabled']))).toBe(false)
    expect(payrollFilesWritable(identity(['hr.payroll']))).toBe(false)
  })
})
