import { useHrOwnIdentity } from './useHrOwnIdentity'
import { ApiError } from './useApi'
import type { MaybeRefOrGetter } from 'vue'
import { computed, toValue } from 'vue'
import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/vue-query'
import {
  HrWarningCandidateListSchema,
  HrWarningListSchema,
  HrWarningSchema,
  HrWarningSettingsSchema,
  HrWarningStandingSchema,
  HrWarningTypeListSchema,
  HrWarningTypeSchema,
  type HrWarning,
  type HrWarningCreate,
  type HrWarningSettingsPatch,
  type HrWarningState,
  type HrWarningType,
  type HrWarningTypeCreate,
  type HrWarningTypePatch,
} from '@liwan/contracts'

type Api = ReturnType<typeof useApi>['$api']

/** The page size the warning lists ask for; the server caps it at 200. */
export const HR_WARNINGS_PAGE_SIZE = 25
const MAX_LIMIT = 100

export const hrWarningKeys = {
  all: ['hr', 'warnings'] as const,
  list: (query: HrWarningQuery) => ['hr', 'warnings', 'list', query] as const,
  detail: (id: number) => ['hr', 'warnings', 'detail', id] as const,
  mine: ['hr', 'warnings', 'me'] as const,
  candidates: ['hr', 'warnings', 'candidates'] as const,
  standing: (employeeId: number) => ['hr', 'warnings', 'standing', employeeId] as const,
  types: ['hr', 'warnings', 'types'] as const,
  settings: ['hr', 'warnings', 'settings'] as const,
}

export interface HrWarningQuery {
  employee_id?: number
  type_id?: number
  state?: HrWarningState
  limit?: number
  offset?: number
}

export interface HrWarningInput {
  employeeId?: number | null
  typeId?: number | null
  state?: HrWarningState | 'all'
  limit?: number
  offset?: number
}

/** The query string of one warning list request: unset filters are absent and paging is clamped. */
export function hrWarningQuery(input: HrWarningInput): HrWarningQuery {
  const asked = input.limit
  const limit = Number.isFinite(asked) && (asked as number) > 0 ? Math.min(Math.trunc(asked as number), MAX_LIMIT) : HR_WARNINGS_PAGE_SIZE
  const offset = Number.isInteger(input.offset) && (input.offset as number) > 0 ? (input.offset as number) : 0
  return {
    employee_id: input.employeeId ?? undefined,
    type_id: input.typeId ?? undefined,
    state: input.state && input.state !== 'all' ? input.state : undefined,
    limit,
    offset,
  }
}

/** A stale revision or a record in the wrong state answers 409. */
export function isHrWarningConflict(error: unknown): boolean {
  return error instanceof ApiError && error.status === 409
}

/** A write answers with the full warning: replace it in the cache, then refresh every list and figure. */
function replaceWarning(qc: QueryClient, warning: HrWarning) {
  qc.setQueryData(hrWarningKeys.detail(warning.id), warning)
  void qc.invalidateQueries({ queryKey: hrWarningKeys.all })
}

/** A 409 means the cached revision is stale: refresh the warnings, then let the caller show the message. */
async function refreshOnConflict<T>(qc: QueryClient, run: () => Promise<T>): Promise<T> {
  try {
    return await run()
  } catch (error) {
    if (isHrWarningConflict(error)) void qc.invalidateQueries({ queryKey: hrWarningKeys.all })
    throw error
  }
}

export async function createHrWarning($api: Api, qc: QueryClient, body: HrWarningCreate) {
  const warning = await $api('/api/v1/hr/warnings', { method: 'POST', body, schema: HrWarningSchema })
  replaceWarning(qc, warning)
  return warning
}

export interface HrWarningAction { id: number; revision: number }

function writeWarning($api: Api, qc: QueryClient, path: string, body: Record<string, unknown>) {
  return refreshOnConflict(qc, async () => {
    const warning = await $api(path, { method: 'POST', body, schema: HrWarningSchema })
    replaceWarning(qc, warning)
    return warning
  })
}

export const issueHrWarning = ($api: Api, qc: QueryClient, { id, revision }: HrWarningAction) =>
  writeWarning($api, qc, `/api/v1/hr/warnings/${id}/issue`, { revision })
export const withdrawHrWarning = ($api: Api, qc: QueryClient, { id, revision, reason }: HrWarningAction & { reason: string }) =>
  writeWarning($api, qc, `/api/v1/hr/warnings/${id}/withdraw`, { revision, reason })
