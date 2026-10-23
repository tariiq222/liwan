import { useHrOwnIdentity } from './useHrOwnIdentity'
import type { MaybeRefOrGetter } from 'vue'
import { computed, toValue } from 'vue'
import { useQuery } from '@tanstack/vue-query'
import { HrEmployeeSchema } from '@webvue/contracts'

export const hrOwnProfileKey = ['hr', 'me'] as const

/** The server resolves employee and company from the current session, never a route selector. */
export function useMyHrProfile(enabled: MaybeRefOrGetter<boolean> = true) {
  const { $api } = useApi()
  const { can } = useAccess()
  const identity = useHrOwnIdentity()
  return useQuery({
    queryKey: computed(() => [...hrOwnProfileKey, identity.scope.value]),
    enabled: computed(() => identity.ready.value && toValue(enabled) && can('hr.employees.read')),
    queryFn: () => $api('/api/v1/hr/me', { schema: HrEmployeeSchema.nullable() }),
  })
}
