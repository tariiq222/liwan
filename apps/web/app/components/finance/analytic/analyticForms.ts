import type { FinanceAnalyticAccount, FinanceAnalyticAccountPatch } from '@webvue/contracts'

/** The `name` and `code` that changed on an edited cost center, or null when nothing did (no request is sent then). */
export function accountPatch(account: FinanceAnalyticAccount, name: string, code: string): FinanceAnalyticAccountPatch | null {
  const patch: FinanceAnalyticAccountPatch = {
    ...(name.trim() !== account.name ? { name: name.trim() } : {}),
    ...(code.trim() !== account.code ? { code: code.trim() } : {}),
  }
  return Object.keys(patch).length ? patch : null
}
