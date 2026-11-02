import { useHrOwnIdentity } from './useHrOwnIdentity'
import { ApiError } from './useApi'
import type { MaybeRefOrGetter } from 'vue'
import { computed, toValue } from 'vue'
import { useInfiniteQuery, useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/vue-query'
import {
  HrInsuranceDependentSchema,
  HrInsuranceEnrollmentDetailSchema,
  HrInsuranceEnrollmentListSchema,
  HrInsuranceOwnListSchema,
  HrInsurancePlanListSchema,
  HrInsurancePlanSchema,
  HrInsuranceProviderListSchema,
  HrInsuranceProviderSchema,
  HrInsuranceSettingsSchema,
  HrInsuranceSummarySchema,
  type HrInsuranceDependentCreate,
  type HrInsuranceDependentPatch,
  type HrInsuranceEnrollmentCreate,
  type HrInsuranceEnrollmentPatch,
  type HrInsuranceEnrollmentState,
  type HrInsurancePlanCreate,
  type HrInsurancePlanPatch,
  type HrInsurancePlanState,
  type HrInsuranceProviderCreate,
  type HrInsuranceProviderPatch,
  type HrInsuranceSettings,
} from '@liwan/contracts'

type Api = ReturnType<typeof useApi>['$api']
type OwnPage = { items: unknown[]; total: number }

/** The page size the insurance lists ask for; the server caps it at 200. */
export const HR_INSURANCE_PAGE_SIZE = 25
const MAX_LIMIT = 100
const BASE = '/api/v1/hr/insurance'

export const hrInsuranceKeys = {
  all: ['hr', 'insurance'] as const,
  enrollments: (query: HrInsuranceEnrollmentQuery) => ['hr', 'insurance', 'enrollments', query] as const,
  enrollment: (id: number) => ['hr', 'insurance', 'enrollment', id] as const,
  plans: (query: HrInsurancePlanQuery) => ['hr', 'insurance', 'plans', query] as const,
  plan: (id: number) => ['hr', 'insurance', 'plan', id] as const,
  providers: ['hr', 'insurance', 'providers'] as const,
  mine: ['hr', 'insurance', 'me'] as const,
  settings: ['hr', 'insurance', 'settings'] as const,
  summary: ['hr', 'insurance', 'summary'] as const,
}

export interface HrInsuranceEnrollmentQuery {
  employee_id?: number
  plan_id?: number
  state?: HrInsuranceEnrollmentState
  expiring?: 'true'
  limit?: number
  offset?: number
}

export interface HrInsuranceEnrollmentInput {
  employeeId?: number | null
  planId?: number | null
  state?: HrInsuranceEnrollmentState | 'all'
  expiring?: boolean
  limit?: number
  offset?: number
}

export interface HrInsurancePlanQuery {
  provider_id?: number
  state?: HrInsurancePlanState
  limit?: number
  offset?: number
}

export interface HrInsurancePlanInput {
  providerId?: number | null
  state?: HrInsurancePlanState | 'all'
  limit?: number
  offset?: number
}

function pageOf(input: { limit?: number; offset?: number }) {
  const asked = input.limit
  const limit = Number.isFinite(asked) && (asked as number) > 0 ? Math.min(Math.trunc(asked as number), MAX_LIMIT) : HR_INSURANCE_PAGE_SIZE
  const offset = Number.isInteger(input.offset) && (input.offset as number) > 0 ? (input.offset as number) : 0
  return { limit, offset }
}

/** The query string of one enrollment list request: unset filters are absent and paging is clamped. */
export function hrInsuranceEnrollmentQuery(input: HrInsuranceEnrollmentInput): HrInsuranceEnrollmentQuery {
  return {
    employee_id: input.employeeId ?? undefined,
    plan_id: input.planId ?? undefined,
    state: input.state && input.state !== 'all' ? input.state : undefined,
    expiring: input.expiring ? 'true' : undefined,
    ...pageOf(input),
  }
}

/** The query string of one plan list request. */
export function hrInsurancePlanQuery(input: HrInsurancePlanInput): HrInsurancePlanQuery {
  return {
    provider_id: input.providerId ?? undefined,
    state: input.state && input.state !== 'all' ? input.state : undefined,
    ...pageOf(input),
  }
}

/** A stale revision or a record in the wrong state answers 409. */
export function isHrInsuranceConflict(error: unknown): boolean {
  return error instanceof ApiError && error.status === 409
}

/** A 409 means the cached revision is stale: refresh the insurance data, then let the caller show the message. */
async function refreshOnConflict<T>(qc: QueryClient, run: () => Promise<T>): Promise<T> {
  try {
    return await run()
  } catch (error) {
    if (isHrInsuranceConflict(error)) void qc.invalidateQueries({ queryKey: hrInsuranceKeys.all })
    throw error
  }
}

/** The offset of the next own-coverage page: the count loaded so far, or none once the total is reached. */
export function nextOwnHrInsuranceOffset(pages: readonly OwnPage[]): number | undefined {
  const loaded = pages.reduce((count, page) => count + page.items.length, 0)
  const total = pages.at(-1)?.total ?? 0
  return loaded < total ? loaded : undefined
}

export function useHrInsuranceEnrollments(input: MaybeRefOrGetter<HrInsuranceEnrollmentInput>, enabled: MaybeRefOrGetter<boolean> = true) {
  const { $api } = useApi()
  const { can } = useAccess()
  return useQuery({
    queryKey: computed(() => hrInsuranceKeys.enrollments(hrInsuranceEnrollmentQuery(toValue(input)))),
    enabled: computed(() => can('hr.insurance.read') && toValue(enabled)),
    queryFn: () => $api(`${BASE}/enrollments`, { query: { ...hrInsuranceEnrollmentQuery(toValue(input)) }, schema: HrInsuranceEnrollmentListSchema }),
  })
}

export function useHrInsuranceEnrollment(id: MaybeRefOrGetter<number | null>) {
  const { $api } = useApi()
  const { can } = useAccess()
  return useQuery({
    queryKey: computed(() => hrInsuranceKeys.enrollment(toValue(id) ?? 0)),
    enabled: computed(() => can('hr.insurance.read') && !!toValue(id)),
    queryFn: () => $api(`${BASE}/enrollments/${toValue(id)}`, { schema: HrInsuranceEnrollmentDetailSchema }),
  })
}

export function useHrInsurancePlans(input: MaybeRefOrGetter<HrInsurancePlanInput>, enabled: MaybeRefOrGetter<boolean> = true) {
  const { $api } = useApi()
  const { can } = useAccess()
  return useQuery({
    queryKey: computed(() => hrInsuranceKeys.plans(hrInsurancePlanQuery(toValue(input)))),
    enabled: computed(() => can('hr.insurance.read') && toValue(enabled)),
    queryFn: () => $api(`${BASE}/plans`, { query: { ...hrInsurancePlanQuery(toValue(input)) }, schema: HrInsurancePlanListSchema }),
  })
}

export function useHrInsurancePlan(id: MaybeRefOrGetter<number | null>) {
  const { $api } = useApi()
  const { can } = useAccess()
  return useQuery({
    queryKey: computed(() => hrInsuranceKeys.plan(toValue(id) ?? 0)),
    enabled: computed(() => can('hr.insurance.read') && !!toValue(id)),
    queryFn: () => $api(`${BASE}/plans/${toValue(id)}`, { schema: HrInsurancePlanSchema }),
  })
}

/** The company's insurers; `all` includes the archived ones (the settings card restores them). */
export function useHrInsuranceProviders(active: MaybeRefOrGetter<'true' | 'all'> = 'true', enabled: MaybeRefOrGetter<boolean> = true) {
  const { $api } = useApi()
  const { can } = useAccess()
  return useQuery({
    queryKey: computed(() => [...hrInsuranceKeys.providers, toValue(active)]),
    enabled: computed(() => can('hr.insurance.read') && toValue(enabled)),
    queryFn: () => $api(`${BASE}/providers`, {
      query: { active: toValue(active) === 'all' ? 'all' : undefined },
      schema: HrInsuranceProviderListSchema,
    }),
  })
}

/** The counts of the dashboard strip: members, expiring plans, employees without cover. */
export function useHrInsuranceSummary(enabled: MaybeRefOrGetter<boolean> = true) {
  const { $api } = useApi()
  const { can } = useAccess()
  return useQuery({
    queryKey: hrInsuranceKeys.summary,
    enabled: computed(() => can('hr.insurance.read') && toValue(enabled)),
    queryFn: () => $api(`${BASE}/summary`, { schema: HrInsuranceSummarySchema }),
  })
}

/** The caller's own coverage (`/me`), a page at a time: gated by the employee read capability, not by the insurance ones. */
export function useMyHrInsurance(enabled: MaybeRefOrGetter<boolean> = true) {
  const { $api } = useApi()
  const identity = useHrOwnIdentity()
  const { can } = useAccess()
  return useInfiniteQuery({
    queryKey: computed(() => [...hrInsuranceKeys.mine, identity.scope.value]),
    enabled: computed(() => identity.ready.value && toValue(enabled) && can('hr.employees.read')),
    queryFn: ({ pageParam }) => $api(`${BASE}/me`, { query: { limit: HR_INSURANCE_PAGE_SIZE, offset: pageParam }, schema: HrInsuranceOwnListSchema }),
    initialPageParam: 0,
    getNextPageParam: (_last, pages) => nextOwnHrInsuranceOffset(pages),
  })
}

/** Current-company policy for employee readers and insurance managers. */
export function useHrInsuranceSettings(enabled: MaybeRefOrGetter<boolean> = true) {
  const { $api } = useApi()
  const identity = useHrOwnIdentity()
  const { can } = useAccess()
  return useQuery({
    queryKey: computed(() => [...hrInsuranceKeys.settings, identity.scope.value]),
    enabled: computed(() => identity.ready.value && toValue(enabled) && (can('hr.employees.read') || can('hr.insurance.manage'))),
    queryFn: () => $api(`${BASE}/settings`, { schema: HrInsuranceSettingsSchema }),
  })
}

function write<T>(qc: QueryClient, run: () => Promise<T>) {
  return refreshOnConflict(qc, async () => {
    const result = await run()
    void qc.invalidateQueries({ queryKey: hrInsuranceKeys.all })
    return result
  })
}

export function useCreateHrInsuranceProvider() {
  const qc = useQueryClient()
  const { $api } = useApi()
  return useMutation({ mutationFn: (body: HrInsuranceProviderCreate) => write(qc, () => $api(`${BASE}/providers`, { method: 'POST', body, schema: HrInsuranceProviderSchema })) })
}

export function usePatchHrInsuranceProvider() {
  const qc = useQueryClient()
  const { $api } = useApi()
  return useMutation({ mutationFn: ({ id, body }: { id: number; body: HrInsuranceProviderPatch }) => write(qc, () => $api(`${BASE}/providers/${id}`, { method: 'PATCH', body, schema: HrInsuranceProviderSchema })) })
}

export function useCreateHrInsurancePlan() {
  const qc = useQueryClient()
  const { $api } = useApi()
  return useMutation({ mutationFn: (body: HrInsurancePlanCreate) => write(qc, () => $api(`${BASE}/plans`, { method: 'POST', body, schema: HrInsurancePlanSchema })) })
}

export function usePatchHrInsurancePlan() {
  const qc = useQueryClient()
  const { $api } = useApi()
  return useMutation({ mutationFn: ({ id, body }: { id: number; body: HrInsurancePlanPatch }) => write(qc, () => $api(`${BASE}/plans/${id}`, { method: 'PATCH', body, schema: HrInsurancePlanSchema })) })
}

export function useCreateHrInsuranceEnrollment() {
  const qc = useQueryClient()
  const { $api } = useApi()
  return useMutation({ mutationFn: (body: HrInsuranceEnrollmentCreate) => write(qc, () => $api(`${BASE}/enrollments`, { method: 'POST', body, schema: HrInsuranceEnrollmentDetailSchema })) })
}

export function usePatchHrInsuranceEnrollment() {
  const qc = useQueryClient()
  const { $api } = useApi()
  return useMutation({ mutationFn: ({ id, body }: { id: number; body: HrInsuranceEnrollmentPatch }) => write(qc, () => $api(`${BASE}/enrollments/${id}`, { method: 'PATCH', body, schema: HrInsuranceEnrollmentDetailSchema })) })
}

/** End (with an optional date) or cancel one enrollment: both answer the whole record. */
export function useStepHrInsuranceEnrollment() {
  const qc = useQueryClient()
  const { $api } = useApi()
  return useMutation({
    mutationFn: ({ id, step, revision, dateEnd }: { id: number; step: 'end' | 'cancel'; revision: number; dateEnd?: string }) =>
      write(qc, () => $api(`${BASE}/enrollments/${id}/${step}`, { method: 'POST', body: { revision, date_end: step === 'end' ? dateEnd : undefined }, schema: HrInsuranceEnrollmentDetailSchema })),
  })
}

export function useAddHrInsuranceDependent() {
  const qc = useQueryClient()
  const { $api } = useApi()
  return useMutation({ mutationFn: ({ enrollmentId, body }: { enrollmentId: number; body: HrInsuranceDependentCreate }) => write(qc, () => $api(`${BASE}/enrollments/${enrollmentId}/dependents`, { method: 'POST', body, schema: HrInsuranceDependentSchema })) })
}

export function usePatchHrInsuranceDependent() {
  const qc = useQueryClient()
  const { $api } = useApi()
  return useMutation({ mutationFn: ({ id, body }: { id: number; body: HrInsuranceDependentPatch }) => write(qc, () => $api(`${BASE}/dependents/${id}`, { method: 'PATCH', body, schema: HrInsuranceDependentSchema })) })
}

export function useEndHrInsuranceDependent() {
  const qc = useQueryClient()
  const { $api } = useApi()
  return useMutation({ mutationFn: ({ id, revision, dateEnd }: { id: number; revision: number; dateEnd?: string }) => write(qc, () => $api(`${BASE}/dependents/${id}/end`, { method: 'POST', body: { revision, date_end: dateEnd }, schema: HrInsuranceDependentSchema })) })
}

export function usePatchHrInsuranceSettings() {
  const qc = useQueryClient()
  const { $api } = useApi()
  const identity = useHrOwnIdentity()
  return useMutation({
    onMutate: () => identity.scope.value,
    mutationFn: (body: HrInsuranceSettings) => refreshOnConflict(qc, () => $api(`${BASE}/settings`, { method: 'PATCH', body, schema: HrInsuranceSettingsSchema })),
    onSuccess: async (settings, _body, scope) => {
      if (!identity.ready.value || !scope || scope.companyId !== identity.scope.value.companyId || scope.userId !== identity.scope.value.userId) return
      const key = [...hrInsuranceKeys.settings, scope]
      // An earlier focus/refetch must not overwrite the authoritative write response.
      await qc.cancelQueries({ queryKey: key, exact: true })
      qc.setQueryData(key, settings)
      // The alert window and the dependents shown to employees follow the saved policy.
      await qc.invalidateQueries({ queryKey: hrInsuranceKeys.all, refetchType: 'none' })
    },
  })
}
