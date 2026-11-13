import { describe, expect, it } from 'vitest'
import { emptyCustomerFields, parentPickerOffered, partyKindForm } from '../customerPartyKind'

describe('partyKindForm', () => {
  it('offers no company option to a tenant of individuals', () => {
    expect(partyKindForm('individuals', false)).toEqual({ canChoose: false, isCompany: false })
    expect(partyKindForm('individuals', true)).toEqual({ canChoose: false, isCompany: false })
  })

  it('makes a new customer of a tenant of companies a company, and a contact when a parent is chosen', () => {
    expect(partyKindForm('companies', false)).toEqual({ canChoose: false, isCompany: true })
    expect(partyKindForm('companies', true)).toEqual({ canChoose: false, isCompany: false })
  })

  it('offers the choice to a tenant of both, starting as a person', () => {
    expect(partyKindForm('both', false)).toEqual({ canChoose: true, isCompany: false })
    expect(partyKindForm('both', true)).toEqual({ canChoose: true, isCompany: false })
  })
})

describe('parentPickerOffered', () => {
  const base = { kinds: 'both' as const, isCompany: false, creating: true, companiesExist: true, parentChosen: false }

  it('is offered to a person, never to a company', () => {
    expect(parentPickerOffered(base)).toBe(true)
    expect(parentPickerOffered({ ...base, isCompany: true })).toBe(false)
  })

  it('is how a tenant of companies makes a contact: offered on a new customer even while it is a company', () => {
    expect(parentPickerOffered({ ...base, kinds: 'companies', isCompany: true })).toBe(true)
    expect(parentPickerOffered({ ...base, kinds: 'companies', isCompany: true, creating: false })).toBe(false)
    expect(parentPickerOffered({ ...base, kinds: 'companies', isCompany: false, creating: false })).toBe(true)
  })

  it('is offered to a tenant of individuals only when company customers exist or one is chosen', () => {
    expect(parentPickerOffered({ ...base, kinds: 'individuals', companiesExist: false })).toBe(false)
    expect(parentPickerOffered({ ...base, kinds: 'individuals', companiesExist: true })).toBe(true)
    expect(parentPickerOffered({ ...base, kinds: 'individuals', companiesExist: false, parentChosen: true })).toBe(true)
  })
})

describe('emptyCustomerFields', () => {
  it('gives a new customer the definition with the empty value of each type', () => {
    const options = [{ key: 'a', label: 'أ' }]
    expect(emptyCustomerFields([
      { key: 'city', label: 'المدينة', type: 'char' },
      { key: 'vip', label: 'مميز', type: 'boolean' },
      { key: 'tags', label: 'وسوم', type: 'tags', options },
      { key: 'level', label: 'المستوى', type: 'selection', options },
    ]).map(field => [field.key, field.value])).toEqual([['city', null], ['vip', false], ['tags', []], ['level', null]])
  })
})
