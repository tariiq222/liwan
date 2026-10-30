import type { FinanceSetup, FinanceSetupFiscalInput } from '@liwan/contracts'
import { ApiError } from '../useApi'
import { saveErrorMessage } from '../../utils/formFeedback'

/**
 * The fiscal-year editor of the finance setup card: the draft it holds, the delta it may send and the
 * messages its refusals become. Kept free of Nuxt imports so the rules below are unit tested directly.
 */

export type FinanceFiscalValues = FinanceSetup['fiscal']

/** The locks this editor may tighten. The hard lock is irreversible in stock Odoo and stays read-only. */
export const FINANCE_FISCAL_LOCK_FIELDS = [
  'fiscalyear_lock_date', 'tax_lock_date', 'sale_lock_date', 'purchase_lock_date',
] as const
export type FinanceFiscalLockField = typeof FINANCE_FISCAL_LOCK_FIELDS[number]
export type FinanceFiscalField = 'fiscalyear_last_day' | 'fiscalyear_last_month' | FinanceFiscalLockField

/**
 * The draft holds the year end as the text the user typed, so an empty or half-typed value is visible
 * instead of being silently coerced, and the locks as calendar dates or null when the field was cleared.
 */
export type FinanceFiscalDraft = {
  fiscalyear_last_day: string
  fiscalyear_last_month: string
} & Record<FinanceFiscalLockField, string | null>

export type FinanceFiscalIssueCode =
  | 'invalidDay' | 'invalidMonth' | 'invalidYearEnd' | 'invalidLockDate' | 'lockCannotClear' | 'lockCannotMoveEarlier'
export type FinanceFiscalIssue = { field: FinanceFiscalField; code: FinanceFiscalIssueCode }

/** The identity a setup screen was read for: the signed-in user, their current company and the observed identity generation. */
export type FinanceSetupScope = { userId: number; companyId: number; epoch: number }

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/
const POSITIVE_INTEGER = /^[1-9][0-9]?$/
// A leap year so 29 February is a usable fiscal year end instead of being clamped away.
const REFERENCE_YEAR = 2000

const FISCAL_ERROR_KEYS: Record<string, string> = {
  fiscal_year_has_posted_entries: 'finance.setup.fiscal.errors.fiscal_year_has_posted_entries',
  lock_date_loosening: 'finance.setup.fiscal.errors.lock_date_loosening',
  invalid_request_context: 'finance.setup.fiscal.errors.invalid_request_context',
  request_context_changed: 'finance.setup.fiscal.errors.request_context_changed',
}

type Translate = (key: string, params?: Record<string, unknown>) => string

function daysInMonth(month: number): number {
  return new Date(Date.UTC(REFERENCE_YEAR, month, 0)).getUTCDate()
}

/** A real calendar date in ISO form; `2026-02-31` and `2026-1-1` are not. */
export function isFinanceCalendarDate(value: string): boolean {
  if (!ISO_DATE.test(value)) return false
  const year = Number(value.slice(0, 4))
  const month = Number(value.slice(5, 7))
  const day = Number(value.slice(8, 10))
  if (month < 1 || month > 12 || day < 1) return false
  return day <= new Date(Date.UTC(year, month, 0)).getUTCDate()
}

export function financeFiscalDraftFromValues(values: FinanceFiscalValues): FinanceFiscalDraft {
  const draft = {
    fiscalyear_last_day: String(values.fiscalyear_last_day),
    fiscalyear_last_month: String(values.fiscalyear_last_month),
  } as FinanceFiscalDraft
  for (const field of FINANCE_FISCAL_LOCK_FIELDS) draft[field] = values[field]
  return draft
}

function readNumber(value: string): number | null {
  if (!POSITIVE_INTEGER.test(value)) return null
  return Number(value)
}

/** Every reason the draft cannot be sent: a malformed day or month, an impossible year end, or a lock that
 * was cleared or moved earlier than the saved one. The locks can only be tightened from here. */
