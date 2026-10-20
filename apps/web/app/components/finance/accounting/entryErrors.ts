import { ApiError } from '../../../composables/useApi'

/** API error codes the accounting pages explain in the user's language; any other code shows the server's own message. */
const CODE_KEYS = {
  unbalanced: 'unbalanced',
  has_reconciliations: 'hasReconciliations',
  invalid_state: 'invalidState',
  period_locked: 'periodLocked',
} as const

export function entryErrorKey(code: string): string | null {
  const key = (CODE_KEYS as Record<string, string>)[code]
  return key ? `financeAccounting.errors.${key}` : null
}

/** The message to show for a failed call: the caller's language for a known code, else the server's own text. */
export function entryErrorMessage(cause: unknown, t: (key: string) => string): string {
  if (!(cause instanceof ApiError)) return t('errors.generic')
  const key = entryErrorKey(cause.code)
  return key ? t(key) : cause.message
}
