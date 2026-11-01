import { describe, expect, it, vi } from 'vitest'
import { QueryClient } from '@tanstack/vue-query'
import type { HrWarning } from '@liwan/contracts'
import { ApiError } from '../useApi'
import {
  acknowledgeHrWarning,
  contestHrWarning,
  createHrWarning,
  createHrWarningType,
  hrWarningKeys,
  hrWarningQuery,
  isHrWarningConflict,
  issueHrWarning,
  patchHrWarningType,
  withdrawHrWarning,
} from '../useHrWarnings'

function warning(over: Partial<HrWarning> = {}): HrWarning {
  return {
    id: 5, employee: { id: 7, name: 'Noura' }, type: { id: 2, name: 'Written warning', severity: 2 },
    date_issued: '2026-10-01', reason: 'Late three times', corrective_action: null, state: 'draft',
    acknowledgement: 'required', ack_pending: false, issued_by: null, issued_at: null, acknowledged_at: null,
    contested_at: null, contest_note: null, withdrawn_by: null, withdrawn_at: null, withdraw_reason: null, revision: 1,
    ...over,
  }
}

describe('hrWarningKeys', () => {
  it('keeps one stable root per resource under hr/warnings', () => {
    expect(hrWarningKeys.all).toEqual(['hr', 'warnings'])
    expect(hrWarningKeys.detail(5)).toEqual(['hr', 'warnings', 'detail', 5])
    expect(hrWarningKeys.candidates).toEqual(['hr', 'warnings', 'candidates'])
    expect(hrWarningKeys.standing(7)).toEqual(['hr', 'warnings', 'standing', 7])
    expect(hrWarningKeys.list({ limit: 25, offset: 0 })).toEqual(['hr', 'warnings', 'list', { limit: 25, offset: 0 }])
  })
})

describe('hrWarningQuery', () => {
  it('drops unset filters and clamps paging', () => {
    expect(hrWarningQuery({ employeeId: null, typeId: null, state: 'all' })).toEqual({
      employee_id: undefined, type_id: undefined, state: undefined, limit: 25, offset: 0,
    })
    expect(hrWarningQuery({ employeeId: 7, typeId: 2, state: 'issued', limit: 500, offset: -3 })).toEqual({
      employee_id: 7, type_id: 2, state: 'issued', limit: 100, offset: 0,
    })
    expect(hrWarningQuery({ limit: 0, offset: 10 })).toMatchObject({ limit: 25, offset: 10 })
  })
})

describe('the warning writes', () => {
  it('creates a draft, replaces the detail and refreshes every warning query', async () => {
    const qc = new QueryClient()
    const spy = vi.spyOn(qc, 'invalidateQueries')
    const created = warning({ id: 11 })
    const api = vi.fn().mockResolvedValue(created)
    const body = { employee_id: 7, type_id: 2, reason: 'Late three times' }
    await createHrWarning(api, qc, body)
    expect(api).toHaveBeenCalledWith('/api/v1/hr/warnings', { method: 'POST', body, schema: expect.anything() })
    expect(qc.getQueryData(hrWarningKeys.detail(11))).toEqual(created)
    expect(spy).toHaveBeenCalledWith({ queryKey: hrWarningKeys.all })
  })

  it('posts the revision on issue and the reason on withdraw', async () => {
    const qc = new QueryClient()
    const api = vi.fn().mockResolvedValue(warning({ state: 'issued' }))
    await issueHrWarning(api, qc, { id: 5, revision: 1 })
    expect(api).toHaveBeenLastCalledWith('/api/v1/hr/warnings/5/issue', { method: 'POST', body: { revision: 1 }, schema: expect.anything() })
    await withdrawHrWarning(api, qc, { id: 5, revision: 2, reason: 'Issued by mistake' })
    expect(api).toHaveBeenLastCalledWith('/api/v1/hr/warnings/5/withdraw', {
      method: 'POST', body: { revision: 2, reason: 'Issued by mistake' }, schema: expect.anything(),
    })
  })

  it('answers an own warning through the /me routes', async () => {
    const qc = new QueryClient()
    const api = vi.fn().mockResolvedValue(warning({ state: 'issued' }))
    await acknowledgeHrWarning(api, qc, { id: 5, revision: 2 })
    expect(api).toHaveBeenLastCalledWith('/api/v1/hr/warnings/me/5/acknowledge', { method: 'POST', body: { revision: 2 }, schema: expect.anything() })
    await contestHrWarning(api, qc, { id: 5, revision: 2, note: 'Not me' })
    expect(api).toHaveBeenLastCalledWith('/api/v1/hr/warnings/me/5/contest', {
      method: 'POST', body: { revision: 2, note: 'Not me' }, schema: expect.anything(),
    })
  })

  it('refreshes the warnings on a 409 and rethrows the refusal', async () => {
    const qc = new QueryClient()
    const spy = vi.spyOn(qc, 'invalidateQueries')
    const refusal = new ApiError(409, 'conflict', 'stale')
    const api = vi.fn().mockRejectedValue(refusal)
    await expect(issueHrWarning(api, qc, { id: 5, revision: 1 })).rejects.toBe(refusal)
    expect(spy).toHaveBeenCalledWith({ queryKey: hrWarningKeys.all })
    expect(isHrWarningConflict(refusal)).toBe(true)
    expect(isHrWarningConflict(new ApiError(422, 'invalid', 'x'))).toBe(false)
  })

  it('does not refresh the warnings on another refusal', async () => {
    const qc = new QueryClient()
    const spy = vi.spyOn(qc, 'invalidateQueries')
    const api = vi.fn().mockRejectedValue(new ApiError(422, 'invalid', 'bad'))
    await expect(withdrawHrWarning(api, qc, { id: 5, revision: 1, reason: 'x' })).rejects.toBeInstanceOf(ApiError)
    expect(spy).not.toHaveBeenCalled()
  })

  it('creates and patches a type and refreshes the type catalog', async () => {
    const qc = new QueryClient()
    const spy = vi.spyOn(qc, 'invalidateQueries')
    const type = { id: 3, name: 'Final', severity: 3, active: true, revision: 1 }
    const api = vi.fn().mockResolvedValue(type)
    await createHrWarningType(api, qc, { name: 'Final', severity: 3 })
    expect(api).toHaveBeenLastCalledWith('/api/v1/hr/warning-types', { method: 'POST', body: { name: 'Final', severity: 3 }, schema: expect.anything() })
    await patchHrWarningType(api, qc, { id: 3, body: { revision: 1, active: false } })
    expect(api).toHaveBeenLastCalledWith('/api/v1/hr/warning-types/3', { method: 'PATCH', body: { revision: 1, active: false }, schema: expect.anything() })
    expect(spy).toHaveBeenCalledWith({ queryKey: hrWarningKeys.types })
  })
})
