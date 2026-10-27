import type { MaybeRefOrGetter } from 'vue'
import { computed, toValue } from 'vue'
import { useMutation, useQuery, useQueryClient } from '@tanstack/vue-query'
import {
  HrDepartureListSchema,
  HrDepartureReasonListSchema,
  HrDepartureSchema,
  type HrDeparture,
  type HrDepartureCreate,
  type HrDepartureList,
  type HrDeparturePatch,
} from '@webvue/contracts'
import {
  hrLifecycleKeys,
  useHrActivityPlan,
  useHrActivityPlans,
  useCancelHrPlanRun,
  useCompleteHrPlanStep,
  useCreateHrActivityPlan,
  useLaunchHrPlanRun,
  usePatchHrActivityPlan,
  useHrPlanRun,
  useHrPlanRuns,
  type HrPlanListParams,
  type HrRunListParams,
} from './useHrOnboarding'

export type { HrDeparture, HrDepartureList } from '@webvue/contracts'

/** GET /departures query: the register of the current company, with its clearance filter. */
export interface HrDepartureListParams {
  q?: string
  cleared?: 'true' | 'false'
  limit: number
  offset: number
}

export const hrDepartureKeys = {
  all: hrLifecycleKeys.area('offboarding'),
  departures: (params: HrDepartureListParams) => ['hr', 'offboarding', 'departures', params] as const,
  departure: (employeeId: number) => ['hr', 'offboarding', 'departure', employeeId] as const,
  reasons: ['hr', 'offboarding', 'reasons'] as const,
}

export function hrDepartureListQuery(params: HrDepartureListParams) {
  return {
    q: params.q?.trim() || undefined,
    cleared: params.cleared,
    limit: params.limit,
    offset: params.offset,
  }
}

export function useHrOffboardingPlans(params: MaybeRefOrGetter<HrPlanListParams>, enabled: MaybeRefOrGetter<boolean> = true) {
  return useHrActivityPlans('offboarding', params, enabled)
}

export function useHrOffboardingPlan(id: MaybeRefOrGetter<number | null>) {
  return useHrActivityPlan('offboarding', id)
}

export function useHrOffboardingRuns(params: MaybeRefOrGetter<HrRunListParams>, enabled: MaybeRefOrGetter<boolean> = true) {
  return useHrPlanRuns('offboarding', params, enabled)
}

export function useHrOffboardingRun(id: MaybeRefOrGetter<number | null>) {
  return useHrPlanRun('offboarding', id)
}

export function useCreateHrOffboardingPlan() {
  return useCreateHrActivityPlan('offboarding')
}

export function usePatchHrOffboardingPlan() {
  return usePatchHrActivityPlan('offboarding')
}

export function useLaunchHrOffboardingRun() {
  return useLaunchHrPlanRun('offboarding')
}

export function useCompleteHrOffboardingStep() {
  return useCompleteHrPlanStep('offboarding')
}

export function useCancelHrOffboardingRun() {
  return useCancelHrPlanRun('offboarding')
}

export function useHrDepartureReasons() {
  const { $api } = useApi()
  return useQuery({
    queryKey: hrDepartureKeys.reasons,
    queryFn: () => $api('/api/v1/hr/offboarding/reasons', { schema: HrDepartureReasonListSchema }),
  })
}

export function useHrDepartures(params: MaybeRefOrGetter<HrDepartureListParams>, enabled: MaybeRefOrGetter<boolean> = true) {
  const { $api } = useApi()
  return useQuery({
    queryKey: computed(() => hrDepartureKeys.departures(toValue(params))),
    enabled: computed(() => toValue(enabled)),
    queryFn: () => $api('/api/v1/hr/offboarding/departures', {
      query: hrDepartureListQuery(toValue(params)),
      schema: HrDepartureListSchema,
    }),
  })
}

export function useHrDeparture(employeeId: MaybeRefOrGetter<number | null>) {
  const { $api } = useApi()
  return useQuery({
    queryKey: computed(() => hrDepartureKeys.departure(toValue(employeeId) ?? 0)),
    enabled: computed(() => Number.isSafeInteger(toValue(employeeId)) && (toValue(employeeId) ?? 0) > 0),
    queryFn: () => $api(`/api/v1/hr/offboarding/departures/${toValue(employeeId)}`, { schema: HrDepartureSchema }),
  })
}

export function useRegisterHrDeparture() {
  const qc = useQueryClient()
  const { $api } = useApi()
  return useMutation({
    mutationFn: (body: HrDepartureCreate) =>
      $api('/api/v1/hr/offboarding/departures', { method: 'POST', body, schema: HrDepartureSchema }),
    onSuccess: () => qc.invalidateQueries({ queryKey: hrDepartureKeys.all }),
  })
}

export function usePatchHrDeparture() {
  const qc = useQueryClient()
  const { $api } = useApi()
  return useMutation({
    mutationFn: ({ employeeId, patch }: { employeeId: number; patch: HrDeparturePatch }) =>
      $api(`/api/v1/hr/offboarding/departures/${employeeId}`, {
        method: 'PATCH', body: patch, schema: HrDepartureSchema,
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: hrDepartureKeys.all }),
  })
}
