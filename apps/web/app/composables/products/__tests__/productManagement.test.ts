import { describe, expect, it } from 'vitest'
import { newProductManagedElsewhere, productManagedElsewhere } from '../productManagement'

const root = { is_root_company: true, company: { id: 1 } }
const branch = { is_root_company: false, company: { id: 2 } }

describe('productManagedElsewhere', () => {
  it('lets the root company write a shared product and the owning branch its own', () => {
    expect(productManagedElsewhere({ company: null }, root)).toBeNull()
    expect(productManagedElsewhere({ company: { id: 2, name: 'فرع' } }, branch)).toBeNull()
    expect(productManagedElsewhere({ company: { id: 1, name: 'ليوان' } }, root)).toBeNull()
  })

  it('names the reason when the session is in the wrong company', () => {
    expect(productManagedElsewhere({ company: null }, branch)).toBe('managed_in_root_company')
    expect(productManagedElsewhere({ company: { id: 2, name: 'فرع' } }, root)).toBe('managed_in_branch')
    expect(productManagedElsewhere({ company: { id: 3, name: 'فرع آخر' } }, branch)).toBe('managed_in_branch')
  })
})

describe('newProductManagedElsewhere', () => {
  it('lets only the root company make a product the establishment shares', () => {
    expect(newProductManagedElsewhere('establishment', root)).toBeNull()
    expect(newProductManagedElsewhere('establishment', branch)).toBe('managed_in_root_company')
  })

  it('lets every company make its own product under branch sharing', () => {
    expect(newProductManagedElsewhere('branch', root)).toBeNull()
    expect(newProductManagedElsewhere('branch', branch)).toBeNull()
  })
})
