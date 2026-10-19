import { describe, expect, it } from 'vitest'
import {
  HrActivityPlanSchema,
  HrDepartureCreateSchema,
  HrDepartureListSchema,
  HrDeparturePatchSchema,
  HrDepartureReasonListSchema,
  HrDepartureSchema,
  HrPlanRunDetailSchema,
} from '..'

const DEPARTURE = {
  employee: { id: 10, name: 'Noura' },
  active: false,
  departure_date: '2026-11-30',
  reason: { id: 3, name: 'استقالة' },
  description: 'استقالة شخصية',
  clearance: { run_id: 8, done: 1, total: 3 },
}

describe('HrDepartureSchema', () => {
  it('accepts departures inside the list envelope', () => {
    const parsed = HrDepartureListSchema.parse({ items: [DEPARTURE], total: 1 })
    expect(parsed.items[0]?.clearance.run_id).toBe(8)
    expect(parsed.items[0]?.clearance.total).toBe(3)
  })

  it('accepts a departure without a clearance run and without a reason', () => {
    const bare = { ...DEPARTURE, reason: null, description: '', clearance: { run_id: null, done: 0, total: 0 } }
    expect(HrDepartureSchema.parse(bare).clearance.run_id).toBeNull()
    expect(HrDepartureSchema.parse(bare).reason).toBeNull()
  })

  it('rejects a missing clearance, a bad date and extra keys', () => {
    expect(() => HrDepartureSchema.parse({ ...DEPARTURE, clearance: undefined })).toThrow()
    expect(() => HrDepartureSchema.parse({ ...DEPARTURE, departure_date: '30/11/2026' })).toThrow()
    expect(() => HrDepartureSchema.parse({ ...DEPARTURE, employee_id: 10 })).toThrow()
    expect(() => HrDepartureListSchema.parse({ items: [DEPARTURE] })).toThrow()
  })
})

describe('departure writes', () => {
  it('accepts a registration with and without a clearance plan', () => {
    const payload = {
      employee_id: 10,
      departure_date: '2026-11-30',
      departure_reason_id: 3,
    }
    expect(HrDepartureCreateSchema.parse(payload).set_contract_end).toBeUndefined()
    const withPlan = HrDepartureCreateSchema.parse({
      ...payload, description: 'استقالة', set_contract_end: false, plan_id: 4,
    })
    expect(withPlan.plan_id).toBe(4)
    expect(withPlan.set_contract_end).toBe(false)
  })

  it('rejects an incomplete registration and unknown keys', () => {
    expect(() => HrDepartureCreateSchema.parse({ employee_id: 10, departure_date: '2026-11-30' })).toThrow()
    expect(() => HrDepartureCreateSchema.parse({
      employee_id: 10, departure_date: '2026-11-30', departure_reason_id: 3, employee_termination: true,
    })).toThrow()
  })

  it('accepts non-empty patches and refuses an empty one', () => {
    expect(HrDeparturePatchSchema.parse({ description: '' })).toEqual({ description: '' })
    expect(() => HrDeparturePatchSchema.parse({})).toThrow()
    expect(() => HrDeparturePatchSchema.parse({ active: false })).toThrow()
  })
})

describe('departure reasons and the re-exported plan shapes', () => {
  it('accepts a reason list and keeps the onboarding plan shapes re-exported', () => {
    expect(HrDepartureReasonListSchema.parse({ items: [{ id: 3, name: 'استقالة' }], total: 1 }).total).toBe(1)
    expect(HrActivityPlanSchema).toBeDefined()
    expect(HrPlanRunDetailSchema).toBeDefined()
  })
})
