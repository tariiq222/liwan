import { describe, expect, it } from 'vitest'
import { invoiceLineQuantities } from '../invoiceLines'

describe('invoiceLineQuantities', () => {
  it('reads paid as the billed quantity and never subtracts the free count', () => {
    expect(invoiceLineQuantities({ quantity: 5, free_quantity: 2 })).toEqual({ free: 2, paid: 5 })
    expect(invoiceLineQuantities({ quantity: 2, free_quantity: 2 })).toEqual({ free: 2, paid: 2 })
  })
  it('reports no free count, not zero, when the line carries none', () => {
    expect(invoiceLineQuantities({ quantity: 3 })).toEqual({ free: null, paid: 3 })
  })
  it('keeps a free count of zero as zero', () => {
    expect(invoiceLineQuantities({ quantity: 1, free_quantity: 0 })).toEqual({ free: 0, paid: 1 })
  })
})
