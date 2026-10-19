import { describe, expect, it } from 'vitest'
import {
  HrAssetCategoryCreateSchema,
  HrAssetCategoryListSchema,
  HrEquipmentArchiveSchema,
  HrEquipmentAssignSchema,
  HrEquipmentCreateSchema,
  HrEquipmentListSchema,
  HrEquipmentPatchSchema,
  HrEquipmentSchema,
} from '..'

const EQUIPMENT = {
  id: 6,
  name: 'حاسب محمول',
  category: { id: 2, name: 'أجهزة' },
  serial_no: 'SN-001',
  model: 'ThinkPad',
  employee: { id: 10, name: 'Noura' },
  assign_date: '2026-11-02',
  warranty_date: '2028-01-01',
  scrap_date: null,
  active: true,
}

describe('HrEquipmentSchema', () => {
  it('accepts the custody register inside the list envelope', () => {
    const parsed = HrEquipmentListSchema.parse({ items: [EQUIPMENT], total: 1 })
    expect(parsed.items[0]?.employee?.id).toBe(10)
    expect(parsed.items[0]?.assign_date).toBe('2026-11-02')
  })

  it('accepts unassigned, uncategorised and archived equipment', () => {
    const loose = {
      ...EQUIPMENT, category: null, employee: null, assign_date: null,
      serial_no: '', model: '', warranty_date: null, scrap_date: '2026-12-31', active: false,
    }
    expect(HrEquipmentSchema.parse(loose).employee).toBeNull()
    expect(HrEquipmentSchema.parse(loose).active).toBe(false)
  })

  it('rejects the excluded compensation and vendor fields', () => {
    expect(() => HrEquipmentSchema.parse({ ...EQUIPMENT, cost: 1200 })).toThrow()
    expect(() => HrEquipmentSchema.parse({ ...EQUIPMENT, partner_id: 3 })).toThrow()
    expect(() => HrEquipmentSchema.parse({ ...EQUIPMENT, maintenance_request_ids: [1] })).toThrow()
    expect(() => HrEquipmentListSchema.parse({ items: [EQUIPMENT] })).toThrow()
  })
})

describe('asset writes', () => {
  it('accepts a category create and a strict equipment create', () => {
    expect(HrAssetCategoryCreateSchema.parse({ name: ' أجهزة ' }).name).toBe('أجهزة')
    expect(HrAssetCategoryListSchema.parse({ items: [{ id: 2, name: 'أجهزة' }], total: 1 }).total).toBe(1)
    expect(HrEquipmentCreateSchema.parse({ name: 'حاسب', category_id: null }).category_id).toBeNull()
  })

  it('rejects a blank equipment name and unknown create keys', () => {
    expect(() => HrEquipmentCreateSchema.parse({ name: '  ' })).toThrow()
    expect(() => HrEquipmentCreateSchema.parse({ name: 'حاسب', cost: 1 })).toThrow()
  })

  it('accepts non-empty patches and refuses an empty one', () => {
    expect(HrEquipmentPatchSchema.parse({ warranty_date: null })).toEqual({ warranty_date: null })
    expect(HrEquipmentPatchSchema.parse({ name: 'حاسب' }).name).toBe('حاسب')
    expect(() => HrEquipmentPatchSchema.parse({})).toThrow()
  })

  it('validates the assign and archive payloads', () => {
    expect(HrEquipmentAssignSchema.parse({ employee_id: 10 }).assign_date).toBeUndefined()
    expect(HrEquipmentAssignSchema.parse({ employee_id: 10, assign_date: '2026-11-02' }).assign_date).toBe('2026-11-02')
    expect(() => HrEquipmentAssignSchema.parse({})).toThrow()
    expect(HrEquipmentArchiveSchema.parse({}).scrap_date).toBeUndefined()
    expect(() => HrEquipmentArchiveSchema.parse({ scrap_date: '2026/12/31' })).toThrow()
  })
})
