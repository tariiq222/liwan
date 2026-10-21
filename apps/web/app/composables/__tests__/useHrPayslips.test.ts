import { describe, expect, it, vi } from 'vitest'
import { fetchMyHrPayslip, fetchMyHrPayslips, hrMyPayslipKeys } from '../useHrPayslips'

describe('hrMyPayslipKeys', () => {
  it('keeps the own payslips apart from the run-scoped payslips', () => {
    expect(hrMyPayslipKeys.list).toEqual(['hr', 'payroll', 'payslips', 'mine'])
    expect(hrMyPayslipKeys.one(7)).toEqual(['hr', 'payroll', 'payslips', 'mine', 7])
  })
})

describe('own payslip requests', () => {
  it('lists the caller\'s approved payslips', async () => {
    const api = vi.fn().mockResolvedValue({ items: [], total: 0 })
    await fetchMyHrPayslips(api)
    expect(api).toHaveBeenCalledWith('/api/v1/hr/payroll/payslips/mine', { schema: expect.anything() })
  })

  it('reads one payslip through the own route, never the run route', async () => {
    const api = vi.fn().mockResolvedValue({})
    await fetchMyHrPayslip(api, 7)
    expect(api).toHaveBeenCalledWith('/api/v1/hr/payroll/payslips/mine/7', { schema: expect.anything() })
  })
})
