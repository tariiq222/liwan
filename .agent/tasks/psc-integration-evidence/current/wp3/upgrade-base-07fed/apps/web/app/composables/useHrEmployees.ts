import type { MaybeRefOrGetter } from 'vue'
import { computed, toValue } from 'vue'
import { useMutation, useQuery, useQueryClient } from '@tanstack/vue-query'
import {
  HrEmployeeCreateSchema,
  HrEmployeeListSchema,
  HrEmployeePatchSchema,
  HrEmployeeSchema,
  type HrEmployee,
  type HrEmployeeCreate,
  type HrEmployeeList,
  type HrEmployeePatch,
} from '@nasq/contracts'

export type { HrEmployee, HrEmployeeList }

// Kept as a compatibility export for consumers that used the old HR access
// mutation cache policy. Account mutations now belong to the access module.
export const HR_ACCESS_MUTATION_GC_TIME = 0

export type HrEmployeeListParams = {
  q?: string
  department_id?: number
  archived?: boolean
  limit?: number
  offset?: number
}

export const hrEmployeeKeys = {
  list: (params: HrEmployeeListParams) => ['hr', 'employees', params] as const,
  detail: (id: number) => ['hr', 'employee', id] as const,
}

export function hrEmployeeListQuery(params: HrEmployeeListParams = {}) {
  return {
    q: params.q || undefined,
    department_id: params.department_id,
    archived: params.archived ? true : undefined,
    limit: params.limit ?? 200,
    offset: params.offset ?? 0,
  }
}

export function useHrEmployees(params: MaybeRefOrGetter<HrEmployeeListParams> = {}) {
  const { $api } = useApi()
  return useQuery({
    queryKey: computed(() => hrEmployeeKeys.list(toValue(params))),
    queryFn: () => $api('/api/v1/hr/employees', { query: hrEmployeeListQuery(toValue(params)), schema: HrEmployeeListSchema }),
  })
}

export function useHrEmployee(id: MaybeRefOrGetter<number | null>) {
  const { $api } = useApi()
  return useQuery({
    queryKey: computed(() => hrEmployeeKeys.detail(toValue(id) ?? 0)),
    enabled: computed(() => !!toValue(id)),
    queryFn: () => $api(`/api/v1/hr/employees/${toValue(id)}`, { schema: HrEmployeeSchema }),
  })
}

export function invalidateHrEmployeeLists(qc: ReturnType<typeof useQueryClient>) {
  void qc.invalidateQueries({ queryKey: ['hr', 'employees'] })
}

export function invalidateHrDepartmentLists(qc: ReturnType<typeof useQueryClient>) {
  void qc.invalidateQueries({ queryKey: ['hr', 'departments'] })
}

function setEmployeeDetailAndInvalidate(qc: ReturnType<typeof useQueryClient>, employee: HrEmployee, includePeople = false, includeDepartments = true) {
  qc.setQueryData(hrEmployeeKeys.detail(employee.id), employee)
  invalidateHrEmployeeLists(qc)
  if (includeDepartments) invalidateHrDepartmentLists(qc)
  if (includePeople) void qc.invalidateQueries({ queryKey: ['people'] })
}

export function invalidateHrAccessCaches(qc: ReturnType<typeof useQueryClient>) {
  invalidateHrEmployeeLists(qc)
  void qc.invalidateQueries({ queryKey: ['people'] })
}

export function useCreateHrEmployee() {
  const qc = useQueryClient(); const { $api } = useApi()
  return useMutation({
    mutationFn: (body: HrEmployeeCreate) => $api('/api/v1/hr/employees', { method: 'POST', body, schema: HrEmployeeSchema }),
    onSuccess: (employee) => setEmployeeDetailAndInvalidate(qc, employee),
  })
}

export function useUpdateHrEmployee() {
  const qc = useQueryClient(); const { $api } = useApi()
  return useMutation({
    mutationFn: ({ id, patch }: { id: number; patch: HrEmployeePatch }) =>
      $api(`/api/v1/hr/employees/${id}`, { method: 'PATCH', body: patch, schema: HrEmployeeSchema }),
    onSuccess: (employee) => setEmployeeDetailAndInvalidate(qc, employee),
  })
}

function useEmployeeArchiveMutation(action: 'archive' | 'unarchive') {
  const qc = useQueryClient(); const { $api } = useApi()
  return useMutation({
    mutationFn: (id: number) => $api(`/api/v1/hr/employees/${id}/${action}`, { method: 'POST', schema: HrEmployeeSchema }),
    onSuccess: (employee) => setEmployeeDetailAndInvalidate(qc, employee, true),
  })
}
export function useArchiveHrEmployee() { return useEmployeeArchiveMutation('archive') }
export function useUnarchiveHrEmployee() { return useEmployeeArchiveMutation('unarchive') }

export { HrEmployeeCreateSchema, HrEmployeePatchSchema }
