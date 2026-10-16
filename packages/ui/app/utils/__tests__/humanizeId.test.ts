import { describe, expect, it } from 'vitest'
import { humanizeId } from '../humanizeId'

describe('humanizeId', () => {
  it('humanises module ids and identifiers', () => {
    expect(humanizeId('webvue_sales')).toBe('Sales')
    expect(humanizeId('customer_acme_reports')).toBe('Acme reports')
    expect(humanizeId('sales')).toBe('Sales')
    expect(humanizeId('field_service')).toBe('Field service')
    expect(humanizeId('')).toBe('')
    expect(humanizeId('webvue_')).toBe('webvue_')
    expect(humanizeId('webvue__x')).toBe('X')
    expect(humanizeId('a..b')).toBe('A b')
    expect(humanizeId('field.service')).toBe('Field service')
  })
})
