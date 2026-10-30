import type { MaybeRefOrGetter } from 'vue'
import { computed, nextTick, toValue } from 'vue'
import { useMutation, useQuery, useQueryClient } from '@tanstack/vue-query'
import {
  AdminUserDetailSchema,
  AdminUserListSchema,
  ChangeUserStateInputSchema,
  GrantAccountInputSchema,
  ResetPasswordInputSchema,
  UpdateUserAccessInputSchema,
  type AdminUserDetail,
  type AdminUserList,
  type ChangeUserStateInput,
  type GrantAccountInput,
  type ResetPasswordInput,
  type UpdateUserAccessInput,
} from '@liwan/contracts'

export type AdminUserListParams = {
  q?: string
  role_id?: number
  status?: 'active' | 'stopped'
  /** Only with the employee-account bridge (`useEmployeeAccountBridge().departmentFilter`); core answers 400 `unsupported_filter`. */
  department_id?: number
  limit?: number
  offset?: number
}

export const ACCESS_MUTATION_GC_TIME = 0
export const adminUserMutationKey = ['access', 'users', 'write'] as const
export const adminUserKeys = {
  all: ['access', 'users'] as const,
  list: (params: AdminUserListParams) => ['access', 'users', 'list', params] as const,
  detail: (id: number) => ['access', 'user', id] as const,
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

// Mirrors NuxtApp.runWithContext without widening through `any`:
// <T extends () => any>(fn: T) => ReturnType<T> | Promise<Awaited<ReturnType<T>>>
export type NuxtContextRunner = {
  runWithContext: <R>(fn: () => R) => R | Promise<Awaited<R>>
  $waitForAccessRefresh?: () => Promise<void>
}

export type AccessRefreshInFlightState = {
  inFlight: Promise<void> | null
}

// Register the current reset promise synchronously before any await. Only the
// latest promise may clear `inFlight` — a finally that always nulls it races
// a second refresh that started while the first was pending.
export function beginAccessRefreshInFlight(
  state: AccessRefreshInFlightState,
  work: () => Promise<void>,
): Promise<void> {
  const current = work()
  state.inFlight = current
  const settle = () => {
    if (state.inFlight === current) state.inFlight = null
  }
  void current.then(settle, settle)
  return current
}

export async function drainAccessRefreshInFlight(
  getInFlight: () => Promise<void> | null | undefined,
): Promise<void> {
  await nextTick()
  for (;;) {
    const current = getInFlight()
    if (!current) return
    await current
    await nextTick()
  }
}

// `me` lives in Nuxt's async-data cache (`useFetch` key `'me'`), not vue-query.
// Mutation callbacks run outside setup, so refresh through the composable's
// captured Nuxt app rather than a fictitious `['me']` query key.
export function refreshMeInNuxtContext<R>(
  nuxt: NuxtContextRunner | null | undefined,
  refreshMe: () => R,
): R | Promise<Awaited<R>> | undefined {
  if (!nuxt) return
  return nuxt.runWithContext(refreshMe)
}

export function accessRefreshWait(
  nuxt?: NuxtContextRunner | null,
  wait?: () => unknown,
): (() => unknown) | undefined {
  return wait ?? nuxt?.$waitForAccessRefresh
}

// Page-owned security success: ignore late callbacks from a previous user or
// after the current page is forbidden/errored. `undefined` means "do not change".
export function nextAdminUserSecuritySuccess(
  currentUserId: number,
  reportedUserId: number,
  key: string,
  blocked = false,
): string | undefined {
  if (blocked || reportedUserId !== currentUserId) return undefined
  return key
}

export async function invalidateAdminUserCaches(
  queryClient: ReturnType<typeof useQueryClient>,
  user: AdminUserDetail,
  options?: {
    nuxt?: NuxtContextRunner | null
    refreshMe?: () => unknown
    waitForAccessRefresh?: () => unknown
  },
) {
  queryClient.setQueryData(adminUserKeys.detail(user.id), user)
  await refreshMeInNuxtContext(
    options?.nuxt,
    options?.refreshMe ?? (() => refreshNuxtData('me')),
  )
  const wait = accessRefreshWait(options?.nuxt, options?.waitForAccessRefresh)
  if (wait) await wait()
  await queryClient.invalidateQueries({ queryKey: adminUserKeys.all })
  await queryClient.invalidateQueries({ queryKey: ['people'] })
  await queryClient.invalidateQueries({ queryKey: ['hr', 'employees'] })
  await queryClient.invalidateQueries({ queryKey: ['access', 'audit'] })
}

export function useSecureAdminUserMutation<TBody>(mutationFn: (body: TBody) => Promise<AdminUserDetail>) {
  const queryClient = useQueryClient()
  const nuxt = tryUseNuxtApp()
  const resetRef: { value: () => void } = { value: () => {} }
  const mutation = useMutation({
    mutationKey: adminUserMutationKey,
    gcTime: ACCESS_MUTATION_GC_TIME,
    mutationFn,
    onSuccess: (user) => invalidateAdminUserCaches(queryClient, user, {
      nuxt,
      refreshMe: () => refreshNuxtData('me'),
    }),
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

export type { AdminUserDetail, AdminUserList }
