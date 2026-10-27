import { describe, expect, it, vi } from 'vitest'
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
})
