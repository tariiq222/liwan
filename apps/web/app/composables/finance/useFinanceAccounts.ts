import type { MaybeRefOrGetter } from 'vue'
import { computed, toValue } from 'vue'
import { keepPreviousData, useQuery } from '@tanstack/vue-query'
import { FinanceAccountListSchema, type FinanceAccount } from '@liwan/contracts'
import type { AccountListParams } from '@/components/finance/accounting/accountListParams'

type AccountType = FinanceAccount['account_type']

/** What a picker narrows its search to on the server: one account type, and only reconcilable accounts. */
export interface AccountPickerFilter { accountType?: AccountType; reconcile?: boolean }

export const financeAccountKeys = {
  list: (params: AccountListParams) => ['finance', 'accounts', 'list', params] as const,
  picker: (q: string, filter: AccountPickerFilter) => ['finance', 'accounts', 'picker', q, filter.accountType ?? null, filter.reconcile ?? null] as const,
}

/** One page of the chart of accounts. */
export function useFinanceAccountList(params: MaybeRefOrGetter<AccountListParams>, enabled: MaybeRefOrGetter<boolean> = true) {
  const { $api } = useApi()
  return useQuery({
    queryKey: computed(() => financeAccountKeys.list(toValue(params))),
    enabled: computed(() => toValue(enabled)),
    placeholderData: keepPreviousData,
    queryFn: () => $api('/api/v1/finance/accounts', { query: { ...toValue(params) }, schema: FinanceAccountListSchema }),
  })
}

/** Accounts for a picker, matched by the typed code or name and narrowed by `filter` on the server. */
export function useFinanceAccountOptions(q: MaybeRefOrGetter<string>, filter: MaybeRefOrGetter<AccountPickerFilter> = {}) {
  const { $api } = useApi()
  return useQuery({
    queryKey: computed(() => financeAccountKeys.picker(toValue(q).trim(), toValue(filter))),
    placeholderData: keepPreviousData,
    queryFn: () => $api('/api/v1/finance/accounts', { query: { q: toValue(q).trim() || undefined, account_type: toValue(filter).accountType, reconcile: toValue(filter).reconcile ? 'true' : undefined, limit: 50 }, schema: FinanceAccountListSchema }),
  })
}
