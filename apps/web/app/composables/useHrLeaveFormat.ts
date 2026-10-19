import type { HrLeave } from '@webvue/contracts'

/** How a leave request reads in the list and on its record: a period (one date or a range) and a day count. */
export function useHrLeaveFormat() {
  const { t, n } = useI18n()
  function period(leave: Pick<HrLeave, 'date_from' | 'date_to'>) {
    return leave.date_from === leave.date_to ? leave.date_from : t('hr.leave.range', { from: leave.date_from, to: leave.date_to })
  }
  function days(value: number) {
    return t('hr.leave.days', { count: n(value) }, value)
  }
  return { period, days }
}
