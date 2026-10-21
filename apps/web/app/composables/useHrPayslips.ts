import type { MaybeRefOrGetter } from 'vue'
import { computed, toValue } from 'vue'
import { useQuery } from '@tanstack/vue-query'
import { HrMyPayslipListSchema, HrPayslipSchema } from '@webvue/contracts'

type Api = ReturnType<typeof useApi>['$api']

const MINE_PATH = '/api/v1/hr/payroll/payslips/mine'

/** The caller's own approved payslips, kept apart from the run-scoped payslips of the payroll area. */
export const hrMyPayslipKeys = {
  list: ['hr', 'payroll', 'payslips', 'mine'] as const,
  one: (payslipId: number) => ['hr', 'payroll', 'payslips', 'mine', payslipId] as const,
}

export function fetchMyHrPayslips($api: Api) {
  return $api(MINE_PATH, { schema: HrMyPayslipListSchema })
}

export function fetchMyHrPayslip($api: Api, payslipId: number) {
  return $api(`${MINE_PATH}/${payslipId}`, { schema: HrPayslipSchema })
}

/** Gated by the employee read capability, not the payroll one: every employee reads their own approved payslips. */
export function useMyHrPayslips() {
  const { $api } = useApi()
  const { can } = useAccess()
  return useQuery({
    queryKey: hrMyPayslipKeys.list,
    enabled: computed(() => can('hr.employees.read')),
    queryFn: () => fetchMyHrPayslips($api),
  })
}

export function useMyHrPayslip(payslipId: MaybeRefOrGetter<number | null>) {
  const { $api } = useApi()
  const { can } = useAccess()
  return useQuery({
    queryKey: computed(() => hrMyPayslipKeys.one(toValue(payslipId) ?? 0)),
    enabled: computed(() => can('hr.employees.read') && !!toValue(payslipId)),
    queryFn: () => fetchMyHrPayslip($api, toValue(payslipId) as number),
  })
}
