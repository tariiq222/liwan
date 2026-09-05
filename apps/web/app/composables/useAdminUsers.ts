import type { MaybeRefOrGetter } from 'vue'
import { computed, toValue } from 'vue'
import { useMutation, useQuery, useQueryClient } from '@tanstack/vue-query'
import {
  AdminUserDetailSchema,
  AdminUserCandidateListSchema,
  AdminUserListSchema,
  ChangeUserStateInputSchema,
  GrantAccountInputSchema,
  ResetPasswordInputSchema,
  UpdateUserAccessInputSchema,
  type AdminUserDetail,
  type AdminUserCandidateList,
  type AdminUserList,
  type ChangeUserStateInput,
  type GrantAccountInput,
  type ResetPasswordInput,
  type UpdateUserAccessInput,
} from '@nasq/contracts'

export type AdminUserListParams = {
  q?: string
  role_id?: number
  status?: 'active' | 'stopped'
  department_id?: number
  limit?: number
  offset?: number
}

export const ACCESS_MUTATION_GC_TIME = 0
export const adminUserKeys = {
  all: ['access', 'users'] as const,
  list: (params: AdminUserListParams) => ['access', 'users', 'list', params] as const,
  detail: (id: number) => ['access', 'user', id] as const,
  candidates: (params: { q?: string; employee_id?: number; limit?: number; offset?: number }) => ['access', 'users', 'candidates', params] as const,
}

export function adminUserCandidateQuery(params: { q?: string; employee_id?: number; limit?: number; offset?: number } = {}) {
  return { q: params.q?.trim() || undefined, ...(params.employee_id !== undefined ? { employee_id: params.employee_id } : {}), limit: Math.min(Math.max(params.limit ?? 200, 0), 200), offset: Math.max(params.offset ?? 0, 0) }
}

export function useAdminUserCandidates(params: MaybeRefOrGetter<{ q?: string; employee_id?: number; limit?: number; offset?: number }> = {}, enabled: MaybeRefOrGetter<boolean> = true) {
  const { $api } = useApi()
  return useQuery({
    queryKey: computed(() => adminUserKeys.candidates(toValue(params))),
    enabled: computed(() => toValue(enabled)),
    queryFn: () => $api('/api/v1/admin/users/candidates', { query: adminUserCandidateQuery(toValue(params)), schema: AdminUserCandidateListSchema }),
  })
}

export function adminUserListQuery(params: AdminUserListParams = {}) {
  return {
    q: params.q?.trim() || undefined,
    role_id: params.role_id,
    status: params.status,
    department_id: params.department_id,
    limit: Math.min(Math.max(params.limit ?? 200, 0), 200),
    offset: Math.max(params.offset ?? 0, 0),
  }
}

export function useAdminUsers(params: MaybeRefOrGetter<AdminUserListParams> = {}, enabled: MaybeRefOrGetter<boolean> = true) {
  const { $api } = useApi()
  return useQuery({
    queryKey: computed(() => adminUserKeys.list(toValue(params))),
    enabled: computed(() => toValue(enabled)),
    queryFn: () => $api('/api/v1/admin/users', {
      query: adminUserListQuery(toValue(params)),
      schema: AdminUserListSchema,
    }),
  })
}

export function useAdminUser(id: MaybeRefOrGetter<number | null>, enabled: MaybeRefOrGetter<boolean> = true) {
  const { $api } = useApi()
  return useQuery({
    queryKey: computed(() => adminUserKeys.detail(toValue(id) ?? 0)),
    enabled: computed(() => !!toValue(id) && toValue(enabled)),
    queryFn: () => $api(`/api/v1/admin/users/${toValue(id)}`, { schema: AdminUserDetailSchema }),
  })
}

function invalidateAdminUserCaches(queryClient: ReturnType<typeof useQueryClient>, user: AdminUserDetail) {
  queryClient.setQueryData(adminUserKeys.detail(user.id), user)
  void queryClient.invalidateQueries({ queryKey: adminUserKeys.all })
  void queryClient.invalidateQueries({ queryKey: ['me'] })
  void queryClient.invalidateQueries({ queryKey: ['people'] })
  void queryClient.invalidateQueries({ queryKey: ['hr', 'employees'] })
  void queryClient.invalidateQueries({ queryKey: ['access', 'audit'] })
}

function useSecureAdminUserMutation<TBody>(mutationFn: (body: TBody) => Promise<AdminUserDetail>) {
  const queryClient = useQueryClient()
  const resetRef: { value: () => void } = { value: () => {} }
  const mutation = useMutation({
    gcTime: ACCESS_MUTATION_GC_TIME,
    mutationFn,
    onSuccess: (user) => invalidateAdminUserCaches(queryClient, user),
    onSettled: () => resetRef.value(),
  })
  resetRef.value = mutation.reset
  return mutation
}

export function useGrantAdminAccount() {
  const { $api } = useApi()
  return useSecureAdminUserMutation<GrantAccountInput>((body) => {
    const input = GrantAccountInputSchema.parse(body)
    return $api('/api/v1/admin/users', { method: 'POST', body: input, schema: AdminUserDetailSchema })
  })
}

export function useUpdateAdminUserAccess() {
  const { $api } = useApi()
  return useSecureAdminUserMutation<{ id: number; body: UpdateUserAccessInput }>(({ id, body }) => {
    const input = UpdateUserAccessInputSchema.parse(body)
    return $api(`/api/v1/admin/users/${id}/access`, { method: 'PATCH', body: input, schema: AdminUserDetailSchema })
  })
}

export function useResetAdminUserPassword() {
  const { $api } = useApi()
  return useSecureAdminUserMutation<{ id: number; body: ResetPasswordInput }>(({ id, body }) => {
    const input = ResetPasswordInputSchema.parse(body)
    return $api(`/api/v1/admin/users/${id}/password`, { method: 'POST', body: input, schema: AdminUserDetailSchema })
  })
}

function useChangeAdminUserState(action: 'disable' | 'reactivate') {
  const { $api } = useApi()
  return useSecureAdminUserMutation<{ id: number; body: ChangeUserStateInput }>(({ id, body }) => {
    const input = ChangeUserStateInputSchema.parse(body)
    if (action === 'disable' && input.password !== undefined) throw new Error('disable_password_forbidden')
    if (action === 'reactivate' && input.password === undefined) throw new Error('reactivate_password_required')
    return $api(`/api/v1/admin/users/${id}/${action}`, { method: 'POST', body: input, schema: AdminUserDetailSchema })
  })
}

export function useDisableAdminUser() { return useChangeAdminUserState('disable') }
export function useReactivateAdminUser() { return useChangeAdminUserState('reactivate') }

// Short aliases keep call sites readable while retaining the explicit admin names.
export const useGrantAccount = useGrantAdminAccount
export const useUpdateUserAccess = useUpdateAdminUserAccess
export const useResetUserPassword = useResetAdminUserPassword
export const useDisableUser = useDisableAdminUser
export const useReactivateUser = useReactivateAdminUser

export type { AdminUserCandidateList, AdminUserDetail, AdminUserList }
