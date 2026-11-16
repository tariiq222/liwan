import {
  ConversationOpportunityAnswerSchema,
  ConversationOpportunityConflictErrorSchema,
  ConversationOpportunityLinkSchema,
  CrmOpportunityCreateSchema,
  CrmOpportunityMeetingCreateSchema,
  CrmOpportunityTaskCreateSchema,
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
  notes: '',
  stage: { id: 1, name: 'New' },
  user: { id: 3, name: 'Agent' },
  source: null,
  customer: null,
  package: null,
  lost_reason: null,
  status: 'pending',
  win_by_order: false,
  can_quote: false,
  list_price: 0,
  discount_percent: 0,
  final_price: 0,
  expected_revenue: 0,
  probability: 0,
  attempt_count: 0,
  next_call_at: null,
  cycle: 0,
  recycle_at: null,
  needs_manager: false,
  active: true,
  created_at: '2026-10-28T09:00:00Z',
  properties: [
    { key: 'sector', label: 'القطاع', type: 'selection', options: [{ key: 'retail', label: 'تجزئة' }], value: 'retail' },
    { key: 'followers', label: 'المتابعون', type: 'integer', value: 3 },
    { key: 'notes', label: 'ملاحظات', type: 'char', value: null },
  ],
}

describe('CrmOpportunitySchema', () => {
  it('accepts the serializer shape', () => {
    expect(CrmOpportunitySchema.parse(opportunity)).toEqual(opportunity)
    expect(CrmOpportunityListSchema.parse({ items: [opportunity], total: 1 }).total).toBe(1)
  })

  it('says whether an order, not a package, wins the opportunity', () => {
    expect(CrmOpportunitySchema.parse({ ...opportunity, win_by_order: true }).win_by_order).toBe(true)
    const { win_by_order: _flag, ...without } = opportunity
    expect(() => CrmOpportunitySchema.parse(without)).toThrow()
    expect(() => CrmOpportunitySchema.parse({ ...opportunity, win_by_order: 'yes' })).toThrow()
    const { can_quote: _quote, ...withoutQuote } = opportunity
    expect(() => CrmOpportunitySchema.parse(withoutQuote)).toThrow()
    expect(CrmOpportunitySchema.parse({ ...opportunity, win_by_order: true, can_quote: true }).can_quote).toBe(true)
  })

  it('rejects an unknown key and an unknown status', () => {
    expect(() => CrmOpportunitySchema.parse({ ...opportunity, agent_id: 3 })).toThrow()
    expect(() => CrmOpportunitySchema.parse({ ...opportunity, status: 'open' })).toThrow()
  })

  it('carries the company definition in order, each field with its value', () => {
    const fields = CrmOpportunitySchema.parse(opportunity).properties
    expect(fields.map(field => [field.key, field.value])).toEqual([['sector', 'retail'], ['followers', 3], ['notes', null]])
  })

  it('refuses a record field without a value or with options it may not carry', () => {
    expect(() => CrmOpportunitySchema.parse({ ...opportunity, properties: [{ key: 'k', label: 'x', type: 'char' }] })).toThrow()
    expect(() => CrmOpportunitySchema.parse({ ...opportunity, properties: [{ key: 'k', label: 'x', type: 'char', options: [], value: null }] })).toThrow()
    expect(() => CrmOpportunitySchema.parse({ ...opportunity, properties: [{ key: 'k', label: 'x', type: 'tags', options: [{ key: 'a', label: 'أ' }], value: [1] }] })).toThrow()
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

  it('accepts a partial set of custom-field values, null clearing one', () => {
    const properties = { sector: 'retail', followers: 4, note: null }
    expect(CrmOpportunityPatchSchema.parse({ properties })).toEqual({ properties })
    expect(() => CrmOpportunityPatchSchema.parse({ properties: { sector: { key: 'retail' } } })).toThrow()
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

describe('the linked customer', () => {
  it('is a ref or null, and nothing more', () => {
    expect(CrmOpportunitySchema.parse({ ...opportunity, customer: { id: 4, name: 'Mona' } }).customer).toEqual({ id: 4, name: 'Mona' })
    expect(() => CrmOpportunitySchema.parse({ ...opportunity, customer: { id: 4, name: 'Mona', phone: '+966501234567' } })).toThrow()
    const { customer: _customer, ...without } = opportunity
    expect(() => CrmOpportunitySchema.parse(without)).toThrow()
  })
})

describe('the bridge write bodies', () => {
  it('needs a name and a UTC deadline for a follow-up task and takes the optional fields', () => {
    const body = { name: 'Call back', date_deadline: '2026-11-20T09:00:00Z' }
    expect(CrmOpportunityTaskCreateSchema.parse({ ...body, description: 'x', priority: 'high', assignees: [3] }).assignees).toEqual([3])
    expect(() => CrmOpportunityTaskCreateSchema.parse({ name: 'Call back' })).toThrow()
    expect(CrmOpportunityTaskCreateSchema.parse({ ...body, date_deadline: '2026-11-20' }).date_deadline).toBe('2026-11-20')
    expect(() => CrmOpportunityTaskCreateSchema.parse({ ...body, date_deadline: 'tomorrow' })).toThrow()
    expect(() => CrmOpportunityTaskCreateSchema.parse({ ...body, date_deadline: null })).toThrow()
    expect(() => CrmOpportunityTaskCreateSchema.parse({ ...body, parent_id: 2 })).toThrow()
  })

  it('takes a meeting body without the series, the project and the minutes form', () => {
    expect(CrmOpportunityMeetingCreateSchema.parse({ name: 'Demo', attendee_ids: [3], location: 'HQ' }).attendee_ids).toEqual([3])
    expect(() => CrmOpportunityMeetingCreateSchema.parse({ name: 'Demo', series_id: 1 })).toThrow()
    expect(() => CrmOpportunityMeetingCreateSchema.parse({ name: 'Demo', project_id: 1 })).toThrow()
    expect(() => CrmOpportunityMeetingCreateSchema.parse({ attendee_ids: [3] })).toThrow()
  })
})

describe('the conversation opportunity bridge', () => {
  const ref = { id: 7, contact_name: 'Customer', stage: { id: 1, name: 'New' }, status: 'pending', active: true }

  it('reads the ref, an archived one, or a bare null', () => {
    expect(ConversationOpportunityAnswerSchema.parse(ref)).toEqual(ref)
    expect(ConversationOpportunityAnswerSchema.parse({ ...ref, stage: null, active: false }).active).toBe(false)
    expect(ConversationOpportunityAnswerSchema.parse(null)).toBeNull()
    expect(() => ConversationOpportunityAnswerSchema.parse({ ...ref, name: 'x' })).toThrow()
    expect(() => ConversationOpportunityAnswerSchema.parse({ ...ref, status: 'open' })).toThrow()
  })

  it('links by an opportunity id only', () => {
    expect(ConversationOpportunityLinkSchema.parse({ opportunity_id: 7 }).opportunity_id).toBe(7)
    expect(() => ConversationOpportunityLinkSchema.parse({})).toThrow()
    expect(() => ConversationOpportunityLinkSchema.parse({ opportunity_id: 0 })).toThrow()
    expect(() => ConversationOpportunityLinkSchema.parse({ opportunity_id: 7, create_new: true })).toThrow()
  })

  it('names both customers of a mismatch conflict, either may be missing', () => {
    const conflict = { code: 'conflict', message: 'x', details: { contact_customer: { id: 1, name: 'A' }, opportunity_customer: null } }
    expect(ConversationOpportunityConflictErrorSchema.parse(conflict).details.contact_customer?.name).toBe('A')
    expect(() => ConversationOpportunityConflictErrorSchema.parse({ ...conflict, details: { contact_customer: null } })).toThrow()
  })
})
