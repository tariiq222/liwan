import type { MaybeRefOrGetter } from 'vue'
import { computed, toValue } from 'vue'
import { useQuery } from '@tanstack/vue-query'
import {
  AdminUserDetailSchema,
  EmployeeAccountCandidateListSchema,
  EmployeeAccountInputSchema,
  type EmployeeAccountCandidateList,
  type EmployeeAccountInput,
} from '@webvue/contracts'
import { useSecureAdminUserMutation } from './useAdminUsers'

export type EmployeeAccountCandidateParams = { q?: string; employee_id?: number; status?: 'active' | 'archived'; limit?: number; offset?: number }

export const employeeAccountKeys = {
  candidates: (params: EmployeeAccountCandidateParams) => ['access', 'employee-accounts', 'candidates', params] as const,
}

/**
 * The employee-account bridge is optional: its routes and the department filter exist only when a feature
 * exposes them. The gate is the readable `hr.enabled` feature plus the capability, never an application name.
 */
export function useEmployeeAccountBridge() {
  const { me } = useMe()
  const { can } = useAccess()
  const hrReadable = computed(() => me.value?.platform?.readable_features.includes('hr.enabled') ?? false)
  const hrWritable = computed(() => me.value?.platform?.writable_features.includes('hr.enabled') ?? false)
  return {
    /** «من موظف» in the account form (the grant route writes, so the feature must be writable). */
    available: computed(() => hrWritable.value && can('access.users.grant')),
    /** The department filter and the employee column of the users list. */
    departmentFilter: computed(() => hrReadable.value && can('hr.departments.read')),
  }
}

export function employeeAccountCandidateQuery(params: EmployeeAccountCandidateParams = {}) {
  return { q: params.q?.trim() || undefined, ...(params.employee_id !== undefined ? { employee_id: params.employee_id } : {}), ...(params.status ? { status: params.status } : {}), limit: Math.min(Math.max(params.limit ?? 200, 0), 200), offset: Math.max(params.offset ?? 0, 0) }
}

export function useEmployeeAccountCandidates(params: MaybeRefOrGetter<EmployeeAccountCandidateParams> = {}, enabled: MaybeRefOrGetter<boolean> = true) {
  const { $api } = useApi()
  return useQuery({
    queryKey: computed(() => employeeAccountKeys.candidates(toValue(params))),
    enabled: computed(() => toValue(enabled)),
    queryFn: () => $api('/api/v1/admin/employee-accounts/candidates', { query: employeeAccountCandidateQuery(toValue(params)), schema: EmployeeAccountCandidateListSchema }),
  })
}

export function useGrantEmployeeAccount() {
  const { $api } = useApi()
  return useSecureAdminUserMutation<EmployeeAccountInput>((body) => {
    const input = EmployeeAccountInputSchema.parse(body)
    return $api('/api/v1/admin/employee-accounts', { method: 'POST', body: input, schema: AdminUserDetailSchema })
  })
}

export type { EmployeeAccountCandidateList }
