import { describe, expect, it, vi } from 'vitest'
import { QueryClient } from '@tanstack/vue-query'
import type { HrEquipment } from '@liwan/contracts'
import {
  archiveHrEquipment,
  assignHrEquipment,
  createHrAssetCategory,
  createHrEquipment,
  hrAssetKeys,
  hrEquipmentQuery,
  returnHrEquipment,
  updateHrEquipment,
} from '../useHrAssets'

function equipment(over: Partial<HrEquipment> = {}): HrEquipment {
  return {
    id: 5, name: 'MacBook Pro', category: { id: 2, name: 'Laptops' }, serial_no: 'SN-001', model: 'M4',
    employee: null, assign_date: '2026-05-01', warranty_date: null, scrap_date: null, active: true,
    ...over,
  } as HrEquipment
}

describe('hrAssetKeys', () => {
  it('keeps one stable root per resource under hr/assets', () => {
    expect(hrAssetKeys.all).toEqual(['hr', 'assets'])
    expect(hrAssetKeys.categories).toEqual(['hr', 'assets', 'categories'])
    expect(hrAssetKeys.mine).toEqual(['hr', 'assets', 'me'])
    expect(hrAssetKeys.equipment(5)).toEqual(['hr', 'assets', 'equipment', 'detail', 5])
    expect(hrAssetKeys.equipmentList({ limit: 25, offset: 0 })).toEqual([
      'hr', 'assets', 'equipment', 'list', { limit: 25, offset: 0 },
    ])
  })
})

describe('hrEquipmentQuery', () => {
  it('drops empty values, keeps the real filters and clamps paging', () => {
    expect(hrEquipmentQuery({ q: '  ', categoryId: null, employeeId: null, assigned: 'all' })).toEqual({
      q: undefined, category_id: undefined, employee_id: undefined, assigned: undefined,
      active: undefined, limit: 25, offset: 0,
    })
    expect(hrEquipmentQuery({ q: ' laptop ', categoryId: 2, employeeId: 7, assigned: 'true', active: 'false', limit: 500, offset: -3 })).toEqual({
      q: 'laptop', category_id: 2, employee_id: 7, assigned: 'true', active: 'false', limit: 100, offset: 0,
    })
    // `active=true` is the route default, so it is not sent; `all` and `false` are.
    expect(hrEquipmentQuery({ active: 'true' })).toMatchObject({ active: undefined })
    expect(hrEquipmentQuery({ active: 'all' })).toMatchObject({ active: 'all' })
    expect(hrEquipmentQuery({ limit: 0, offset: 10 })).toMatchObject({ limit: 25, offset: 10 })
  })
})

describe('the assets writes', () => {
  it('creates a category and refreshes the catalog', async () => {
    const qc = new QueryClient()
    const spy = vi.spyOn(qc, 'invalidateQueries')
    const created = { id: 9, name: 'Phones' }
    const api = vi.fn().mockResolvedValue(created)
    const body = { name: 'Phones' }
    const result = await createHrAssetCategory(api, qc, body)
    expect(api).toHaveBeenCalledWith('/api/v1/hr/assets/categories', {
      method: 'POST', body, schema: expect.anything(),
    })
    expect(result).toEqual(created)
    expect(spy).toHaveBeenCalledWith({ queryKey: hrAssetKeys.categories })
  })

  it('replaces the equipment detail and refreshes the lists and the caller custody', async () => {
    const qc = new QueryClient()
    const spy = vi.spyOn(qc, 'invalidateQueries')
    const created = equipment({ id: 11, name: 'iPhone' })
    const api = vi.fn().mockResolvedValue(created)
    const body = { name: 'iPhone', serial_no: 'SN-777' }
    await createHrEquipment(api, qc, body)
    expect(api).toHaveBeenCalledWith('/api/v1/hr/assets/equipment', {
      method: 'POST', body, schema: expect.anything(),
    })
    expect(qc.getQueryData(hrAssetKeys.equipment(11))).toEqual(created)
    expect(spy).toHaveBeenCalledWith({ queryKey: ['hr', 'assets', 'equipment', 'list'] })
    expect(spy).toHaveBeenCalledWith({ queryKey: hrAssetKeys.mine })
  })

  it('patches one equipment', async () => {
    const qc = new QueryClient()
    const patched = equipment({ name: 'MacBook Pro 16' })
    const api = vi.fn().mockResolvedValue(patched)
    await updateHrEquipment(api, qc, { id: 5, body: { name: 'MacBook Pro 16' } })
    expect(api).toHaveBeenCalledWith('/api/v1/hr/assets/equipment/5', {
      method: 'PATCH', body: { name: 'MacBook Pro 16' }, schema: expect.anything(),
    })
    expect(qc.getQueryData(hrAssetKeys.equipment(5))).toEqual(patched)
  })

  it('posts the assignment body and the empty return body', async () => {
    const qc = new QueryClient()
    const api = vi.fn().mockResolvedValue(equipment({ employee: { id: 7, name: 'Noura' } }))
    await assignHrEquipment(api, qc, { id: 5, employeeId: 7, assignDate: '2026-05-01' })
    expect(api).toHaveBeenCalledWith('/api/v1/hr/assets/equipment/5/assign', {
      method: 'POST', body: { employee_id: 7, assign_date: '2026-05-01' }, schema: expect.anything(),
    })
    expect(qc.getQueryData(hrAssetKeys.equipment(5))).toEqual(equipment({ employee: { id: 7, name: 'Noura' } }))

    const returned = vi.fn().mockResolvedValue(equipment())
    await returnHrEquipment(returned, qc, 5)
    expect(returned).toHaveBeenCalledWith('/api/v1/hr/assets/equipment/5/return', {
      method: 'POST', body: {}, schema: expect.anything(),
    })
  })

  it('posts the scrap date on archive', async () => {
    const qc = new QueryClient()
    const archived = equipment({ active: false, scrap_date: '2026-09-30' })
    const api = vi.fn().mockResolvedValue(archived)
    await archiveHrEquipment(api, qc, { id: 5, scrapDate: '2026-09-30' })
    expect(api).toHaveBeenCalledWith('/api/v1/hr/assets/equipment/5/archive', {
      method: 'POST', body: { scrap_date: '2026-09-30' }, schema: expect.anything(),
    })
    expect(qc.getQueryData(hrAssetKeys.equipment(5))).toEqual(archived)
  })
})
