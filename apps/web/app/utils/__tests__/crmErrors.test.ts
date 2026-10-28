import { describe, expect, it } from 'vitest'
import { crmErrorMessage } from '../crmErrors'

const t = (key: string) => key
const fail = (status: number, field?: string, reason?: string) => ({ status, field, details: reason ? { reason } : undefined, message: 'server text' })

describe('crmErrorMessage', () => {
  it('names a closed or changed record on 409', () => {
    expect(crmErrorMessage(fail(409), t)).toBe('crm.opportunities.errors.conflict')
  })
  it('names the refused phone and email by their reason code', () => {
    expect(crmErrorMessage(fail(422, 'phone', 'duplicate_phone'), t)).toBe('crm.opportunities.errors.duplicatePhone')
    expect(crmErrorMessage(fail(422, 'phone', 'invalid_phone'), t)).toBe('crm.opportunities.errors.invalidPhone')
    expect(crmErrorMessage(fail(422, 'email', 'invalid_email'), t)).toBe('crm.opportunities.errors.invalidEmail')
    expect(crmErrorMessage(fail(422, 'phone'), t)).toBe('server text')
  })
  it('names the refused discount on 422', () => {
    expect(crmErrorMessage(fail(422, 'discount_percent'), t)).toBe('crm.opportunities.errors.discount')
  })
  it('names a refused stage on 422', () => {
    expect(crmErrorMessage(fail(422, 'stage_id'), t)).toBe('crm.opportunities.errors.stage')
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
