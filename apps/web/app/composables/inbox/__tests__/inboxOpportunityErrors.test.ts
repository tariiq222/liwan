import { describe, expect, it } from 'vitest'
import { ApiError } from '../../useApi'
import { inboxOpportunityErrorMessage } from '../inboxOpportunityErrors'

const t = (key: string, values?: Record<string, unknown>) => (values ? `${key}|${Object.values(values).join('|')}` : key)

describe('inboxOpportunityErrorMessage', () => {
  it('tells the user to unlink first when another opportunity is linked', () => {
    expect(inboxOpportunityErrorMessage(new ApiError(409, 'already_linked', 'x'), t)).toBe('inbox.opportunity.errors.alreadyLinked')
  })

  it('names both customers of a mismatch, and a missing one as no customer', () => {
    const details = { contact_customer: { id: 1, name: 'منى' }, opportunity_customer: { id: 2, name: 'سارة' } }
    expect(inboxOpportunityErrorMessage(new ApiError(409, 'conflict', 'x', undefined, details), t)).toBe('inbox.opportunity.errors.customerMismatch|منى|سارة')
    expect(inboxOpportunityErrorMessage(new ApiError(409, 'conflict', 'x', undefined, { ...details, opportunity_customer: null }), t)).toBe('inbox.opportunity.errors.customerMismatch|منى|inbox.opportunity.errors.noCustomer')
  })

  it('words another agent, an archived or foreign opportunity and a hidden record', () => {
    expect(inboxOpportunityErrorMessage(new ApiError(403, 'forbidden', 'x'), t)).toBe('inbox.opportunity.errors.notYours')
    expect(inboxOpportunityErrorMessage(new ApiError(422, 'invalid', 'x', 'opportunity_id'), t)).toBe('inbox.opportunity.errors.unavailable')
    expect(inboxOpportunityErrorMessage(new ApiError(404, 'not_found', 'x'), t)).toBe('inbox.opportunity.errors.missing')
  })

  it('falls back to the generic text for anything else, including a conflict without details', () => {
    expect(inboxOpportunityErrorMessage(new ApiError(409, 'conflict', 'x'), t)).toBe('errors.generic')
    expect(inboxOpportunityErrorMessage(new Error('offline'), t)).toBe('errors.generic')
  })
})
