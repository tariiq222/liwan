import type { MaybeRefOrGetter } from 'vue'
import { computed, toValue } from 'vue'
import { useMutation, useQuery, useQueryClient } from '@tanstack/vue-query'
import {
  HrActivityPlanCreateSchema,
  HrActivityPlanListSchema,
  HrActivityPlanPatchSchema,
  HrActivityPlanSchema,
  HrPlanRunCreateSchema,
  HrPlanRunDetailSchema,
  HrPlanRunListSchema,
  HrPlanStepDoneSchema,
  type HrActivityPlan,
  type HrActivityPlanCreate,
  type HrActivityPlanList,
  type HrActivityPlanPatch,
  type HrPlanRunDetail,
  type HrPlanRunCancel,
  type HrPlanRunList,
  type HrPlanRunState,
  type HrPlanStepDone,
} from '@liwan/contracts'

export type {
  HrActivityPlan,
  HrActivityPlanList,
  HrPlanRunDetail,
  HrPlanStep,
  HrPlanRunStep,
  HrPlanRun,
} from '@liwan/contracts'

/**
 * The plan and run layer of the two employee-lifecycle areas. Both areas run the same
 * stock engine and share these hooks; `useHrOffboarding` re-exports them with its own
 * area name so a page imports only from its area.
 */
export type HrLifecycleArea = 'onboarding' | 'offboarding'

/** GET /plans query: `active` is the stock active filter, defaulting to the active plans. */
export interface HrPlanListParams {
  active: 'true' | 'false' | 'all'
  limit: number
  offset: number
}

/** GET /runs query: the checklist state is derived, so it filters after the read. */
export interface HrRunListParams {
  employee_id?: number
  state?: HrPlanRunState
  limit: number
  offset: number
}

export const hrLifecycleKeys = {
  area: (area: HrLifecycleArea) => ['hr', area] as const,
  plans: (area: HrLifecycleArea, params: HrPlanListParams) => ['hr', area, 'plans', params] as const,
  plan: (area: HrLifecycleArea, id: number) => ['hr', area, 'plan', id] as const,
  runs: (area: HrLifecycleArea, params: HrRunListParams) => ['hr', area, 'runs', params] as const,
  run: (area: HrLifecycleArea, id: number) => ['hr', area, 'run', id] as const,
}

export function hrPlanListQuery(params: HrPlanListParams) {
  return { active: params.active, limit: params.limit, offset: params.offset }
}

export function hrRunListQuery(params: HrRunListParams) {
  return {
    employee_id: params.employee_id ?? undefined,
    state: params.state,
    limit: params.limit,
    offset: params.offset,
  }
}

export function useHrActivityPlans(
  area: HrLifecycleArea,
  params: MaybeRefOrGetter<HrPlanListParams>,
  enabled: MaybeRefOrGetter<boolean> = true,
) {
  const { $api } = useApi()
  return useQuery({
    queryKey: computed(() => hrLifecycleKeys.plans(area, toValue(params))),
    enabled: computed(() => toValue(enabled)),
    queryFn: () => $api(`/api/v1/hr/${area}/plans`, {
      query: hrPlanListQuery(toValue(params)),
      schema: HrActivityPlanListSchema,
    }),
  })
}

export function useHrActivityPlan(area: HrLifecycleArea, id: MaybeRefOrGetter<number | null>) {
  const { $api } = useApi()
  return useQuery({
    queryKey: computed(() => hrLifecycleKeys.plan(area, toValue(id) ?? 0)),
    enabled: computed(() => Number.isSafeInteger(toValue(id)) && (toValue(id) ?? 0) > 0),
    queryFn: () => $api(`/api/v1/hr/${area}/plans/${toValue(id)}`, { schema: HrActivityPlanSchema }),
  })
}

export function useHrPlanRun(area: HrLifecycleArea, id: MaybeRefOrGetter<number | null>) {
  const { $api } = useApi()
  return useQuery({
    queryKey: computed(() => hrLifecycleKeys.run(area, toValue(id) ?? 0)),
    enabled: computed(() => Number.isSafeInteger(toValue(id)) && (toValue(id) ?? 0) > 0),
    queryFn: () => $api(`/api/v1/hr/${area}/runs/${toValue(id)}`, { schema: HrPlanRunDetailSchema }),
  })
}

