import { ApiError } from '../composables/useApi'

type Translate = (key: string, params?: Record<string, unknown>) => string

// The refusals of the payroll routes that have their own text on the page; the server's message is English.
const OWN_TEXT = new Set(['duplicate', 'transition_forbidden', 'structure_missing', 'contract_missing', 'gosi_rate_missing', 'payroll_structure_mismatch', 'compensation_missing', 'settlement_missing', 'settlement_changed', 'annual_leave_type_missing', 'departure_missing', 'eos_case_missing', 'period_locked', 'missing_cost_center', 'settings_incomplete', 'wps_totals_mismatch'])
// The refusals that list the employees they name.
const NAMING = new Set(['negative_net', 'missing_iban', 'run_stale'])

function employeeIds(error: ApiError): number[] {
  const ids = error.details?.employee_ids
  return Array.isArray(ids) ? ids.filter((id): id is number => typeof id === 'number') : []
}

/** The text a refused payroll write shows: its own message for the known codes, otherwise the server's. */
export function payrollErrorMessage(error: unknown, t: Translate, employeeNames: ReadonlyMap<number, string>): string {
  if (!(error instanceof ApiError)) return t('errors.generic')
  if (error.status === 0) return t('errors.saveUncertain')
  if (OWN_TEXT.has(error.code)) return t(`hrPayroll.errors.${error.code}`)
  if (NAMING.has(error.code)) {
    const ids = employeeIds(error)
    const names = ids.flatMap(id => employeeNames.get(id) ?? [])
    return t(`hrPayroll.errors.${error.code}${names.length ? '' : '_count'}`, { names: names.join('، '), count: ids.length })
  }
  if (error.code === 'invalid' && error.details?.reason === 'not_editable') return t('hrPayroll.errors.notEditable')
  // Only the settlement estimate names the service start; the other `invalid` date is the payment date.
  if (error.code === 'invalid' && error.field === 'date') return t(error.details?.start_date !== undefined ? 'hrPayroll.errors.departureBeforeStart' : 'hrPayroll.errors.paymentBeforeEntry')
  return error.message || t('errors.generic')
}

/** The refusals of the end-of-service provision have their own wording: the run's `duplicate` text would be wrong for them. */
export function eosProvisionErrorMessage(error: unknown, t: Translate): string {
  if (error instanceof ApiError && error.code === 'duplicate') return t('hrPayroll.errors.eos_provision_duplicate')
  if (error instanceof ApiError && error.code === 'invalid' && error.field === 'month') return t('hrPayroll.errors.eos_provision_empty')
  return payrollErrorMessage(error, t, new Map())
}
