import { describe, expect, it, vi } from 'vitest'
import { QueryClient } from '@tanstack/vue-query'
import type { HrCompensation } from '@webvue/contracts'
import { ApiError } from '../useApi'
import { fetchHrCompensation, hrPayrollKeys, saveHrCompensation } from '../useHrPayrollCompensation'

const record = { employee: { id: 3, name: 'ليلى' }, basic_wage: 8000, fixed_wage: 8000 } as HrCompensation

describe('hrPayrollKeys', () => {
  it('keeps the compensation under hr/payroll', () => {
    expect(hrPayrollKeys.all).toEqual(['hr', 'payroll'])
    expect(hrPayrollKeys.compensation(3)).toEqual(['hr', 'payroll', 'compensation', 3])
  })
})

describe('fetchHrCompensation', () => {
  it('maps 404 to null', async () => {
    const api = vi.fn().mockRejectedValue(new ApiError(404, 'not_found', 'none'))
    expect(await fetchHrCompensation(api, 3)).toBeNull()
    expect(api).toHaveBeenCalledWith('/api/v1/hr/payroll/compensation/3', { schema: expect.anything() })
  })

  it('keeps any other failure an error', async () => {
    const api = vi.fn().mockRejectedValue(new ApiError(403, 'feature_not_included', 'off'))
    await expect(fetchHrCompensation(api, 3)).rejects.toMatchObject({ status: 403 })
  })

  it('returns the record', async () => {
    expect(await fetchHrCompensation(vi.fn().mockResolvedValue(record), 3)).toEqual(record)
  })
})

describe('saveHrCompensation', () => {
  it('PUT replaces the cached record', async () => {
    const qc = new QueryClient()
    qc.setQueryData(hrPayrollKeys.compensation(3), null)
    const api = vi.fn().mockResolvedValue(record)
    const body = { basic_wage: 8000 } as never
    const result = await saveHrCompensation(api, qc, 3, body)
    expect(api).toHaveBeenCalledWith('/api/v1/hr/payroll/compensation/3', { method: 'PUT', body, schema: expect.anything() })
    expect(result).toEqual(record)
    expect(qc.getQueryData(hrPayrollKeys.compensation(3))).toEqual(record)
  })
})
