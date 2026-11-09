import { describe, expect, it, vi } from 'vitest'
import { HrMyPayslipSchema, HrPayslipSchema } from '@liwan/contracts'
import { fetchMyHrPayslip, fetchMyHrPayslips, hrMyPayslipKeys } from '../useHrPayslips'

describe('hrMyPayslipKeys', () => {
  it('keeps the own payslips apart from the run-scoped payslips', () => {
    expect(hrMyPayslipKeys.page({ limit: 25, offset: 50 })).toEqual(['hr', 'payroll', 'payslips', 'mine', 'page', { limit: 25, offset: 50 }])
    expect(hrMyPayslipKeys.one(7)).toEqual(['hr', 'payroll', 'payslips', 'mine', 7])
  })
})

describe('own payslip requests', () => {
  it('lists one page of the caller\'s approved payslips', async () => {
    const api = vi.fn().mockResolvedValue({ items: [], total: 0 })
    await fetchMyHrPayslips(api, { limit: 25, offset: 25 })
    expect(api).toHaveBeenCalledWith('/api/v1/hr/payroll/payslips/mine', { query: { limit: 25, offset: 25 }, schema: expect.anything() })
  })

  it('reads one payslip through the own route, never the run route', async () => {
    const api = vi.fn().mockResolvedValue({})
    await fetchMyHrPayslip(api, 7)
    expect(api).toHaveBeenCalledWith('/api/v1/hr/payroll/payslips/mine/7', { schema: expect.anything() })
  })

  it('parses the own payslip with the shape without the employer figures', async () => {
    // The self-service route sends no employer GOSI share and no company tax number, so the payroll-area
    // shape refuses its body while the own shape accepts it: the two must not be the same parser.
    const own = { id: 7, number: 'SLIP/7', month: '2026-10', state: 'done', employee: { id: 3, name: 'ليلى' }, department: null, paid_days: 30, lines: [{ code: 'BASIC', name: 'الأساسي', category: 'BASIC', amount: 8000 }], gross: 10000, deductions: 900, net: 9100, currency: 'SAR', company: { name: 'شركة' } }
    const api = vi.fn().mockResolvedValue(own)
    const response = await fetchMyHrPayslip(api, 7)
    const { schema } = api.mock.calls[0]![1] as { schema: typeof HrMyPayslipSchema }
    expect(schema).toBe(HrMyPayslipSchema)
    expect(HrPayslipSchema.safeParse(response).success).toBe(false)
    expect(HrMyPayslipSchema.safeParse(response).success).toBe(true)
  })
})
