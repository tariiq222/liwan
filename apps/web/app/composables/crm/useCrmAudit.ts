import { computed, toValue, type MaybeRefOrGetter } from 'vue'
import { keepPreviousData, useQuery } from '@tanstack/vue-query'
import { CrmViewLogListSchema } from '@liwan/contracts'
import { hasFeature } from '../../modules/registry'

export const CRM_AUDIT_PATH = '/crm/audit'
export const CRM_AUDIT_PAGE_SIZE = 20

/** Whether the viewer may read the CRM view log: the audit capability on an enabled CRM. The server checks both too. */
export function useCrmAuditAccess() {
  const { can } = useAccess()
  const { me } = useMe()
  return computed(() => can('crm.audit.read') && hasFeature(me.value, 'crm.enabled'))
}

/** The offset of a 1-based page of the view log. */
export function crmAuditOffset(page: number): number {
  return (page - 1) * CRM_AUDIT_PAGE_SIZE
}

/** One page of the CRM view log, newest first as the server orders it; the previous page stays on screen while the next loads. */
export function useCrmViewLogs(page: MaybeRefOrGetter<number>, enabled: MaybeRefOrGetter<boolean>) {
  const { $api } = useApi()
  return useQuery({
    queryKey: computed(() => ['crm', 'audit', 'views', { page: toValue(page) }] as const),
    enabled: computed(() => toValue(enabled)),
    placeholderData: keepPreviousData,
    queryFn: ({ queryKey, signal }) => $api('/api/v1/crm/audit/views', {
      query: { limit: CRM_AUDIT_PAGE_SIZE, offset: crmAuditOffset(queryKey[3].page) },
      signal,
      schema: CrmViewLogListSchema,
    }),
  })
}
