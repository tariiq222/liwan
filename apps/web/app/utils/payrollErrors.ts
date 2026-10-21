import { ApiError } from '../composables/useApi'

type Translate = (key: string, params?: Record<string, unknown>) => string

// The refusals of the payroll routes that have their own text on the page; the server's message is English.
const OWN_TEXT = new Set(['duplicate', 'transition_forbidden', 'structure_missing', 'contract_missing', 'gosi_rate_missing', 'payroll_structure_mismatch', 'compensation_missing', 'settlement_missing', 'period_locked', 'missing_cost_center', 'settings_incomplete'])

function employeeIds(error: ApiError): number[] {
  const ids = error.details?.employee_ids
  return Array.isArray(ids) ? ids.filter((id): id is number => typeof id === 'number') : []
}

/** The text a refused payroll write shows: its own message for the known codes, otherwise the server's. */
export function payrollErrorMessage(error: unknown, t: Translate, employeeNames: ReadonlyMap<number, string>): string {
  if (!(error instanceof ApiError)) return t('errors.generic')
  if (error.status === 0) return t('errors.saveUncertain')
  if (OWN_TEXT.has(error.code)) return t(`hrPayroll.errors.${error.code}`)
  if (error.code === 'negative_net') {
    const ids = employeeIds(error)
    const names = ids.flatMap(id => employeeNames.get(id) ?? [])
    return t('hrPayroll.errors.negative_net', { names: names.join('، '), count: ids.length })
  }
  if (error.code === 'invalid' && error.details?.reason === 'not_editable') return t('hrPayroll.errors.notEditable')
  return error.message || t('errors.generic')
}
