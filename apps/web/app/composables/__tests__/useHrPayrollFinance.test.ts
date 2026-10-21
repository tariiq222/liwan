import { describe, expect, it, vi } from 'vitest'
import { QueryClient } from '@tanstack/vue-query'
import type { HrPayrollRun } from '@webvue/contracts'
import { hrPayrollKeys } from '../useHrPayrollCompensation'
import {
  fetchHrPayrollPostingPreview,
  patchHrPayrollFinanceSettings,
  postHrPayrollRun,
  recordHrPayrollPayment,
  setHrPayrollCostCenter,
} from '../useHrPayrollFinance'

const approved = { id: 4, month: '2026-10', state: 'approved', allowed_actions: ['post'] } as HrPayrollRun
const posted = { ...approved, state: 'posted', allowed_actions: ['record_payment'] } as HrPayrollRun
const paid = { ...posted, state: 'paid', allowed_actions: [] } as HrPayrollRun

describe('payroll finance calls', () => {
  it('post stays pending until the server answers', async () => {
    const qc = new QueryClient()
    qc.setQueryData(hrPayrollKeys.run(4), approved)
    let answer!: (value: HrPayrollRun) => void
    const api = vi.fn(() => new Promise<HrPayrollRun>((resolve) => { answer = resolve }))
    const pending = postHrPayrollRun(api as never, qc, 4)
    await Promise.resolve()
    expect(api).toHaveBeenCalledWith('/api/v1/hr/payroll/runs/4/post', { method: 'POST', body: {}, schema: expect.anything() })
    expect(qc.getQueryData<HrPayrollRun>(hrPayrollKeys.run(4))?.state).toBe('approved')
    answer(posted)
    await pending
    expect(qc.getQueryData<HrPayrollRun>(hrPayrollKeys.run(4))?.state).toBe('posted')
  })

  it('a refused post leaves the cached run untouched', async () => {
    const qc = new QueryClient()
    qc.setQueryData(hrPayrollKeys.run(4), approved)
    const api = vi.fn().mockRejectedValue(new Error('period_locked'))
    await expect(postHrPayrollRun(api, qc, 4)).rejects.toThrow('period_locked')
    expect(qc.getQueryData<HrPayrollRun>(hrPayrollKeys.run(4))?.state).toBe('approved')
  })

  it('the payment POSTs the journal and date and replaces the run', async () => {
    const qc = new QueryClient()
    const api = vi.fn().mockResolvedValue(paid)
    const body = { journal_id: 5, date: '2026-11-01' }
    await recordHrPayrollPayment(api, qc, 4, body)
    expect(api).toHaveBeenCalledWith('/api/v1/hr/payroll/runs/4/payment', { method: 'POST', body, schema: expect.anything() })
    expect(qc.getQueryData<HrPayrollRun>(hrPayrollKeys.run(4))?.state).toBe('paid')
  })

  it('the posting preview is read from the run', async () => {
    const api = vi.fn().mockResolvedValue({})
    await fetchHrPayrollPostingPreview(api, 4)
    expect(api).toHaveBeenCalledWith('/api/v1/hr/payroll/runs/4/posting-preview', { schema: expect.anything() })
  })

  it('the finance settings PATCH replaces the cached settings', async () => {
    const qc = new QueryClient()
    const settings = { entry_detail: 'per_employee' }
    const api = vi.fn().mockResolvedValue(settings)
    await patchHrPayrollFinanceSettings(api, qc, { entry_detail: 'per_employee' })
    expect(api).toHaveBeenCalledWith('/api/v1/hr/payroll/finance-settings', { method: 'PATCH', body: { entry_detail: 'per_employee' }, schema: expect.anything() })
    expect(qc.getQueryData(hrPayrollKeys.financeSettings)).toEqual(settings)
  })

  it('a cost center PUT sends the analytic account and refreshes the list', async () => {
    const qc = new QueryClient()
    const api = vi.fn().mockResolvedValue({ department: { id: 2, name: 'د' }, analytic_account: null })
    await setHrPayrollCostCenter(api, qc, 2, null)
    expect(api).toHaveBeenCalledWith('/api/v1/hr/payroll/cost-centers/2', { method: 'PUT', body: { analytic_account_id: null }, schema: expect.anything() })
  })
})
