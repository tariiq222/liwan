import type { MaybeRefOrGetter } from 'vue'
import { computed, toValue } from 'vue'
import { useQuery } from '@tanstack/vue-query'
import { HelpdeskReportSchema } from '@liwan/contracts'

// The numbers of the desk for one period; the period lives in the URL so a link shows the same report.
export function useHelpdeskReport(period: MaybeRefOrGetter<string>) {
  const { $api } = useApi()
  return useQuery({
    queryKey: computed(() => ['helpdesk', 'report', toValue(period)] as const),
    queryFn: () => $api('/api/v1/helpdesk/reports', {
      query: { period: toValue(period) }, schema: HelpdeskReportSchema,
    }),
  })
}
