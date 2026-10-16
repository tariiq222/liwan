import { describe, expect, it } from 'vitest'
import { humanizeId } from '../humanizeId'

describe('humanizeId', () => {
  it('humanises module ids and identifiers', () => {
    expect(humanizeId('nasq_sales')).toBe('Sales')
    expect(humanizeId('customer_acme_reports')).toBe('Acme reports')
    expect(humanizeId('sales')).toBe('Sales')
    expect(humanizeId('field_service')).toBe('Field service')
    expect(humanizeId('')).toBe('')
    expect(humanizeId('nasq_')).toBe('nasq_')
    expect(humanizeId('nasq__x')).toBe('X')
    expect(humanizeId('a..b')).toBe('A b')
    expect(humanizeId('field.service')).toBe('Field service')
  })
})
