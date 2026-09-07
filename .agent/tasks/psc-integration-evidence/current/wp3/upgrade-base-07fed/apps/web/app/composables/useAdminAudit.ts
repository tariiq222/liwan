import type { MaybeRefOrGetter } from 'vue'
import { computed, toValue } from 'vue'
import { useQuery } from '@tanstack/vue-query'
import {
  AccessAuditDetailSchema,
  AccessAuditListSchema,
  type AccessAuditDetail,
  type AccessAuditList,
} from '@nasq/contracts'

export type AdminAuditListParams = {
  from?: string
  to?: string
  actor_id?: number
  target_type?: 'user' | 'role'
  target_id?: number
  action?: string
  limit?: number
  offset?: number
}

export const adminAuditKeys = {
  all: ['access', 'audit'] as const,
  list: (params: AdminAuditListParams) => ['access', 'audit', 'list', params] as const,
  detail: (id: number) => ['access', 'audit', id] as const,
}

export function adminAuditListQuery(params: AdminAuditListParams = {}) {
  return {
    from: params.from,
    to: params.to,
    actor_id: params.actor_id,
    target_type: params.target_type,
    target_id: params.target_id,
    action: params.action,
    limit: Math.min(Math.max(params.limit ?? 200, 0), 200),
    offset: Math.max(params.offset ?? 0, 0),
  }
}

export function useAdminAuditLog(params: MaybeRefOrGetter<AdminAuditListParams> = {}, enabled: MaybeRefOrGetter<boolean> = true) {
  const { $api } = useApi()
  return useQuery({
    queryKey: computed(() => adminAuditKeys.list(toValue(params))),
    enabled: computed(() => toValue(enabled)),
    queryFn: () => $api('/api/v1/admin/access-log', {
      query: adminAuditListQuery(toValue(params)),
      schema: AccessAuditListSchema,
    }),
  })
}

export function useAdminAuditEvent(id: MaybeRefOrGetter<number | null>, enabled: MaybeRefOrGetter<boolean> = true) {
  const { $api } = useApi()
  return useQuery({
    queryKey: computed(() => adminAuditKeys.detail(toValue(id) ?? 0)),
    enabled: computed(() => !!toValue(id) && toValue(enabled)),
    queryFn: () => $api(`/api/v1/admin/access-log/${toValue(id)}`, { schema: AccessAuditDetailSchema }),
  })
}

export type { AccessAuditDetail, AccessAuditList }
