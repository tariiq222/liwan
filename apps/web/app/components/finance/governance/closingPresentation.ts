import { FinanceClosingBlockerCodeSchema, type FinanceClosingBlocker, type FinanceFiscalYear } from '@webvue/contracts'
import type { StatusTone } from '@webvue/ui/app/utils/statusTone'
import { financeErrorMessage } from '../financeErrors'
import { queryPositiveInt } from '../../../utils/routeQuery'

export const CLOSING_PATH = '/settings/apps/finance'
export const CLOSING_HASH = '#closing'

export const FISCAL_YEAR_STATE_TONE: Record<FinanceFiscalYear['state'], StatusTone> = {
  open: 'warning',
  locked: 'info',
  closed: 'success',
}

const BLOCKER_CODES: readonly string[] = FinanceClosingBlockerCodeSchema.options
const ERROR_CODES = ['already_closed', 'period_locked'] as const

/** The year named by `?year=` when it is one of the open years; only an open year has a closing preview. */
export function selectedOpenYear(query: unknown, years: readonly FinanceFiscalYear[]): number | null {
  const year = queryPositiveInt(query)
  return year !== null && years.some(item => item.year === year && item.state === 'open') ? year : null
}

export function blockerKey(code: string): string {
  return `financeGovernance.closing.blockers.${code}`
}

/** The Arabic sentence of a blocker; the draft count the server reports in `details` fills the drafts sentence. */
export function blockerText(blocker: FinanceClosingBlocker, t: (key: string, params?: Record<string, unknown>) => string): string {
  const drafts = typeof blocker.details.drafts === 'number' ? blocker.details.drafts : 0
  return t(blockerKey(blocker.code), { drafts })
}

/** The message to show for a failed close: the user's language for a known code, else the server's own text. */
export function closingErrorMessage(cause: unknown, t: (key: string, params?: Record<string, unknown>) => string): string {
  return financeErrorMessage(cause, closingErrorKey, t, error => BLOCKER_CODES.includes(error.code)
    ? { drafts: typeof error.details?.drafts === 'number' ? error.details.drafts : 0 }
    : undefined)
}

function closingErrorKey(code: string): string | null {
  if (BLOCKER_CODES.includes(code)) return blockerKey(code)
  return (ERROR_CODES as readonly string[]).includes(code) ? `financeGovernance.closing.errors.${code}` : null
}
