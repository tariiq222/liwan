import type { MaybeRefOrGetter } from 'vue'
import { computed, toValue } from 'vue'
import { useQuery } from '@tanstack/vue-query'
import {
  HrEmployeeListSchema,
  HrEmployeeSchema,
  type HrEmployee,
  type HrEmployeeList,
} from '../../../../packages/contracts/src/hr'

export type { HrEmployee, HrEmployeeList }

export type HrEmployeeListParams = {
  q?: string
  department_id?: number
}

export const hrEmployeeKeys = {
  list: (params: HrEmployeeListParams) => ['hr', 'employees', params] as const,
  detail: (id: number) => ['hr', 'employee', id] as const,
}

export function useHrEmployees(params: MaybeRefOrGetter<HrEmployeeListParams> = {}) {
  const { $api } = useApi()
  return useQuery({
    queryKey: computed(() => hrEmployeeKeys.list(toValue(params))),
    queryFn: () => {
      const p = toValue(params)
      return $api('/api/v1/hr/employees', {
        query: {
          q: p.q || undefined,
          department_id: p.department_id,
          limit: 200,
        },
        schema: HrEmployeeListSchema,
      })
    },
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
