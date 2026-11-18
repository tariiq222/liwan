import { describe, expect, it } from 'vitest'
import { crmErrorMessage, crmListErrorMessage, stageNeedsMoveTarget } from '../crmErrors'

const t = (key: string) => key
const fail = (status: number, field?: string, reason?: string) => ({ status, field, details: reason ? { reason } : undefined, message: 'server text' })

describe('crmErrorMessage', () => {
  it('names a closed or changed record on 409', () => {
    expect(crmErrorMessage(fail(409), t)).toBe('crm.opportunities.errors.conflict')
  })
  it('says an already linked opportunity keeps its customer, apart from a changed record', () => {
    expect(crmErrorMessage({ ...fail(409), code: 'already_linked' }, t)).toBe('crm.opportunities.errors.alreadyLinked')
    expect(crmErrorMessage({ ...fail(409), code: 'conflict' }, t)).toBe('crm.opportunities.errors.conflict')
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
  it('names a package win refused while an order wins, before the generic conflict', () => {
    expect(crmErrorMessage({ ...fail(409, undefined, 'crm_win_by_order'), code: 'conflict' }, t)).toBe('crm.opportunities.errors.winByOrder')
    expect(crmErrorMessage({ ...fail(409), code: 'conflict' }, t)).toBe('crm.opportunities.errors.conflict')
  })
  it('names a plan without Sales (403 feature_not_included) apart from a missing right', () => {
    expect(crmErrorMessage({ ...fail(403), code: 'feature_not_included' }, t)).toBe('crm.opportunities.errors.noSales')
    expect(crmErrorMessage({ ...fail(403), code: 'forbidden' }, t)).toBe('crm.opportunities.errors.forbidden')
  })
  it('names an opportunity that is gone or hidden (404)', () => {
    expect(crmErrorMessage(fail(404), t)).toBe('crm.opportunities.errors.notFound')
  })
  it('names the two reasons a quotation is refused with 422', () => {
    expect(crmErrorMessage(fail(422, 'customer_id', 'crm_opportunity_without_customer'), t)).toBe('crm.opportunities.errors.orderNoCustomer')
    expect(crmErrorMessage(fail(422, undefined, 'crm_opportunity_closed'), t)).toBe('crm.opportunities.errors.orderClosed')
  })
})

describe('crmListErrorMessage', () => {
  it.each([
    ['stage_has_opportunities', 'hasOpportunities'],
    ['won_stage_required', 'wonRequired'],
    ['won_stage_has_opportunities', 'wonHasOpportunities'],
    ['first_stage_open', 'firstOpen'],
    ['invalid_move_target', 'moveTarget'],
  ])('names the %s refusal', (reason, key) => {
    expect(crmListErrorMessage(fail(422, 'id', reason), t)).toBe(`crm.settings.stages.errors.${key}`)
  })
  it('falls back to the refusal text for an unnamed 422 and the generic text for an unknown error', () => {
    expect(crmListErrorMessage(fail(422, 'name'), t)).toBe('server text')
    expect(crmListErrorMessage(new Error('x'), t)).toBe('errors.generic')
  })
})

describe('stageNeedsMoveTarget', () => {
  it('is true only for the 422 that says the stage still holds opportunities', () => {
    expect(stageNeedsMoveTarget(fail(422, 'id', 'stage_has_opportunities'))).toBe(true)
    expect(stageNeedsMoveTarget(fail(422, 'id', 'won_stage_required'))).toBe(false)
    expect(stageNeedsMoveTarget(fail(409, 'id', 'stage_has_opportunities'))).toBe(false)
    expect(stageNeedsMoveTarget(new Error('x'))).toBe(false)
  })
})