export const acknowledgeHrWarning = ($api: Api, qc: QueryClient, { id, revision }: HrWarningAction) =>
  writeWarning($api, qc, `/api/v1/hr/warnings/me/${id}/acknowledge`, { revision })
export const contestHrWarning = ($api: Api, qc: QueryClient, { id, revision, note }: HrWarningAction & { note: string }) =>
  writeWarning($api, qc, `/api/v1/hr/warnings/me/${id}/contest`, { revision, note })

export async function createHrWarningType($api: Api, qc: QueryClient, body: HrWarningTypeCreate) {
  const type = await $api('/api/v1/hr/warning-types', { method: 'POST', body, schema: HrWarningTypeSchema })
  void qc.invalidateQueries({ queryKey: hrWarningKeys.types })
  return type
}

export function patchHrWarningType($api: Api, qc: QueryClient, { id, body }: { id: number; body: HrWarningTypePatch }) {
  return refreshOnConflict(qc, async () => {
    const type = await $api(`/api/v1/hr/warning-types/${id}`, { method: 'PATCH', body, schema: HrWarningTypeSchema })
    void qc.invalidateQueries({ queryKey: hrWarningKeys.types })
    return type
  })
}

export function useHrWarningList(input: MaybeRefOrGetter<HrWarningInput>, enabled: MaybeRefOrGetter<boolean> = true) {
  const { $api } = useApi()
  const { can } = useAccess()
  return useQuery({
    queryKey: computed(() => hrWarningKeys.list(hrWarningQuery(toValue(input)))),
    enabled: computed(() => can('hr.warnings.read') && toValue(enabled)),
    queryFn: () => $api('/api/v1/hr/warnings', { query: { ...hrWarningQuery(toValue(input)) }, schema: HrWarningListSchema }),
  })
}

export function useHrWarning(id: MaybeRefOrGetter<number | null>) {
  const { $api } = useApi()
  const { can } = useAccess()
  return useQuery({
    queryKey: computed(() => hrWarningKeys.detail(toValue(id) ?? 0)),
    // A direct manager reads the warnings he drafted without hr.warnings.read: the server decides who may open a record.
    enabled: computed(() => can('hr.employees.read') && !!toValue(id)),
    queryFn: () => $api(`/api/v1/hr/warnings/${toValue(id)}`, { schema: HrWarningSchema }),
  })
}

/** The caller's own issued warnings (`/me`): gated by the employee read capability, not by the warnings one. */
export function useMyHrWarnings(enabled: MaybeRefOrGetter<boolean> = true) {
  const { $api } = useApi()
  const identity = useHrOwnIdentity()
  const { can } = useAccess()
  return useQuery({
    queryKey: computed(() => [...hrWarningKeys.mine, identity.scope.value]),
    enabled: computed(() => identity.ready.value && toValue(enabled) && can('hr.employees.read')),
    queryFn: () => $api('/api/v1/hr/warnings/me', { query: { limit: MAX_LIMIT }, schema: HrWarningListSchema }),
  })
}

/** The escalation figure of one employee, shown to issuers (HR, or a direct manager for his reports; the server answers 403 otherwise and the note stays hidden). */
export function useHrWarningStanding(employeeId: MaybeRefOrGetter<number | null>) {
  const { $api } = useApi()
  const { can } = useAccess()
  const { canIssue } = useHrWarningIssuer()
  return useQuery({
    queryKey: computed(() => hrWarningKeys.standing(toValue(employeeId) ?? 0)),
    enabled: computed(() => (can('hr.warnings.read') || canIssue.value) && !!toValue(employeeId)),
    queryFn: () => $api(`/api/v1/hr/warnings/standing/${toValue(employeeId)}`, { schema: HrWarningStandingSchema }),
  })
}

/** The catalog of warning types; any employee reads it. `all` includes the archived types. */
export function useHrWarningTypes(active: MaybeRefOrGetter<'true' | 'all'> = 'true', enabled: MaybeRefOrGetter<boolean> = true) {
  const { $api } = useApi()
  const { can } = useAccess()
  return useQuery({
    queryKey: computed(() => [...hrWarningKeys.types, toValue(active)]),
    enabled: computed(() => can('hr.employees.read') && toValue(enabled)),
    queryFn: () => $api('/api/v1/hr/warning-types', {
      query: { active: toValue(active) === 'all' ? 'all' : undefined },
      schema: HrWarningTypeListSchema,
    }),
  })
}

