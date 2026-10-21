import {
  HR_PAYROLL_ACCOUNT_ROLES,
  type HrPayrollAccountRole,
  type HrPayrollEntryDetail,
  type HrPayrollFinanceSettings,
  type HrPayrollFinanceSettingsPatch,
} from '@webvue/contracts'

/** The picker value that means "no record": a select item cannot carry an empty value. */
export const NO_RECORD = 'none'

/** The finance mapping form as the user left it: ids as picker strings, `NO_RECORD` for a cleared reference. */
export interface PayrollFinanceDraft {
  journal: string
  defaultAnalytic: string
  entryDetail: HrPayrollEntryDetail
  accounts: Record<HrPayrollAccountRole, string>
}

const pickerValue = (record: { id: number } | null) => record ? String(record.id) : NO_RECORD
const recordId = (value: string) => value === NO_RECORD ? null : Number(value)

export function payrollFinanceDraft(settings: HrPayrollFinanceSettings): PayrollFinanceDraft {
  return {
    journal: pickerValue(settings.journal),
    defaultAnalytic: pickerValue(settings.default_analytic_account),
    entryDetail: settings.entry_detail,
    accounts: Object.fromEntries(HR_PAYROLL_ACCOUNT_ROLES.map(role => [role, pickerValue(settings.accounts[role])])) as PayrollFinanceDraft['accounts'],
  }
}

/** Only the parts of the mapping the user changed. */
export function payrollFinancePatch(settings: HrPayrollFinanceSettings, draft: PayrollFinanceDraft): HrPayrollFinanceSettingsPatch {
  const before = payrollFinanceDraft(settings)
  const patch: HrPayrollFinanceSettingsPatch = {}
  if (draft.journal !== before.journal) patch.journal_id = recordId(draft.journal)
  if (draft.defaultAnalytic !== before.defaultAnalytic) patch.default_analytic_account_id = recordId(draft.defaultAnalytic)
  if (draft.entryDetail !== before.entryDetail) patch.entry_detail = draft.entryDetail
  const accounts: Partial<Record<HrPayrollAccountRole, number | null>> = {}
  for (const role of HR_PAYROLL_ACCOUNT_ROLES) {
    if (draft.accounts[role] !== before.accounts[role]) accounts[role] = recordId(draft.accounts[role])
  }
  if (Object.keys(accounts).length > 0) patch.accounts = accounts
  return patch
}
