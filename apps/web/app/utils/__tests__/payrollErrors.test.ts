import { describe, expect, it } from 'vitest'
import { ApiError } from '../../composables/useApi'
import { payrollErrorMessage } from '../payrollErrors'

const t = (key: string, params?: Record<string, unknown>) => params ? `${key}:${JSON.stringify(params)}` : key
const names = new Map([[3, 'ليلى'], [4, 'سارة']])

describe('payrollErrorMessage', () => {
  it.each(['duplicate', 'transition_forbidden', 'structure_missing', 'contract_missing', 'gosi_rate_missing', 'payroll_structure_mismatch'])(
    'shows the own text of %s', (code) => {
      expect(payrollErrorMessage(new ApiError(422, code, 'raw'), t, names)).toBe(`hrPayroll.errors.${code}`)
    },
  )

  it('lists the employees of a negative net by name and falls back to the count', () => {
    const error = new ApiError(422, 'negative_net', 'raw', undefined, { employee_ids: [3, 9] })
    expect(payrollErrorMessage(error, t, names)).toBe('hrPayroll.errors.negative_net:{"names":"ليلى","count":2}')
  })

  it('says a run that can no longer be edited is locked', () => {
    const error = new ApiError(422, 'invalid', 'raw', 'state', { reason: 'not_editable' })
    expect(payrollErrorMessage(error, t, names)).toBe('hrPayroll.errors.notEditable')
  })

  it('keeps the server message of any other refusal and the generic text of a non-API error', () => {
    expect(payrollErrorMessage(new ApiError(422, 'invalid', 'bonus_amount must be zero or more', 'bonus_amount'), t, names)).toBe('bonus_amount must be zero or more')
    expect(payrollErrorMessage(new Error('boom'), t, names)).toBe('errors.generic')
    expect(payrollErrorMessage(new ApiError(0, 'http_error', 'offline'), t, names)).toBe('errors.saveUncertain')
  })
})