/** Current-company policy for employee readers and warning managers. */
export function useHrWarningSettings(enabled: MaybeRefOrGetter<boolean> = true) {
  const { $api } = useApi()
  const identity = useHrOwnIdentity()
  const { can } = useAccess()
  return useQuery({
    queryKey: computed(() => [...hrWarningKeys.settings, identity.scope.value]),
    enabled: computed(() => identity.ready.value && toValue(enabled) && (can('hr.employees.read') || can('hr.warnings.manage'))),
    queryFn: () => $api('/api/v1/hr/warnings/settings', { schema: HrWarningSettingsSchema }),
  })
}

/** Whether the caller may issue warnings (HR, or a direct manager under the manager policy): the server's answer, not a capability. */
export function useHrWarningIssuer() {
  const settings = useHrWarningSettings()
  return {
    canIssue: computed(() => settings.data.value?.can_issue === true),
    isLoading: settings.isLoading,
    error: computed(() => (settings.data.value ? null : settings.error.value)),
    refetch: settings.refetch,
  }
}

/** The employees the caller may warn: every employee for HR, the direct reports for a manager. */
export function useHrWarningCandidates(enabled: MaybeRefOrGetter<boolean> = true) {
  const { $api } = useApi()
  return useQuery({
    queryKey: hrWarningKeys.candidates,
    enabled: computed(() => toValue(enabled)),
    queryFn: () => $api('/api/v1/hr/warnings/candidates', { schema: HrWarningCandidateListSchema }),
  })
}

export function useCreateHrWarning() {
  const qc = useQueryClient()
  const { $api } = useApi()
  return useMutation({ mutationFn: (body: HrWarningCreate) => createHrWarning($api, qc, body) })
}

export function useIssueHrWarning() {
  const qc = useQueryClient()
  const { $api } = useApi()
  return useMutation({ mutationFn: (action: HrWarningAction) => issueHrWarning($api, qc, action) })
}

export function useWithdrawHrWarning() {
  const qc = useQueryClient()
  const { $api } = useApi()
  return useMutation({ mutationFn: (action: HrWarningAction & { reason: string }) => withdrawHrWarning($api, qc, action) })
}

export function useAcknowledgeHrWarning() {
  const qc = useQueryClient()
  const { $api } = useApi()
  return useMutation({ mutationFn: (action: HrWarningAction) => acknowledgeHrWarning($api, qc, action) })
}

export function useContestHrWarning() {
  const qc = useQueryClient()
  const { $api } = useApi()
  return useMutation({ mutationFn: (action: HrWarningAction & { note: string }) => contestHrWarning($api, qc, action) })
}

export function useCreateHrWarningType() {
  const qc = useQueryClient()
  const { $api } = useApi()
  return useMutation({ mutationFn: (body: HrWarningTypeCreate) => createHrWarningType($api, qc, body) })
}

export function usePatchHrWarningType() {
  const qc = useQueryClient()
  const { $api } = useApi()
  return useMutation({ mutationFn: (action: { id: number; body: HrWarningTypePatch }) => patchHrWarningType($api, qc, action) })
}

export function usePatchHrWarningSettings() {
  const qc = useQueryClient()
  const { $api } = useApi()
  const identity = useHrOwnIdentity()
  return useMutation({
    onMutate: () => identity.scope.value,
    mutationFn: (body: HrWarningSettingsPatch) => refreshOnConflict(qc, () => $api('/api/v1/hr/warnings/settings', { method: 'PATCH', body, schema: HrWarningSettingsSchema })),
    onSuccess: async (settings, _body, scope) => {
      if (!identity.ready.value || !scope || scope.companyId !== identity.scope.value.companyId || scope.userId !== identity.scope.value.userId) return
      const key = [...hrWarningKeys.settings, scope]
      // An earlier focus/refetch must not overwrite the authoritative write response.
      await qc.cancelQueries({ queryKey: key, exact: true })
      qc.setQueryData(key, settings)
      // The standing figure and the window text follow the saved policy.
      await qc.invalidateQueries({ queryKey: hrWarningKeys.all, refetchType: 'none' })
    },
  })
}

// HrRef is not re-exported: Nuxt auto-imports every composable export, so a second owner
// of the name would break the auto-import map. Import it from @liwan/contracts.
export type { HrWarning, HrWarningType }
