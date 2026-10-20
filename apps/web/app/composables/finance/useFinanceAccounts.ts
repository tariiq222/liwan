import type { MaybeRefOrGetter } from 'vue'
import { computed, toValue } from 'vue'
import { keepPreviousData, useQuery } from '@tanstack/vue-query'
import { FinanceAccountListSchema } from '@webvue/contracts'
import type { AccountListParams } from '@/components/finance/accounting/accountListParams'

export const financeAccountKeys = {
  list: (params: AccountListParams) => ['finance', 'accounts', 'list', params] as const,
  picker: (q: string) => ['finance', 'accounts', 'picker', q] as const,
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

/** Accounts for a picker, matched by the typed code or name. */
export function useFinanceAccountOptions(q: MaybeRefOrGetter<string>) {
  const { $api } = useApi()
  return useQuery({
    queryKey: computed(() => financeAccountKeys.picker(toValue(q).trim())),
    placeholderData: keepPreviousData,
    queryFn: () => $api('/api/v1/finance/accounts', { query: { q: toValue(q).trim() || undefined, limit: 50 }, schema: FinanceAccountListSchema }),
  })
}
