/** API error codes the budget pages explain in the user's language; any other code shows the server's own message. */
const CODE_KEYS = {
  not_draft: 'notDraft',
  invalid_state: 'invalidState',
  invalid_period: 'invalidPeriod',
  line_outside_budget: 'lineOutsideBudget',
  budget_line_overlap: 'lineOverlap',
  cost_center_overlap: 'costCenterOverlap',
} as const

export function budgetErrorKey(code: string): string | null {
  const key = (CODE_KEYS as Record<string, string>)[code]
  return key ? `financeBudgets.errors.${key}` : null
}
