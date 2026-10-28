import {
  CrmOpportunityCreateSchema,
  CrmOpportunityFiltersSchema,
  CrmOpportunityListSchema,
  CrmOpportunityPatchSchema,
  CrmOpportunityWriteReasonSchema,
  CrmOpportunitySchema,
  CrmViewLogListSchema,
} from '../index'

const opportunity = {
  id: 7,
  contact_name: 'Customer',
  phone: '+966501234567',
  email: '',
  stage: { id: 1, name: 'New' },
  user: { id: 3, name: 'Agent' },
  source: null,
  package: null,
  lost_reason: null,
  status: 'pending',
  list_price: 0,
  discount_percent: 0,
  final_price: 0,
  expected_revenue: 0,
  attempt_count: 0,
  next_call_at: null,
  cycle: 0,
  recycle_at: null,
  needs_manager: false,
  active: true,
  created_at: '2026-10-28T09:00:00Z',
}

describe('CrmOpportunitySchema', () => {
  it('accepts the serializer shape', () => {
    expect(CrmOpportunitySchema.parse(opportunity)).toEqual(opportunity)
    expect(CrmOpportunityListSchema.parse({ items: [opportunity], total: 1 }).total).toBe(1)
  })

  it('rejects an unknown key and an unknown status', () => {
    expect(() => CrmOpportunitySchema.parse({ ...opportunity, agent_id: 3 })).toThrow()
    expect(() => CrmOpportunitySchema.parse({ ...opportunity, status: 'open' })).toThrow()
  })
})

describe('CrmOpportunityCreateSchema', () => {
  it('requires a name and a phone and accepts the pool as user_id null', () => {
    expect(CrmOpportunityCreateSchema.parse({ contact_name: 'A', phone: '0501234567', user_id: null }).user_id).toBeNull()
    expect(() => CrmOpportunityCreateSchema.parse({ contact_name: 'A' })).toThrow()
    expect(() => CrmOpportunityCreateSchema.parse({ contact_name: 'A', phone: '1', stage_id: 1 })).toThrow()
  })
})

describe('CrmOpportunityPatchSchema', () => {
  it('accepts whitelisted fields only and refuses an empty body', () => {
    expect(CrmOpportunityPatchSchema.parse({ stage_id: 2 })).toEqual({ stage_id: 2 })
    expect(() => CrmOpportunityPatchSchema.parse({})).toThrow()
    expect(() => CrmOpportunityPatchSchema.parse({ user_id: 2 })).toThrow()
  })
})

describe('CrmViewLogListSchema', () => {
  it('accepts a view log page', () => {
    const page = { items: [{ id: 1, user: { id: 3, name: 'Agent' }, opportunity_id: 7, viewed_at: '2026-10-28T09:00:00Z' }], total: 1 }
    expect(CrmViewLogListSchema.parse(page)).toEqual(page)
  })
})

describe('CrmOpportunityWriteReasonSchema', () => {
  it('lists the codes of a refused phone or email', () => {
    expect(CrmOpportunityWriteReasonSchema.options).toEqual(['invalid_phone', 'duplicate_phone', 'invalid_email'])
    expect(() => CrmOpportunityWriteReasonSchema.parse('duplicate phone')).toThrow()
  })

  it('filters the list by status: open, won, lost or all', () => {
    for (const status of ['open', 'won', 'lost', 'all']) expect(CrmOpportunityFiltersSchema.parse({ status })).toEqual({ status })
    expect(() => CrmOpportunityFiltersSchema.parse({ status: 'pending' })).toThrow()
  })
})