export function financeFiscalIssues(draft: FinanceFiscalDraft, baseline: FinanceFiscalDraft): FinanceFiscalIssue[] {
  const issues: FinanceFiscalIssue[] = []
  const day = readNumber(draft.fiscalyear_last_day)
  const month = readNumber(draft.fiscalyear_last_month)
  if (day === null || day > 31) issues.push({ field: 'fiscalyear_last_day', code: 'invalidDay' })
  if (month === null || month > 12) issues.push({ field: 'fiscalyear_last_month', code: 'invalidMonth' })
  if (day !== null && month !== null && day <= 31 && month <= 12 && day > daysInMonth(month)) {
    issues.push({ field: 'fiscalyear_last_day', code: 'invalidYearEnd' })
  }
  for (const field of FINANCE_FISCAL_LOCK_FIELDS) {
    const value = draft[field]
    const current = baseline[field]
    if (value !== null && !isFinanceCalendarDate(value)) { issues.push({ field, code: 'invalidLockDate' }); continue }
    if (current && value === null) { issues.push({ field, code: 'lockCannotClear' }); continue }
    if (current && value !== null && value < current) issues.push({ field, code: 'lockCannotMoveEarlier' })
  }
  return issues
}

/** The changed fields only, or null when there is nothing to send: either no change or a draft the
 * editor refuses. Call `financeFiscalIssues` for the reason to show before calling this. */
export function financeFiscalDelta(draft: FinanceFiscalDraft, baseline: FinanceFiscalDraft): FinanceSetupFiscalInput | null {
  if (financeFiscalIssues(draft, baseline).length) return null
  const delta: FinanceSetupFiscalInput = {}
  // The draft holds these as text, so compare the text the baseline holds too: only a real change is sent.
  if (draft.fiscalyear_last_day !== baseline.fiscalyear_last_day) delta.fiscalyear_last_day = Number(draft.fiscalyear_last_day)
  if (draft.fiscalyear_last_month !== baseline.fiscalyear_last_month) delta.fiscalyear_last_month = Number(draft.fiscalyear_last_month)
  for (const field of FINANCE_FISCAL_LOCK_FIELDS) {
    if (draft[field] !== baseline[field]) delta[field] = draft[field]
  }
  return Object.keys(delta).length ? delta : null
}

export function financeFiscalErrorKey(code: string): string | null {
  return FISCAL_ERROR_KEYS[code] ?? null
}

/** The precondition refused because this screen's identity is no longer the signed-in one. */
export function isFinanceContextChanged(cause: unknown): boolean {
  return cause instanceof ApiError && cause.code === 'request_context_changed'
}

/** The message for a failed save: the user's language for a code we know, otherwise the server's own
 * refusal, and the uncertain-outcome line for a call that never answered. */
export function financeFiscalSaveMessage(cause: unknown, t: Translate): string {
  if (cause instanceof ApiError) {
    const key = financeFiscalErrorKey(cause.code)
    if (key) return t(key)
  }
  return saveErrorMessage(cause, t('errors.generic'), t('errors.saveUncertain'))
}

/** The message under one field for a server refusal that named it. */
export function financeFiscalFieldError(cause: unknown, field: FinanceFiscalField, t: Translate): string | undefined {
  if (!(cause instanceof ApiError) || cause.field !== field) return undefined
  const key = financeFiscalErrorKey(cause.code)
  return key ? t(key) : cause.message
}

export function financeSetupScopeToken(scope: FinanceSetupScope): string {
  return `${scope.userId}:${scope.companyId}:${scope.epoch}`
}

/** The same user, on the same company, at the same observed generation. Anything else is another screen's state. */
export function sameFinanceSetupScope(left: FinanceSetupScope | null, right: FinanceSetupScope | null): boolean {
  if (!left || !right) return false
  return financeSetupScopeToken(left) === financeSetupScopeToken(right)
}

/** The precondition a fiscal write states: the identity its screen was read for, never a target selector. */
export function financeExpectedContextHeaders(scope: FinanceSetupScope): Record<string, string> {
  return {
    'X-Liwan-Expected-User-Id': String(scope.userId),
    'X-Liwan-Expected-Company-Id': String(scope.companyId),
  }
}
