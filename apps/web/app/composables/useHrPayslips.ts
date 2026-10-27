import { useHrOwnIdentity } from './useHrOwnIdentity'
import type { MaybeRefOrGetter } from 'vue'
import { computed, toValue } from 'vue'
import { useQuery } from '@tanstack/vue-query'
import { HrMyPayslipListSchema, HrPayslipSchema } from '@webvue/contracts'

type Api = ReturnType<typeof useApi>['$api']

const MINE_PATH = '/api/v1/hr/payroll/payslips/mine'

/** One page of the caller's own payslips. */
export interface HrMyPayslipPage {
  limit: number
  offset: number
}

/** The caller's own approved payslips, kept apart from the run-scoped payslips of the payroll area. */
export const hrMyPayslipKeys = {
  page: (params: HrMyPayslipPage) => ['hr', 'payroll', 'payslips', 'mine', 'page', params] as const,
  one: (payslipId: number) => ['hr', 'payroll', 'payslips', 'mine', payslipId] as const,
}

export function fetchMyHrPayslips($api: Api, page: HrMyPayslipPage) {
  return $api(MINE_PATH, { query: { ...page }, schema: HrMyPayslipListSchema })
}

export function fetchMyHrPayslip($api: Api, payslipId: number) {
  return $api(`${MINE_PATH}/${payslipId}`, { schema: HrPayslipSchema })
}

/** Gated by the employee read capability, not the payroll one: every employee reads their own approved payslips. */
export function useMyHrPayslips(page: MaybeRefOrGetter<HrMyPayslipPage>) {
  const { $api } = useApi()
  const { can } = useAccess()
  const identity = useHrOwnIdentity()
  return useQuery({
    queryKey: computed(() => [...hrMyPayslipKeys.page(toValue(page)), identity.scope.value]),
    enabled: computed(() => identity.ready.value && can('hr.employees.read')),
    queryFn: () => fetchMyHrPayslips($api, toValue(page)),
    placeholderData: previous => previous,
  })
}

export function useMyHrPayslip(payslipId: MaybeRefOrGetter<number | null>) {
  const { $api } = useApi()
  const { can } = useAccess()
  const identity = useHrOwnIdentity()
  return useQuery({
    queryKey: computed(() => [...hrMyPayslipKeys.one(toValue(payslipId) ?? 0), identity.scope.value]),
    enabled: computed(() => identity.ready.value && can('hr.employees.read') && !!toValue(payslipId)),
    queryFn: () => fetchMyHrPayslip($api, toValue(payslipId) as number),
  })
}
