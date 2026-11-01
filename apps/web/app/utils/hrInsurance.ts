import type { HrInsuranceEnrollmentState, HrInsurancePlan, HrInsurancePlanState } from '@liwan/contracts'
import type { StatusBadgeEntry } from '@liwan/ui/app/utils/statusBadge'

const PLAN_TONE: Record<HrInsurancePlanState, StatusBadgeEntry['tone']> = {
  active: 'success',
  expired: 'warning',
  archived: 'neutral',
}
const ENROLLMENT_TONE: Record<HrInsuranceEnrollmentState, StatusBadgeEntry['tone']> = {
  active: 'success',
  ended: 'neutral',
  cancelled: 'neutral',
}

/** A plan's derived state: active success, expired warning, archived neutral. */
export function hrInsurancePlanBadge(state: HrInsurancePlanState): StatusBadgeEntry {
  return { tone: PLAN_TONE[state], labelKey: `hrInsurance.planState.${state}` }
}

/** An enrollment's state: active success, ended and cancelled neutral. */
export function hrInsuranceEnrollmentBadge(state: HrInsuranceEnrollmentState): StatusBadgeEntry {
  return { tone: ENROLLMENT_TONE[state], labelKey: `hrInsurance.enrollmentState.${state}` }
}

/** A plan that ends inside the company's alert window and is still running. */
export function isHrInsurancePlanExpiring(plan: Pick<HrInsurancePlan, 'state' | 'expires_in_days'>, alertDays: number): boolean {
  return plan.state === 'active' && plan.expires_in_days !== null && plan.expires_in_days <= alertDays
}

/** The coverage text of an enrollment: its dates, or the open end when it runs to the end of its plan. */
export function hrInsuranceCoverage(enrollment: { date_from: string; date_to: string | null; date_end: string }) {
  return { from: enrollment.date_from, to: enrollment.date_end, open: enrollment.date_to === null }
}

/** Only an active enrollment takes dependents, changes or an end date; the rest is history. */
export function canChangeHrInsuranceEnrollment(enrollment: { state: HrInsuranceEnrollmentState }, canManage: boolean): boolean {
  return canManage && enrollment.state === 'active'
}

/** Monthly shares as a single figure, or null when neither share is recorded. */
export function hrInsuranceShareTotal(enrollment: { employee_share: number | null; company_share: number | null }): number | null {
  if (enrollment.employee_share === null && enrollment.company_share === null) return null
  return (enrollment.employee_share ?? 0) + (enrollment.company_share ?? 0)
}
