import { describe, expect, it } from 'vitest'
import { crmErrorMessage } from '../crmErrors'

const t = (key: string) => key
const fail = (status: number, field?: string) => ({ status, field, message: 'server text' })

describe('crmErrorMessage', () => {
  it('names a closed or changed record on 409', () => {
    expect(crmErrorMessage(fail(409), t)).toBe('crm.opportunities.errors.conflict')
  })
  it('names the duplicate phone and the refused discount on 422', () => {
    expect(crmErrorMessage(fail(422, 'phone'), t)).toBe('crm.opportunities.errors.duplicatePhone')
    expect(crmErrorMessage(fail(422, 'discount_percent'), t)).toBe('crm.opportunities.errors.discount')
  })
  it('says a discount needs approval only for a sale', () => {
    expect(crmErrorMessage(fail(403), t, { sale: true })).toBe('crm.opportunities.errors.discountApproval')
    expect(crmErrorMessage(fail(403), t)).toBe('crm.opportunities.errors.forbidden')
  })
  it('falls back to the refusal text, or the generic text for an unknown error', () => {
    expect(crmErrorMessage(fail(422, 'name'), t)).toBe('server text')
    expect(crmErrorMessage(new Error('x'), t)).toBe('errors.generic')
  })
})
