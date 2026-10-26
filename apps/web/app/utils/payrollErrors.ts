import { ApiError } from '../composables/useApi'

type Translate = (key: string, params?: Record<string, unknown>) => string

// The refusals of the payroll routes that have their own text on the page; the server's message is English.
const OWN_TEXT = new Set(['duplicate', 'transition_forbidden', 'structure_missing', 'contract_missing', 'gosi_rate_missing', 'payroll_structure_mismatch', 'compensation_missing', 'settlement_missing', 'settlement_changed', 'annual_leave_type_missing', 'departure_missing', 'eos_case_missing', 'period_locked', 'missing_cost_center', 'settings_incomplete', 'wps_totals_mismatch', 'run_empty', 'nationality_missing', 'gosi_registration_missing', 'provision_after_run', 'profile_in_use', 'profile_unavailable'])
// The refusals that list the employees they name.
const NAMING = new Set(['negative_net', 'missing_iban', 'run_stale'])

function employeeIds(error: ApiError): number[] {
  const ids = error.details?.employee_ids
  return Array.isArray(ids) ? ids.filter((id): id is number => typeof id === 'number') : []
}

/** The text a refused payroll write shows: its own message for the known codes, otherwise the generic one. */
export function payrollErrorMessage(error: unknown, t: Translate, employeeNames: ReadonlyMap<number, string>): string {
  if (!(error instanceof ApiError)) return t('errors.generic')
  if (error.status === 0) return t('errors.saveUncertain')
  // The one `transition_forbidden` that is about the caller, not the run's state: approving your own payslip.
  if (error.code === 'transition_forbidden' && error.field === 'employee_id') return t('hrPayroll.errors.ownRecordForbidden')
  // Approved (or later) run: inputs are locked — keep the precise wording, not the generic transition text.
  if (error.code === 'transition_forbidden' && error.details?.reason === 'not_editable') return t('hrPayroll.errors.notEditable')
  if (OWN_TEXT.has(error.code)) return t(`hrPayroll.errors.${error.code}`)
  if (NAMING.has(error.code)) {
    const ids = employeeIds(error)
    const names = ids.flatMap(id => employeeNames.get(id) ?? [])
    return t(`hrPayroll.errors.${error.code}${names.length ? '' : '_count'}`, { names: names.join('، '), count: ids.length })
  }
  // The GOSI rate form: a second row for a branch and class on the same date, or a maximum below the minimum.
  if (error.code === 'invalid' && error.field === 'date_from') return t('hrPayroll.errors.rateDuplicate')
  if (error.code === 'invalid' && error.field === 'wage_max') return t('hrPayroll.errors.wageRange')
  // Only the settlement estimate names the service start; the other `invalid` date is the payment date.
  if (error.code === 'invalid' && error.field === 'date') return t(error.details?.start_date !== undefined ? 'hrPayroll.errors.departureBeforeStart' : 'hrPayroll.errors.paymentBeforeEntry')
  return t('errors.generic')
}

/** The text of a refusal the server attributed to ``field``, in the page's own words; nothing for another field. */
export function payrollFieldError(error: unknown, t: Translate, field: string): string | undefined {
  if (!(error instanceof ApiError) || error.field !== field) return undefined
  return payrollErrorMessage(error, t, new Map())
}

/** The refusals of the end-of-service provision have their own wording: the run's `duplicate` text would be wrong for them. */
export function eosProvisionErrorMessage(error: unknown, t: Translate): string {
  if (error instanceof ApiError && error.code === 'duplicate') return t('hrPayroll.errors.eos_provision_duplicate')
  if (error instanceof ApiError && error.code === 'invalid' && error.field === 'month') return t('hrPayroll.errors.eos_provision_empty')
  return payrollErrorMessage(error, t, new Map())
}

/** A payroll settings write sent a revision someone else has changed since: the form keeps its draft and offers a reload. */
export function isPayrollConflict(error: unknown): boolean {
  return error instanceof ApiError && error.status === 409 && error.code === 'conflict'
}
