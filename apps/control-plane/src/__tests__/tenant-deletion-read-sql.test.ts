import { describe, expect, it } from 'vitest'
import { deletionClockRunningSql, tenantRetiringSql } from '../commercial/tenant-deletion-read.js'

describe.each([['tenantRetiringSql', tenantRetiringSql], ['deletionClockRunningSql', deletionClockRunningSql]])('%s', (_name, helper) => {
  it('accepts a qualified column and a positional placeholder', () => {
    expect(helper('s.customer_id')).toContain('d.customer_id=s.customer_id')
    expect(helper('$1')).toContain('d.customer_id=$1')
  })

  // A bare column inside the subquery resolves to the deletion table's own column and is true for every customer.
  it.each(['customer_id', 'd.customer_id', '', 's.customer_id OR true', '$', 'a.b.c'])('refuses %j', column => {
    expect(() => helper(column)).toThrow(/alias\.column or a \$n placeholder/)
  })
})
