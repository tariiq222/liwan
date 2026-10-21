/** API error codes the bank pages explain in the user's language; any other code shows the server's own message. */
const CODE_KEYS = {
  not_balanced: 'notBalanced',
  invalid_state: 'invalidState',
  period_locked: 'periodLocked',
  invalid_rows: 'invalidRows',
  duplicate_lines: 'duplicateLines',
  balance_mismatch: 'balanceMismatch',
  has_reconciliations: 'hasReconciliations',
} as const

export function bankErrorKey(code: string): string | null {
  const key = (CODE_KEYS as Record<string, string>)[code]
  return key ? `financeBank.errors.${key}` : null
}
