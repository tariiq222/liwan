import { useHrOwnIdentity } from './useHrOwnIdentity'
import type { MaybeRefOrGetter } from 'vue'
import { computed, toValue } from 'vue'
import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/vue-query'
import {
  HrShiftAssignmentListSchema,
  HrShiftAssignmentSchema,
  HrShiftScheduleListSchema,
  HrShiftScheduleSchema,
  type HrShiftAssignment,
  type HrShiftAssignmentCreate,
  type HrShiftSchedule,
  type HrShiftScheduleCreate,
  type HrShiftSchedulePatch,
} from '@webvue/contracts'

export type { HrShiftAssignment, HrShiftSchedule }

/** One page of a list route; the pages own the actual size. */
export const HR_SHIFTS_PAGE_SIZE = 25

/** `true`/`false` list only that side; `all` includes the archived schedules. */
export type HrShiftScheduleActive = 'true' | 'false' | 'all'

export interface HrShiftScheduleListParams {
  active: HrShiftScheduleActive
  limit: number
  offset: number
}

export interface HrShiftAssignmentListParams {
  employee_id: number | null
  schedule_id: number | null
  on_date: string | null
  limit: number
  offset: number
}

export const hrShiftKeys = {
  all: ['hr', 'shifts'] as const,
  schedules: (params: HrShiftScheduleListParams) => ['hr', 'shifts', 'schedules', params] as const,
  schedule: (id: number) => ['hr', 'shifts', 'schedule', id] as const,
  assignments: (params: HrShiftAssignmentListParams) => ['hr', 'shifts', 'assignments', params] as const,
  mine: ['hr', 'shifts', 'me'] as const,
}

/** The schedule list query: the default is "active only", so `true` sends no filter. */
export function hrShiftScheduleQuery(params: HrShiftScheduleListParams) {
  return {
    active: params.active === 'true' ? undefined : params.active,
    limit: params.limit,
    offset: params.offset,
  }
}

/** The assignment list query: every filter is optional and absent when unset. */
export function hrShiftAssignmentQuery(params: HrShiftAssignmentListParams) {
  return {
    employee_id: params.employee_id ?? undefined,
    schedule_id: params.schedule_id ?? undefined,
    on_date: params.on_date ?? undefined,
    limit: params.limit,
    offset: params.offset,
  }
}

async function refreshShifts(qc: QueryClient) {
  await qc.invalidateQueries({ queryKey: hrShiftKeys.all })
}

export function useHrShiftSchedules(params: MaybeRefOrGetter<HrShiftScheduleListParams>) {
  const { $api } = useApi()
  const { can } = useAccess()
  return useQuery({
    queryKey: computed(() => hrShiftKeys.schedules(toValue(params))),
    enabled: computed(() => can('hr.shifts.read')),
    queryFn: () => $api('/api/v1/hr/shifts/schedules', {
      query: hrShiftScheduleQuery(toValue(params)),
      schema: HrShiftScheduleListSchema,
    }),
  })
}

export function useHrShiftSchedule(id: MaybeRefOrGetter<number | null>) {
  const { $api } = useApi()
  return useQuery({
    queryKey: computed(() => hrShiftKeys.schedule(toValue(id) ?? 0)),
    enabled: computed(() => !!toValue(id)),
    queryFn: () => $api(`/api/v1/hr/shifts/schedules/${toValue(id)}`, { schema: HrShiftScheduleSchema }),
  })
}

export function useHrShiftAssignments(params: MaybeRefOrGetter<HrShiftAssignmentListParams>) {
  const { $api } = useApi()
  const { can } = useAccess()
  return useQuery({
    queryKey: computed(() => hrShiftKeys.assignments(toValue(params))),
    enabled: computed(() => can('hr.shifts.read')),
    queryFn: () => $api('/api/v1/hr/shifts/assignments', {
      query: hrShiftAssignmentQuery(toValue(params)),
      schema: HrShiftAssignmentListSchema,
    }),
  })
}

/** The caller's own planning rows: the only list an employee without hr.shifts.read may read. */
export function useMyHrShiftAssignments(enabled: MaybeRefOrGetter<boolean> = true) {
  const { $api } = useApi()
  const identity = useHrOwnIdentity()
  const { can } = useAccess()
  return useQuery({
    queryKey: computed(() => [...hrShiftKeys.mine, identity.scope.value]),
    enabled: computed(() => identity.ready.value && toValue(enabled) && can('hr.employees.read')),
    queryFn: () => $api('/api/v1/hr/shifts/me', { schema: HrShiftAssignmentListSchema }),
  })
}

export function useCreateHrShiftSchedule() {
  const qc = useQueryClient()
  const { $api } = useApi()
  return useMutation({
    mutationFn: (body: HrShiftScheduleCreate) =>
      $api('/api/v1/hr/shifts/schedules', { method: 'POST', body, schema: HrShiftScheduleSchema }),
    onSuccess: async (schedule) => {
      qc.setQueryData(hrShiftKeys.schedule(schedule.id), schedule)
      await refreshShifts(qc)
    },
  })
}

export function useUpdateHrShiftSchedule() {
  const qc = useQueryClient()
  const { $api } = useApi()
  return useMutation({
    mutationFn: ({ id, patch }: { id: number; patch: HrShiftSchedulePatch }) =>
      $api(`/api/v1/hr/shifts/schedules/${id}`, { method: 'PATCH', body: patch, schema: HrShiftScheduleSchema }),
    onSuccess: async (schedule) => {
      qc.setQueryData(hrShiftKeys.schedule(schedule.id), schedule)
      await refreshShifts(qc)
    },
  })
}

export function useArchiveHrShiftSchedule() {
  const qc = useQueryClient()
  const { $api } = useApi()
  return useMutation({
    mutationFn: (id: number) =>
      $api(`/api/v1/hr/shifts/schedules/${id}/archive`, { method: 'POST', body: {}, schema: HrShiftScheduleSchema }),
    onSuccess: async (schedule) => {
      qc.setQueryData(hrShiftKeys.schedule(schedule.id), schedule)
      await refreshShifts(qc)
    },
  })
}

export function useCreateHrShiftAssignment() {
  const qc = useQueryClient()
  const { $api } = useApi()
  return useMutation({
    mutationFn: (body: HrShiftAssignmentCreate) =>
      $api('/api/v1/hr/shifts/assignments', { method: 'POST', body, schema: HrShiftAssignmentSchema }),
    onSuccess: () => refreshShifts(qc),
  })
}

export function useDeleteHrShiftAssignment() {
  const qc = useQueryClient()
  const { $api } = useApi()
  return useMutation({
    mutationFn: (id: number) => $api<{ id: number }>(`/api/v1/hr/shifts/assignments/${id}`, { method: 'DELETE' }),
    onSuccess: () => refreshShifts(qc),
  })
}
