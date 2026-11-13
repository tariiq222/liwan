import { describe, expect, it } from 'vitest'
import type { Customer } from '@liwan/contracts'
import { customerCreateBody, customerPatchBody, type CustomerDraft } from '../customerPayload'

const customer: Customer = { id: 4, name: 'منى العتيبي', phone: '+966500000001', email: 'mona@example.com', is_company: false, parent: null, active: true, company: null, properties: [] }
const draft: CustomerDraft = { name: customer.name, phone: customer.phone!, email: customer.email!, isCompany: false, canChoosePartyKind: false, parentId: null, changedFields: {} }

describe('customerCreateBody', () => {
  it('trims the name and leaves an empty phone, email and field set out', () => {
    expect(customerCreateBody({ ...draft, name: '  منى ', phone: ' ', email: '' }, false)).toEqual({ name: 'منى', is_company: false })
  })

  it('carries the phone, the changed custom fields and the party kind', () => {
    expect(customerCreateBody({ ...draft, isCompany: true, changedFields: { city: 'الرياض' } }, false)).toEqual({
      name: customer.name, phone: '+966500000001', email: 'mona@example.com', is_company: true, properties: { city: 'الرياض' },
    })
  })

  it('carries the chosen parent company', () => {
    expect(customerCreateBody({ ...draft, parentId: 2 }, false)).toHaveProperty('parent_id', 2)
    expect(customerCreateBody(draft, false)).not.toHaveProperty('parent_id')
  })

  it('repeats the create with create_new only after the user chose a new customer', () => {
    expect(customerCreateBody(draft, false)).not.toHaveProperty('create_new')
    expect(customerCreateBody(draft, true)).toHaveProperty('create_new', true)
  })
})

describe('customerPatchBody', () => {
  it('sends nothing while the draft matches the customer', () => {
    expect(customerPatchBody(customer, draft)).toEqual({})
  })

  it('sends only what changed and null for a cleared phone or email', () => {
    expect(customerPatchBody(customer, { ...draft, name: 'منى', phone: '', email: ' ' })).toEqual({ name: 'منى', phone: null, email: null })
    expect(customerPatchBody(customer, { ...draft, changedFields: { vip: true } })).toEqual({ properties: { vip: true } })
  })

  it('changes the parent, and clears it with null', () => {
    const contact: Customer = { ...customer, parent: { id: 2, name: 'مؤسسة النخيل' } }
    expect(customerPatchBody(contact, { ...draft, parentId: 2 })).toEqual({})
    expect(customerPatchBody(contact, { ...draft, parentId: 5 })).toEqual({ parent_id: 5 })
    expect(customerPatchBody(contact, { ...draft, parentId: null })).toEqual({ parent_id: null })
    expect(customerPatchBody(customer, { ...draft, parentId: 2 })).toEqual({ parent_id: 2 })
  })

  it('sends the party kind only when the form offered the choice', () => {
    expect(customerPatchBody(customer, { ...draft, isCompany: true })).toEqual({})
    expect(customerPatchBody(customer, { ...draft, isCompany: true, canChoosePartyKind: true })).toEqual({ is_company: true })
  })
})
