import { describe, expect, it, vi } from 'vitest'
import { QueryClient } from '@tanstack/vue-query'
import type { HrSettlement } from '@liwan/contracts'
import { hrPayrollKeys } from '../useHrPayrollCompensation'
import {
  confirmHrSettlement,
  fetchHrEosEstimate,
  fetchHrSettlement,
  postHrEosProvision,
  saveHrEosCase,
  saveHrSettlement,
} from '../useHrPayrollEos'

const draft = { employee: { id: 3, name: 'ليلى' }, state: 'draft', case: 'resignation' } as HrSettlement
const confirmed = { ...draft, state: 'confirmed' } as HrSettlement

describe('end of service calls', () => {
  it('the estimate asks for the date and the case', async () => {
    const api = vi.fn().mockResolvedValue({})
    await fetchHrEosEstimate(api, 3, { date: '2026-11-30', case: 'termination' })
    expect(api).toHaveBeenCalledWith('/api/v1/hr/payroll/eos/3/estimate', { query: { date: '2026-11-30', case: 'termination' }, schema: expect.anything() })
  })

  it('an employee without a settlement answers 404: nothing recorded yet', async () => {
    const { ApiError } = await import('../useApi')
    const api = vi.fn().mockRejectedValue(new ApiError(404, 'not_found', 'x'))
    expect(await fetchHrSettlement(api, 3)).toBeNull()
    const broken = vi.fn().mockRejectedValue(new ApiError(500, 'server_error', 'x'))
    await expect(fetchHrSettlement(broken, 3)).rejects.toThrow()
  })

  it('saving PUTs the case and the open deductions and replaces the cached settlement', async () => {
    const qc = new QueryClient()
    const api = vi.fn().mockResolvedValue(draft)
    await saveHrSettlement(api, qc, 3, { case: 'resignation', open_deductions: 300 })
    expect(api).toHaveBeenCalledWith('/api/v1/hr/payroll/eos/3/settlement', { method: 'PUT', body: { case: 'resignation', open_deductions: 300 }, schema: expect.anything() })
    expect(qc.getQueryData<HrSettlement>(hrPayrollKeys.settlement(3))?.state).toBe('draft')
  })

  it('confirm stays pending until the server answers', async () => {
    const qc = new QueryClient()
    qc.setQueryData(hrPayrollKeys.settlement(3), draft)
    let answer!: (value: HrSettlement) => void
    const api = vi.fn(() => new Promise<HrSettlement>((resolve) => { answer = resolve }))
    const pending = confirmHrSettlement(api as never, qc, 3)
    await Promise.resolve()
    expect(api).toHaveBeenCalledWith('/api/v1/hr/payroll/eos/3/settlement/confirm', { method: 'POST', body: {}, schema: expect.anything() })
    expect(qc.getQueryData<HrSettlement>(hrPayrollKeys.settlement(3))?.state).toBe('draft')
    answer(confirmed)
    await pending
    expect(qc.getQueryData<HrSettlement>(hrPayrollKeys.settlement(3))?.state).toBe('confirmed')
  })

  it('a refused confirm leaves the cached settlement untouched', async () => {
    const qc = new QueryClient()
    qc.setQueryData(hrPayrollKeys.settlement(3), draft)
    const api = vi.fn().mockRejectedValue(new Error('transition_forbidden'))
    await expect(confirmHrSettlement(api, qc, 3)).rejects.toThrow('transition_forbidden')
    expect(qc.getQueryData<HrSettlement>(hrPayrollKeys.settlement(3))?.state).toBe('draft')
  })

  it('a case mapping PUT refreshes the mapping list', async () => {
    const qc = new QueryClient()
    const spy = vi.spyOn(qc, 'invalidateQueries')
    const api = vi.fn().mockResolvedValue({ departure_reason: { id: 2, name: 'x' }, case: 'no_award', revision: 1 })
    await saveHrEosCase(api, qc, { departure_reason_id: 2, case: 'no_award', revision: 0 })
    expect(api).toHaveBeenCalledWith('/api/v1/hr/payroll/eos-cases', { method: 'PUT', body: { departure_reason_id: 2, case: 'no_award', revision: 0 }, schema: expect.anything() })
    expect(spy).toHaveBeenCalledWith({ queryKey: hrPayrollKeys.eosCases })
  })

  it('the provision POSTs the month and refreshes the provisions and the runs', async () => {
    const qc = new QueryClient()
    const spy = vi.spyOn(qc, 'invalidateQueries')
    const api = vi.fn().mockResolvedValue({ month: '2026-10', entry_id: 9, entry_name: 'JE', amount: 5 })
    await postHrEosProvision(api, qc, '2026-10')
    expect(api).toHaveBeenCalledWith('/api/v1/hr/payroll/eos-provisions', { method: 'POST', body: { month: '2026-10' }, schema: expect.anything() })
    expect(spy).toHaveBeenCalledWith({ queryKey: hrPayrollKeys.eosProvisions })
    expect(spy).toHaveBeenCalledWith({ queryKey: hrPayrollKeys.runs })
  })
})
