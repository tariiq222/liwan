import type { MaybeRefOrGetter } from 'vue'
import { computed, toValue } from 'vue'
import { keepPreviousData, useQuery } from '@tanstack/vue-query'
import { HrPayrollAuditEventListSchema } from '@liwan/contracts'
import type { PayrollAuditParams } from '@/components/hr/payroll/payrollAuditParams'

export const hrPayrollAuditKeys = {
  list: (params: PayrollAuditParams) => ['hr', 'payroll', 'audit', 'list', params] as const,
}

/** One page of the payroll audit trail, newest first as the server orders it. */
export function useHrPayrollAuditEvents(params: MaybeRefOrGetter<PayrollAuditParams>, enabled: MaybeRefOrGetter<boolean> = true) {
  const { $api } = useApi()
  return useQuery({
    queryKey: computed(() => hrPayrollAuditKeys.list(toValue(params))),
    enabled: computed(() => toValue(enabled)),
    placeholderData: keepPreviousData,
    queryFn: () => $api('/api/v1/hr/payroll/audit-events', { query: { ...toValue(params) }, schema: HrPayrollAuditEventListSchema }),
  })
}
