import type { HrGosiRate, HrGosiRateWrite, HrPayrollSettings, HrPayrollSettingsPatch } from '@liwan/contracts'

/** The settings form as the user left it: ids as picker strings, `annualLeaveType` empty until one is chosen. */
export interface PayrollSettingsDraft {
  dayDivisor: string
  unpaidLeaveTypes: string[]
  annualLeaveType: string | undefined
}

const sortedIds = (ids: number[]) => [...ids].sort((a, b) => a - b)

/** The changed settings; the form adds the revision its draft started from. */
export type PayrollSettingsChanges = Omit<HrPayrollSettingsPatch, 'revision'>

/** Only the settings the user changed; the annual leave type is required, so it is sent only once one is chosen. */
export function payrollSettingsPatch(settings: HrPayrollSettings, draft: PayrollSettingsDraft): PayrollSettingsChanges {
  const patch: PayrollSettingsChanges = {}
  if (Number(draft.dayDivisor) !== settings.day_divisor) patch.day_divisor = Number(draft.dayDivisor)
  const unpaid = sortedIds(draft.unpaidLeaveTypes.map(Number))
  if (unpaid.join() !== sortedIds(settings.unpaid_leave_types.map(type => type.id)).join()) patch.unpaid_leave_type_ids = unpaid
  if (draft.annualLeaveType && Number(draft.annualLeaveType) !== settings.annual_leave_type?.id) patch.annual_leave_type_id = Number(draft.annualLeaveType)
  return patch
}

/** Only the fields of a GOSI rate the user changed go to a PATCH. */
export function gosiRatePatch(rate: HrGosiRate, data: HrGosiRateWrite): Partial<HrGosiRateWrite> {
  const patch: Partial<HrGosiRateWrite> = {}
  for (const key of Object.keys(data) as (keyof HrGosiRateWrite)[]) {
    if (data[key] !== rate[key]) Object.assign(patch, { [key]: data[key] })
  }
  return patch
}
