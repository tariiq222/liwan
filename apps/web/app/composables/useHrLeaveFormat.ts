import type { HrLeave, HrLeaveAllocation } from '@liwan/contracts'

/** How leave reads in the lists and on the records: a request's period (one date or a range),
 *  a grant's validity (open when it never expires) and a day count. */
export function useHrLeaveFormat() {
  const { t, n } = useI18n()
  function period(leave: Pick<HrLeave, 'date_from' | 'date_to'>) {
    return leave.date_from === leave.date_to ? leave.date_from : t('hr.leave.range', { from: leave.date_from, to: leave.date_to })
  }
  function validity(allocation: Pick<HrLeaveAllocation, 'date_from' | 'date_to'>) {
    return allocation.date_to
      ? t('hr.leave.range', { from: allocation.date_from, to: allocation.date_to })
      : t('hr.leave.allocation.openValidity', { from: allocation.date_from })
  }
  function days(value: number) {
    return t('hr.leave.days', { count: n(value) }, value)
  }
  return { period, validity, days }
}
