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
