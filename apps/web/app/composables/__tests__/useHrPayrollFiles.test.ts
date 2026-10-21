import { describe, expect, it, vi } from 'vitest'
import { QueryClient } from '@tanstack/vue-query'
import type { HrBankProfile, HrBankProfileWrite } from '@webvue/contracts'
import { hrPayrollKeys } from '../useHrPayrollCompensation'
import { deleteHrBankProfile, downloadHrPayrollFile, hrPayrollFileUrl, saveHrBankProfile } from '../useHrPayrollFiles'

const profile = { id: 4, name: 'ملف' } as HrBankProfile
const body = {
  name: 'ملف',
  kind: 'bank' as const,
  delimiter: ',' as const,
  encoding: 'utf-8' as const,
  include_header: true,
  footer: 'none' as const,
  columns: [{ source: 'iban' as const, label: 'IBAN', constant_value: '' }],
} satisfies HrBankProfileWrite

describe('payroll salary files', () => {
  it('builds the bank file url with the profile and the value date', () => {
    expect(hrPayrollFileUrl(7, 'bank', { profileId: 1, valueDate: '2026-12-01' }))
      .toBe('/api/v1/hr/payroll/runs/7/bank-file?profile_id=1&value_date=2026-12-01')
  })

  it('builds the WPS file url without a value date', () => {
    expect(hrPayrollFileUrl(7, 'wps', { profileId: 2 })).toBe('/api/v1/hr/payroll/runs/7/wps-file?profile_id=2')
  })

  it('downloads through the raw download of useApi, once', async () => {
    const result = { blob: new Blob(['a']), filename: 'salaries-2026-10.csv' }
    const download = vi.fn().mockResolvedValue(result)
    await expect(downloadHrPayrollFile(download, 7, 'bank', { profileId: 1 })).resolves.toBe(result)
    expect(download).toHaveBeenCalledTimes(1)
    expect(download).toHaveBeenCalledWith('/api/v1/hr/payroll/runs/7/bank-file?profile_id=1')
  })
})

describe('bank profile writes', () => {
  it('a profile without id is created, with an id it is patched', async () => {
    const api = vi.fn().mockResolvedValue(profile)
    const qc = new QueryClient()
    const invalidate = vi.spyOn(qc, 'invalidateQueries')
    await saveHrBankProfile(api, qc, { body })
    expect(api).toHaveBeenLastCalledWith('/api/v1/hr/payroll/bank-profiles', { method: 'POST', body, schema: expect.anything() })
    await saveHrBankProfile(api, qc, { id: 4, body: { name: 'جديد' } })
    expect(api).toHaveBeenLastCalledWith('/api/v1/hr/payroll/bank-profiles/4', { method: 'PATCH', body: { name: 'جديد' }, schema: expect.anything() })
    expect(invalidate).toHaveBeenCalledWith({ queryKey: hrPayrollKeys.bankProfiles })
  })

  it('deleting a profile sends DELETE', async () => {
    const api = vi.fn().mockResolvedValue(undefined)
    await deleteHrBankProfile(api, new QueryClient(), 4)
    expect(api).toHaveBeenCalledWith('/api/v1/hr/payroll/bank-profiles/4', { method: 'DELETE' })
  })
})
