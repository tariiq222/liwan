import type { MaybeRefOrGetter } from 'vue'
import { computed, toValue } from 'vue'
import { keepPreviousData, useQuery } from '@tanstack/vue-query'
import { FinanceAuditEventListSchema } from '@webvue/contracts'
import type { AuditListParams } from '@/components/finance/governance/auditParams'

export const financeAuditKeys = {
  list: (params: AuditListParams) => ['finance', 'audit', 'list', params] as const,
}

/** One page of the finance audit log, newest first as the server orders it. */
export function useFinanceAuditEvents(params: MaybeRefOrGetter<AuditListParams>, enabled: MaybeRefOrGetter<boolean> = true) {
  const { $api } = useApi()
  return useQuery({
    queryKey: computed(() => financeAuditKeys.list(toValue(params))),
    enabled: computed(() => toValue(enabled)),
    placeholderData: keepPreviousData,
    queryFn: () => $api('/api/v1/finance/audit-events', { query: { ...toValue(params) }, schema: FinanceAuditEventListSchema }),
  })
}
