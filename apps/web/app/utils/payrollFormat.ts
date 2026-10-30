import type { HrPayrollRunState } from '@liwan/contracts'
import type { StatusTone } from '@liwan/ui/app/utils/statusTone'
import { isolateLtr } from '@liwan/ui/app/utils/formatDate'

// Payroll figures and months as the payroll pages print them: Latin digits in every locale (like the app's dates),
// two decimals for amounts, a left-to-right isolate so the numbers keep their order inside right-to-left text.
const MONTH = /^(\d{4})-(0[1-9]|1[0-2])$/

const plainAmount = (value: number, locale: string) =>
  new Intl.NumberFormat(locale, { numberingSystem: 'latn', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value)

export function formatPayrollAmount(value: number, locale: string): string {
  return isolateLtr(plainAmount(value, locale))
}

/** The label of a payroll currency: the Saudi riyal keeps its Arabic symbol, any other code is printed as it is. */
export function payrollCurrencyLabel(code: string, riyalLabel: string): string {
  return code === 'SAR' ? riyalLabel : code
}

/** A contribution rate: the percent sign stays with its number inside right-to-left text. */
export function formatPayrollPercent(value: number, locale: string): string {
  return isolateLtr(`${plainAmount(value, locale)}%`)
}

/** A `YYYY-MM` payroll month as "October 2026" / "أكتوبر 2026"; anything else comes back as given. */
export function formatPayrollMonth(month: string, locale: string): string {
  const match = MONTH.exec(month)
  if (!match) return month
  const first = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, 1))
  return new Intl.DateTimeFormat(locale, { calendar: 'gregory', numberingSystem: 'latn', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(first)
}

/** The current month as `YYYY-MM`, in the browser's own calendar. */
export function currentPayrollMonth(date: Date = new Date()): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
}

const RUN_STATE_TONE: Record<HrPayrollRunState, StatusTone> = {
  draft: 'neutral',
  computed: 'warning',
  approved: 'info',
  posted: 'primary',
  paid: 'success',
}

/** The badge tone of a run state: the run moves draft -> computed -> approved, then posted and paid by the finance bridge. */
export function payrollRunStateTone(state: HrPayrollRunState): StatusTone {
  return RUN_STATE_TONE[state]
}
