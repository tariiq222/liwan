import { describe, expect, it, vi } from 'vitest'
import { QueryClient } from '@tanstack/vue-query'
import type { HrGosiRate, HrPayrollSettings } from '@webvue/contracts'
import { hrPayrollKeys } from '../useHrPayrollCompensation'
import { deleteHrGosiRate, patchHrPayrollSettings, saveHrGosiRate } from '../useHrPayrollSettings'

const settings = { day_divisor: 30 } as HrPayrollSettings
const rate = { id: 2, employee_rate: 9.5 } as HrGosiRate
const body = { branch: 'saned', nationality_class: 'gcc', date_from: '2026-01-01', employee_rate: 1, employer_rate: 1, wage_min: 0, wage_max: 100 } as const

describe('payroll settings writes', () => {
  it('PATCH replaces the cached settings with the answer', async () => {
    const qc = new QueryClient()
    const api = vi.fn().mockResolvedValue(settings)
    await patchHrPayrollSettings(api, qc, { day_divisor: 30 })
    expect(api).toHaveBeenCalledWith('/api/v1/hr/payroll/settings', { method: 'PATCH', body: { day_divisor: 30 }, schema: expect.anything() })
    expect(qc.getQueryData(hrPayrollKeys.settings)).toEqual(settings)
  })

  it('a GOSI rate without id is created, with an id it is patched', async () => {
    const api = vi.fn().mockResolvedValue(rate)
    const qc = new QueryClient()
    await saveHrGosiRate(api, qc, { body })
    expect(api).toHaveBeenLastCalledWith('/api/v1/hr/payroll/gosi-rates', { method: 'POST', body, schema: expect.anything() })
    await saveHrGosiRate(api, qc, { id: 2, body: { employee_rate: 9.5 } })
    expect(api).toHaveBeenLastCalledWith('/api/v1/hr/payroll/gosi-rates/2', { method: 'PATCH', body: { employee_rate: 9.5 }, schema: expect.anything() })
  })

  it('deleting a GOSI rate sends DELETE', async () => {
    const api = vi.fn().mockResolvedValue(undefined)
    await deleteHrGosiRate(api, new QueryClient(), 2)
    expect(api).toHaveBeenCalledWith('/api/v1/hr/payroll/gosi-rates/2', { method: 'DELETE' })
  })
})