export function useCreateHrActivityPlan(area: HrLifecycleArea) {
  const qc = useQueryClient()
  const { $api } = useApi()
  return useMutation({
    mutationFn: (body: HrActivityPlanCreate) =>
      $api(`/api/v1/hr/${area}/plans`, { method: 'POST', body, schema: HrActivityPlanSchema }),
    onSuccess: () => qc.invalidateQueries({ queryKey: hrLifecycleKeys.area(area) }),
  })
}

export function usePatchHrActivityPlan(area: HrLifecycleArea) {
  const qc = useQueryClient()
  const { $api } = useApi()
  return useMutation({
    mutationFn: ({ id, patch }: { id: number; patch: HrActivityPlanPatch }) =>
      $api(`/api/v1/hr/${area}/plans/${id}`, { method: 'PATCH', body: patch, schema: HrActivityPlanSchema }),
    onSuccess: () => qc.invalidateQueries({ queryKey: hrLifecycleKeys.area(area) }),
  })
}

export function useLaunchHrPlanRun(area: HrLifecycleArea) {
  const qc = useQueryClient()
  const { $api } = useApi()
  return useMutation({
    mutationFn: (body: { employee_id: number; plan_id: number; plan_date?: string }) =>
      $api(`/api/v1/hr/${area}/runs`, { method: 'POST', body, schema: HrPlanRunDetailSchema }),
    onSuccess: () => qc.invalidateQueries({ queryKey: hrLifecycleKeys.area(area) }),
  })
}

export function useCompleteHrPlanStep(area: HrLifecycleArea) {
  const qc = useQueryClient()
  const { $api } = useApi()
  return useMutation({
    mutationFn: ({ runId, stepId, feedback }: { runId: number; stepId: number; feedback?: string }) =>
      $api(`/api/v1/hr/${area}/runs/${runId}/steps/${stepId}/done`, {
        method: 'POST',
        body: { feedback } satisfies HrPlanStepDone,
        schema: HrPlanRunDetailSchema,
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: hrLifecycleKeys.area(area) }),
  })
}

/** Cancel a run launched by mistake: its open steps go, its done ones stay, and the reason is kept. */
export function useCancelHrPlanRun(area: HrLifecycleArea) {
  const qc = useQueryClient()
  const { $api } = useApi()
  return useMutation({
    mutationFn: ({ runId, reason }: { runId: number; reason: string }) =>
      $api(`/api/v1/hr/${area}/runs/${runId}/cancel`, {
        method: 'POST',
        body: { reason } satisfies HrPlanRunCancel,
        schema: HrPlanRunDetailSchema,
      }),
    onSuccess: (run) => {
      qc.setQueryData(hrLifecycleKeys.run(area, run.id), run)
      return qc.invalidateQueries({ queryKey: hrLifecycleKeys.area(area) })
    },
  })
}

export const HR_ONBOARDING = 'onboarding' as const

export function useHrOnboardingPlans(params: MaybeRefOrGetter<HrPlanListParams>, enabled: MaybeRefOrGetter<boolean> = true) {
  return useHrActivityPlans(HR_ONBOARDING, params, enabled)
}

export function useHrOnboardingPlan(id: MaybeRefOrGetter<number | null>) {
  return useHrActivityPlan(HR_ONBOARDING, id)
}

/** Only onboarding has a runs list: the offboarding register is the departures list. */
export function useHrOnboardingRuns(params: MaybeRefOrGetter<HrRunListParams>, enabled: MaybeRefOrGetter<boolean> = true) {
  const { $api } = useApi()
  return useQuery({
    queryKey: computed(() => hrLifecycleKeys.runs(HR_ONBOARDING, toValue(params))),
    enabled: computed(() => toValue(enabled)),
    queryFn: () => $api(`/api/v1/hr/${HR_ONBOARDING}/runs`, {
      query: hrRunListQuery(toValue(params)),
      schema: HrPlanRunListSchema,
    }),
  })
}

export function useHrOnboardingRun(id: MaybeRefOrGetter<number | null>) {
  return useHrPlanRun(HR_ONBOARDING, id)
}

export function usePatchHrOnboardingPlan() {
  return usePatchHrActivityPlan(HR_ONBOARDING)
}

export function useLaunchHrOnboardingRun() {
  return useLaunchHrPlanRun(HR_ONBOARDING)
}

export function useCompleteHrOnboardingStep() {
  return useCompleteHrPlanStep(HR_ONBOARDING)
}

export function useCancelHrOnboardingRun() {
  return useCancelHrPlanRun(HR_ONBOARDING)
}
