import type { MaybeRefOrGetter } from 'vue'
import { computed, toValue } from 'vue'
import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/vue-query'
import { HrCompensationSchema, type HrCompensation, type HrCompensationWrite, type HrPayrollRelationship } from '@liwan/contracts'
import { ApiError } from './useApi'

type Api = ReturnType<typeof useApi>['$api']

export const hrPayrollKeys = {
  all: ['hr', 'payroll'] as const,
  compensation: (employeeId: number) => ['hr', 'payroll', 'compensation', employeeId] as const,
  runs: ['hr', 'payroll', 'runs'] as const,
  runLists: ['hr', 'payroll', 'runs', 'list'] as const,
  runList: (query: object) => ['hr', 'payroll', 'runs', 'list', query] as const,
  run: (runId: number) => ['hr', 'payroll', 'runs', 'detail', runId] as const,
  payslipsOf: (runId: number) => ['hr', 'payroll', 'runs', runId, 'payslips'] as const,
  payslips: (runId: number, query: object) => ['hr', 'payroll', 'runs', runId, 'payslips', query] as const,
  payslip: (runId: number, payslipId: number) => ['hr', 'payroll', 'runs', runId, 'payslip', payslipId] as const,
  settings: ['hr', 'payroll', 'settings'] as const,
  gosiRates: ['hr', 'payroll', 'gosi-rates'] as const,
  bankProfiles: ['hr', 'payroll', 'bank-profiles'] as const,
  gosiStatement: (runId: number) => ['hr', 'payroll', 'runs', runId, 'gosi-statement'] as const,
  financeSettings: ['hr', 'payroll', 'finance-settings'] as const,
  costCenters: ['hr', 'payroll', 'cost-centers'] as const,
  postingPreview: (runId: number) => ['hr', 'payroll', 'runs', runId, 'posting-preview'] as const,
  settlement: (employeeId: number) => ['hr', 'payroll', 'settlement', employeeId] as const,
  eosEstimate: (employeeId: number, params: object) => ['hr', 'payroll', 'eos-estimate', employeeId, params] as const,
  eosCases: ['hr', 'payroll', 'eos-cases'] as const,
  eosProvisions: ['hr', 'payroll', 'eos-provisions'] as const,
  financeLookup: (kind: string) => ['hr', 'payroll', 'finance-lookup', kind] as const,
}

const compensationPath = (employeeId: number) => `/api/v1/hr/payroll/compensation/${employeeId}`

/** An employee without a compensation record answers 404: that is "nothing recorded yet", not an error. */
export async function fetchHrCompensation($api: Api, employeeId: number): Promise<HrCompensation | null> {
  try {
    return await $api(compensationPath(employeeId), { schema: HrCompensationSchema })
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) return null
    throw error
  }
}

/** The PUT answers with the full record: it replaces the cached one. */
export async function saveHrCompensation($api: Api, qc: QueryClient, employeeId: number, body: HrCompensationWrite) {
  const record = await $api(compensationPath(employeeId), { method: 'PUT', body, schema: HrCompensationSchema })
  qc.setQueryData(hrPayrollKeys.compensation(employeeId), record)
  return record
}

/** Fetched only for a viewer with `hr.payroll.read` (the capability already carries the `hr.payroll` sub-feature gate). */
export function useHrCompensation(employeeId: MaybeRefOrGetter<number>) {
  const { $api } = useApi()
  const { can } = useAccess()
  return useQuery({
    queryKey: computed(() => hrPayrollKeys.compensation(toValue(employeeId))),
    enabled: computed(() => can('hr.payroll.read') && Number.isSafeInteger(toValue(employeeId)) && toValue(employeeId) > 0),
    queryFn: () => fetchHrCompensation($api, toValue(employeeId)),
  })
}

export function useSaveHrCompensation(employeeId: MaybeRefOrGetter<number>) {
  const qc = useQueryClient()
  const { $api } = useApi()
  return useMutation({ mutationFn: (body: HrCompensationWrite) => saveHrCompensation($api, qc, toValue(employeeId), body) })
}

/** The relationship types the customer may choose for a compensation, labelled in the active locale. */
export function usePayrollRelationshipItems() {
  const { t } = useI18n()
  return computed<{ value: HrPayrollRelationship, label: string }[]>(() => [
    { value: 'employee', label: t('hrPayroll.compensation.relationshipEmployee') },
    { value: 'independent_contractor', label: t('hrPayroll.compensation.relationshipIndependentContractor') },
    { value: 'consultant', label: t('hrPayroll.compensation.relationshipConsultant') },
    { value: 'other_cooperation', label: t('hrPayroll.compensation.relationshipOtherCooperation') },
  ])
}
