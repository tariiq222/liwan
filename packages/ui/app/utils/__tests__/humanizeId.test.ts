import { describe, expect, it } from 'vitest'
import { humanizeId } from '../humanizeId'

describe('humanizeId', () => {
  it('humanises module ids and identifiers', () => {
    expect(humanizeId('liwan_sales')).toBe('Sales')
    expect(humanizeId('customer_acme_reports')).toBe('Acme reports')
    expect(humanizeId('sales')).toBe('Sales')
    expect(humanizeId('field_service')).toBe('Field service')
    expect(humanizeId('')).toBe('')
    expect(humanizeId('liwan_')).toBe('liwan_')
    expect(humanizeId('liwan__x')).toBe('X')
    expect(humanizeId('a..b')).toBe('A b')
    expect(humanizeId('field.service')).toBe('Field service')
  })
})
