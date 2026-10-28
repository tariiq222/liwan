import { BellNotificationSchema } from '../../pmo/notification'
import {
  CrmAssignSchema,
  CrmCallCreateSchema,
  CrmCallListSchema,
  CrmCallResultSchema,
  CrmCallSchema,
  CrmLostSchema,
  CrmNotificationSchema,
  CrmSaleSchema,
} from '../index'

const call = {
  id: 4,
  outcome: { id: 1, name: 'No answer' },
  note: '',
  duration_minutes: 1.5,
  user: { id: 3, name: 'Agent' },
  created_at: '2026-10-28T09:00:00Z',
}

describe('CrmCallSchema', () => {
  it('accepts the serializer shape', () => {
    expect(CrmCallSchema.parse(call)).toEqual(call)
    expect(CrmCallListSchema.parse({ items: [call], total: 1 }).total).toBe(1)
  })

  it('rejects an unknown key and a negative duration', () => {
    expect(() => CrmCallSchema.parse({ ...call, state: 'done' })).toThrow()
    expect(() => CrmCallSchema.parse({ ...call, duration_minutes: -1 })).toThrow()
  })

  it('wraps the call with its opportunity', () => {
    expect(() => CrmCallResultSchema.parse({ call })).toThrow()
  })
})

describe('call and sale bodies', () => {
  it('needs an outcome and takes the sale fields together', () => {
    expect(CrmCallCreateSchema.parse({ outcome_id: 1, note: 'Busy', duration_minutes: 2 }).outcome_id).toBe(1)
    expect(CrmCallCreateSchema.parse({ outcome_id: 4, package_id: 2, final_price: 900 }).package_id).toBe(2)
    expect(() => CrmCallCreateSchema.parse({ note: 'x' })).toThrow()
    expect(() => CrmCallCreateSchema.parse({ outcome_id: 4, package_id: 2 })).toThrow()
    expect(() => CrmCallCreateSchema.parse({ outcome_id: 1, extra: 1 })).toThrow()
  })

  it('refuses any sale field without a package and a price', () => {
    expect(() => CrmCallCreateSchema.parse({ outcome_id: 4, discount_percent: null })).toThrow()
    expect(() => CrmCallCreateSchema.parse({ outcome_id: 4, discount_percent: 5 })).toThrow()
    expect(() => CrmCallCreateSchema.parse({ outcome_id: 4, final_price: 5 })).toThrow()
    expect(() => CrmCallCreateSchema.parse({ outcome_id: 4, package_id: 2, discount_percent: 5 })).toThrow()
    expect(CrmCallCreateSchema.parse({ outcome_id: 4, package_id: 2, final_price: 5, discount_percent: null }).package_id).toBe(2)
  })

  it('takes the reason a losing call carries, as a positive id', () => {
    expect(CrmCallCreateSchema.parse({ outcome_id: 5, lost_reason_id: 3 }).lost_reason_id).toBe(3)
    expect(() => CrmCallCreateSchema.parse({ outcome_id: 5, lost_reason_id: 0 })).toThrow()
    expect(() => CrmCallCreateSchema.parse({ outcome_id: 5, lost_reason_id: null })).toThrow()
  })

  it('bounds the sale', () => {
    expect(CrmSaleSchema.parse({ package_id: 2, final_price: 0, discount_percent: null }).final_price).toBe(0)
    expect(() => CrmSaleSchema.parse({ package_id: 2, final_price: -1 })).toThrow()
    expect(() => CrmSaleSchema.parse({ package_id: 2, final_price: 1, discount_percent: 101 })).toThrow()
    expect(() => CrmSaleSchema.parse({ final_price: 1 })).toThrow()
  })

  it('needs a reason to lose and a user to assign', () => {
    expect(CrmLostSchema.parse({ lost_reason_id: 3 }).lost_reason_id).toBe(3)
    expect(() => CrmLostSchema.parse({})).toThrow()
    expect(CrmAssignSchema.parse({ user_id: 5 }).user_id).toBe(5)
    expect(() => CrmAssignSchema.parse({ user_id: null })).toThrow()
  })
})

describe('CrmNotificationSchema', () => {
  const bell = {
    id: 9,
    kind: 'crm.followup_due',
    opportunity_id: 7,
    title: 'Mona',
    created_at: '2026-10-28T09:00:00Z',
    is_read: false,
  }

  it('accepts the bell dump of both kinds and nothing more', () => {
    expect(CrmNotificationSchema.parse(bell)).toEqual(bell)
    expect(CrmNotificationSchema.parse({ ...bell, kind: 'crm.assigned' }).kind).toBe('crm.assigned')
    expect(() => CrmNotificationSchema.parse({ ...bell, kind: 'assignment' })).toThrow()
    expect(() => CrmNotificationSchema.parse({ ...bell, body: 'x' })).toThrow()
    expect(() => CrmNotificationSchema.parse({ ...bell, opportunity_id: 0 })).toThrow()
  })

  it('still reads through the shared bell list as a dotted kind of a newer application', () => {
    expect(BellNotificationSchema.parse(bell).kind).toBe('crm.followup_due')
  })
})
