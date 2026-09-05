import { useMutation, useQuery, useQueryClient } from '@tanstack/vue-query'
import {
  HrDepartmentListSchema,
  HrDepartmentSchema,
  type HrDepartment,
  type HrDepartmentList,
} from '../../../../packages/contracts/src/hr'

export type { HrDepartment, HrDepartmentList }

export const hrDepartmentKeys = {
  list: ['hr', 'departments'] as const,
}

export type HrDepartmentWrite = {
  name?: string
  parent_id?: number | null
  manager_id?: number | null
}

function replaceDepartmentInList(list: HrDepartmentList | undefined, dept: HrDepartment, insert: boolean): HrDepartmentList {
  if (!list) return { items: [dept], total: 1 }
  const idx = list.items.findIndex((d) => d.id === dept.id)
  if (idx === -1) {
    if (!insert) return list
    return { items: [...list.items, dept], total: list.total + 1 }
  }
  const items = list.items.slice()
  items[idx] = dept
  return { ...list, items }
}

export function useHrDepartments() {
  const { $api } = useApi()
  return useQuery({
    queryKey: hrDepartmentKeys.list,
    queryFn: () => $api('/api/v1/hr/departments', { query: { limit: 200 }, schema: HrDepartmentListSchema }),
  })
}

export function useCreateDepartment() {
  const qc = useQueryClient()
  const { $api } = useApi()
  return useMutation({
    mutationFn: (body: { name: string; parent_id?: number | null; manager_id?: number | null }) =>
      $api('/api/v1/hr/departments', { method: 'POST', body, schema: HrDepartmentSchema }),
    onSuccess: (dept) => {
      const prev = qc.getQueryData<HrDepartmentList>(hrDepartmentKeys.list)
      qc.setQueryData(hrDepartmentKeys.list, replaceDepartmentInList(prev, dept, true))
    },
  })
}

export function useUpdateDepartment() {
  const qc = useQueryClient()
  const { $api } = useApi()
  return useMutation({
    mutationFn: ({ id, patch }: { id: number; patch: HrDepartmentWrite }) =>
      $api(`/api/v1/hr/departments/${id}`, { method: 'PATCH', body: patch, schema: HrDepartmentSchema }),
    onSuccess: (dept) => {
      const prev = qc.getQueryData<HrDepartmentList>(hrDepartmentKeys.list)
      qc.setQueryData(hrDepartmentKeys.list, replaceDepartmentInList(prev, dept, false))
    },
  })
}
