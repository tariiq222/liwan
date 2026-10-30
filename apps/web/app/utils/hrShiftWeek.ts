import type { HrShiftAttendance } from '@liwan/contracts'

type ShiftDay = HrShiftAttendance['dayofweek']

/** Odoo numbers the week from Monday ('0') to Sunday ('6'); the Saudi week is shown starting on Sunday. Display order only. */
export const SHIFT_WEEK_START: ShiftDay = '6'
export const SHIFT_WEEK_ORDER: readonly ShiftDay[] = [SHIFT_WEEK_START, '0', '1', '2', '3', '4', '5']

/** The lines of a schedule in display order: week day first, then the order they were given. */
export function sortShiftLines<T extends Pick<HrShiftAttendance, 'dayofweek'>>(lines: readonly T[]): T[] {
  return [...lines].sort((a, b) => SHIFT_WEEK_ORDER.indexOf(a.dayofweek) - SHIFT_WEEK_ORDER.indexOf(b.dayofweek))
}
