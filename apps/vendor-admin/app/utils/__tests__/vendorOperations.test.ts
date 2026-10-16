import { describe, expect, it } from 'vitest'
import { operationFilterLabelKey, operationStatusFilter } from '../vendorOperations'

describe('vendorOperations', () => {
  it('reads a valid status or group and ignores everything else', () => {
    for (const value of ['pending', 'attention', 'failed', 'needs_intervention', 'verified']) expect(operationStatusFilter(value)).toBe(value)
    for (const value of [undefined, '', 'all', 'bogus', ['pending'], 3]) expect(operationStatusFilter(value)).toBe('all')
  })

  it('words groups itself and reuses the status label for a single status', () => {
    expect(operationFilterLabelKey('attention')).toBe('vendor.operations.filter.attention')
    expect(operationFilterLabelKey('all')).toBe('vendor.operations.filter.all')
    expect(operationFilterLabelKey('failed')).toBe('vendor.status.failed')
  })
})
