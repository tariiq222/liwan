import type { MaybeRefOrGetter } from 'vue'
import { computed, toValue } from 'vue'
import { useMutation, useQuery, useQueryClient } from '@tanstack/vue-query'
import {
  PermissionCatalogSchema,
  RoleCloneInputSchema,
  RoleCreateInputSchema,
  RoleDetailSchema,
  RoleListSchema,
  RolePatchInputSchema,
  RoleStateInputSchema,
  type PermissionCatalog,
  type RoleCloneInput,
  type RoleCreateInput,
  type RoleDetail,
  type RoleList,
  type RolePatchInput,
  type RoleStateInput,
} from '@nasq/contracts'
import { accessRefreshWait, refreshMeInNuxtContext, type NuxtContextRunner } from './useAdminUsers'

export type AdminRoleListParams = {
  q?: string
  type?: 'built_in' | 'custom'
  status?: 'active' | 'disabled'
  limit?: number
  offset?: number
}

export const adminRoleKeys = {
  all: ['access', 'roles'] as const,
  list: (params: AdminRoleListParams) => ['access', 'roles', 'list', params] as const,
  detail: (id: number) => ['access', 'role', id] as const,
  details: (ids: number[]) => ['access', 'roles', 'details', ids] as const,
  permissions: ['access', 'permissions'] as const,
}

export function adminRoleListQuery(params: AdminRoleListParams = {}) {
  return {
    q: params.q?.trim() || undefined,
    type: params.type,
    status: params.status,
    limit: Math.min(Math.max(params.limit ?? 200, 0), 200),
    offset: Math.max(params.offset ?? 0, 0),
  }
}

export function useAdminRoles(params: MaybeRefOrGetter<AdminRoleListParams> = {}, enabled: MaybeRefOrGetter<boolean> = true) {
  const { $api } = useApi()
  return useQuery({
    queryKey: computed(() => adminRoleKeys.list(toValue(params))),
    enabled: computed(() => toValue(enabled)),
    queryFn: () => $api('/api/v1/admin/roles', {
      query: adminRoleListQuery(toValue(params)),
      schema: RoleListSchema,
    }),
  })
}

export function useAdminRole(id: MaybeRefOrGetter<number | null>, enabled: MaybeRefOrGetter<boolean> = true) {
  const { $api } = useApi()
  return useQuery({
    queryKey: computed(() => adminRoleKeys.detail(toValue(id) ?? 0)),
    enabled: computed(() => !!toValue(id) && toValue(enabled)),
    queryFn: () => $api(`/api/v1/admin/roles/${toValue(id)}`, { schema: RoleDetailSchema }),
  })
}

/** Load only the role definitions needed to preview a user assignment change. */
export function useAdminRoleDetails(ids: MaybeRefOrGetter<number[]>, enabled: MaybeRefOrGetter<boolean> = true) {
  const { $api } = useApi()
  return useQuery({
    queryKey: computed(() => adminRoleKeys.details(toValue(ids))),
    enabled: computed(() => toValue(enabled) && toValue(ids).length > 0),
    queryFn: async () => Promise.all([...new Set(toValue(ids))].map((id) => $api(`/api/v1/admin/roles/${id}`, { schema: RoleDetailSchema }))),
  })
}

export function useAdminPermissionCatalog(enabled: MaybeRefOrGetter<boolean> = true) {
  const { $api } = useApi()
  return useQuery({
    queryKey: adminRoleKeys.permissions,
    enabled: computed(() => toValue(enabled)),
    queryFn: () => $api('/api/v1/admin/permissions', { schema: PermissionCatalogSchema }),
    staleTime: 5 * 60 * 1000,
  })
}

export async function invalidateAdminRoleCaches(
  queryClient: ReturnType<typeof useQueryClient>,
  role: RoleDetail,
  options?: {
    nuxt?: NuxtContextRunner | null
    refreshMe?: () => unknown
    waitForAccessRefresh?: () => unknown
  },
) {
  queryClient.setQueryData(adminRoleKeys.detail(role.id), role)
  // `me` lives in Nuxt's async-data cache, not vue-query. Mutation callbacks
  // run outside setup, so refresh through the composable's captured Nuxt app.
  await refreshMeInNuxtContext(
    options?.nuxt,
    options?.refreshMe ?? (() => refreshNuxtData('me')),
  )
  const wait = accessRefreshWait(options?.nuxt, options?.waitForAccessRefresh)
  if (wait) await wait()
  await queryClient.invalidateQueries({ queryKey: adminRoleKeys.all })
  await queryClient.invalidateQueries({ queryKey: ['access', 'users'] })
  await queryClient.invalidateQueries({ queryKey: ['access', 'audit'] })
}

function useAdminRoleSuccessInvalidation() {
  const queryClient = useQueryClient()
  const nuxt = tryUseNuxtApp()
  return (role: RoleDetail) => invalidateAdminRoleCaches(queryClient, role, {
    nuxt,
    refreshMe: () => refreshNuxtData('me'),
  })
}

export function useCreateAdminRole() {
  const { $api } = useApi()
  const invalidate = useAdminRoleSuccessInvalidation()
  return useMutation({
    mutationFn: (body: RoleCreateInput) => $api('/api/v1/admin/roles', {
      method: 'POST',
      body: RoleCreateInputSchema.parse(body),
      schema: RoleDetailSchema,
    }),
    onSuccess: invalidate,
  })
}

export function useUpdateAdminRole() {
  const { $api } = useApi()
  const invalidate = useAdminRoleSuccessInvalidation()
  return useMutation({
    mutationFn: ({ id, patch }: { id: number; patch: RolePatchInput }) => $api(`/api/v1/admin/roles/${id}`, {
      method: 'PATCH',
      body: RolePatchInputSchema.parse(patch),
      schema: RoleDetailSchema,
    }),
    onSuccess: invalidate,
  })
}

export function useCloneAdminRole() {
  const { $api } = useApi()
  const invalidate = useAdminRoleSuccessInvalidation()
  return useMutation({
    mutationFn: ({ id, body }: { id: number; body: RoleCloneInput }) => $api(`/api/v1/admin/roles/${id}/clone`, {
      method: 'POST',
      body: RoleCloneInputSchema.parse(body),
      schema: RoleDetailSchema,
    }),
    onSuccess: invalidate,
  })
}

function useAdminRoleStateMutation(action: 'disable' | 'enable') {
  const { $api } = useApi()
  const invalidate = useAdminRoleSuccessInvalidation()
  return useMutation({
    mutationFn: ({ id, body }: { id: number; body: RoleStateInput }) => $api(`/api/v1/admin/roles/${id}/${action}`, {
      method: 'POST',
      body: RoleStateInputSchema.parse(body),
      schema: RoleDetailSchema,
    }),
    onSuccess: invalidate,
  })
}

export function useDisableAdminRole() { return useAdminRoleStateMutation('disable') }
export function useEnableAdminRole() { return useAdminRoleStateMutation('enable') }

export function useDeleteAdminRole() {
  const queryClient = useQueryClient()
  const { $api } = useApi()
  return useMutation({
    mutationFn: ({ id, expected_version }: { id: number; expected_version: string }) => $api(`/api/v1/admin/roles/${id}`, {
      method: 'DELETE',
      query: { expected_version },
    }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: adminRoleKeys.all })
      await queryClient.invalidateQueries({ queryKey: ['access', 'audit'] })
    },
  })
}

export type { PermissionCatalog, RoleDetail, RoleList }
