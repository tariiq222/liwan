import { describe, expect, it } from 'vitest'
import { customerName } from '../customerName'

const t = (key: string, values?: Record<string, unknown>) => `${key}:${values?.id ?? ''}`

describe('customerName', () => {
  it('shows the stored name of a customer that is not erased', () => {
    expect(customerName({ id: 4, name: 'منى العتيبي', erased: false }, t)).toBe('منى العتيبي')
  })

  it('shows the translated name with the number for an erased customer, never the stored marker', () => {
    expect(customerName({ id: 40, name: 'Erased customer 40', erased: true }, t)).toBe('customers.erasedName:40')
  })
})
