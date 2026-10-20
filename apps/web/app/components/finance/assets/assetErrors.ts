/** API error codes the asset pages explain in the user's language; any other code shows the server's own message. */
const CODE_KEYS = {
  not_draft: 'notDraft',
  period_locked: 'periodLocked',
} as const

export function assetErrorKey(code: string): string | null {
  const key = (CODE_KEYS as Record<string, string>)[code]
  return key ? `financeAssets.errors.${key}` : null
}
