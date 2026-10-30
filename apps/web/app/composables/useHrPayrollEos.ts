import type { MaybeRefOrGetter } from 'vue'
import { computed, toValue } from 'vue'
import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/vue-query'
import {
  HrEosCaseMapListSchema,
  HrEosCaseMapSchema,
  HrEosEstimateSchema,
  HrEosProvisionListSchema,
  HrEosProvisionSchema,
  HrSettlementSchema,
  type HrEosCase,
  type HrEosCaseMapWrite,
  type HrSettlement,
  type HrSettlementWrite,
} from '@liwan/contracts'
import { ApiError } from './useApi'
import { hrPayrollKeys } from './useHrPayrollCompensation'

type Api = ReturnType<typeof useApi>['$api']

const EOS_PATH = '/api/v1/hr/payroll/eos'
const CASES_PATH = '/api/v1/hr/payroll/eos-cases'
const PROVISIONS_PATH = '/api/v1/hr/payroll/eos-provisions'
const settlementPath = (employeeId: number) => `${EOS_PATH}/${employeeId}/settlement`

export interface HrEosEstimateParams {
  date: string
  case?: HrEosCase
}

export function fetchHrEosEstimate($api: Api, employeeId: number, params: HrEosEstimateParams) {
  return $api(`${EOS_PATH}/${employeeId}/estimate`, { query: { date: params.date, case: params.case }, schema: HrEosEstimateSchema })
}

/** An employee without a settlement answers 404: that is "nothing recorded yet", not an error. */
export async function fetchHrSettlement($api: Api, employeeId: number): Promise<HrSettlement | null> {
  try {
    return await $api(settlementPath(employeeId), { schema: HrSettlementSchema })
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) return null
    throw error
  }
}

/** Both writes answer with the full settlement and replace the cached one only after the server has answered. */
export async function saveHrSettlement($api: Api, qc: QueryClient, employeeId: number, body: HrSettlementWrite) {
  const settlement = await $api(settlementPath(employeeId), { method: 'PUT', body, schema: HrSettlementSchema })
  qc.setQueryData(hrPayrollKeys.settlement(employeeId), settlement)
  return settlement
}

export async function confirmHrSettlement($api: Api, qc: QueryClient, employeeId: number) {
  const settlement = await $api(`${settlementPath(employeeId)}/confirm`, { method: 'POST', body: {}, schema: HrSettlementSchema })
  qc.setQueryData(hrPayrollKeys.settlement(employeeId), settlement)
  return settlement
}

export async function saveHrEosCase($api: Api, qc: QueryClient, body: HrEosCaseMapWrite) {
  const mapping = await $api(CASES_PATH, { method: 'PUT', body, schema: HrEosCaseMapSchema })
  void qc.invalidateQueries({ queryKey: hrPayrollKeys.eosCases })
  return mapping
}

/** The provision answers with its item; the provisions list and every cached run (their allowed actions) are refetched. */
export async function postHrEosProvision($api: Api, qc: QueryClient, month: string) {
  const item = await $api(PROVISIONS_PATH, { method: 'POST', body: { month }, schema: HrEosProvisionSchema })
  void qc.invalidateQueries({ queryKey: hrPayrollKeys.eosProvisions })
  void qc.invalidateQueries({ queryKey: hrPayrollKeys.runs })
  return item
}

const validId = (id: number) => Number.isSafeInteger(id) && id > 0

/** The award figures for a leaving date and case; asked for only while `enabled` holds. */
export function useHrEosEstimate(employeeId: MaybeRefOrGetter<number>, params: MaybeRefOrGetter<HrEosEstimateParams | null>) {
  const { $api } = useApi()
  const { can } = useAccess()
  return useQuery({
    queryKey: computed(() => hrPayrollKeys.eosEstimate(toValue(employeeId), toValue(params) ?? {})),
    enabled: computed(() => can('hr.payroll.read') && validId(toValue(employeeId)) && toValue(params) !== null),
    retry: false,
    queryFn: () => fetchHrEosEstimate($api, toValue(employeeId), toValue(params) as HrEosEstimateParams),
  })
}

export function useHrSettlement(employeeId: MaybeRefOrGetter<number>) {
  const { $api } = useApi()
  const { can } = useAccess()
  return useQuery({
    queryKey: computed(() => hrPayrollKeys.settlement(toValue(employeeId))),
    enabled: computed(() => can('hr.payroll.read') && validId(toValue(employeeId))),
    queryFn: () => fetchHrSettlement($api, toValue(employeeId)),
  })
}

export function useSaveHrSettlement(employeeId: MaybeRefOrGetter<number>) {
  const qc = useQueryClient()
  const { $api } = useApi()
  return useMutation({ mutationFn: (body: HrSettlementWrite) => saveHrSettlement($api, qc, toValue(employeeId), body) })
}

export function useConfirmHrSettlement(employeeId: MaybeRefOrGetter<number>) {
  const qc = useQueryClient()
  const { $api } = useApi()
  return useMutation({ mutationFn: () => confirmHrSettlement($api, qc, toValue(employeeId)) })
}

export function useHrEosCases() {
  const { $api } = useApi()
  const { can } = useAccess()
  return useQuery({
    queryKey: hrPayrollKeys.eosCases,
    enabled: computed(() => can('hr.payroll.read')),
    queryFn: () => $api(CASES_PATH, { schema: HrEosCaseMapListSchema }),
  })
}

export function useSaveHrEosCase() {
  const qc = useQueryClient()
  const { $api } = useApi()
  return useMutation({ mutationFn: (body: HrEosCaseMapWrite) => saveHrEosCase($api, qc, body) })
}

/** The posted provisions; a 404 or 403 (bridge absent, or no finance access) is not retried. */
export function useHrEosProvisions(enabled: MaybeRefOrGetter<boolean> = true) {
  const { $api } = useApi()
  const { can } = useAccess()
  return useQuery({
    queryKey: hrPayrollKeys.eosProvisions,
    enabled: computed(() => toValue(enabled) && can('hr.payroll.read')),
    retry: false,
    queryFn: () => $api(PROVISIONS_PATH, { schema: HrEosProvisionListSchema }),
  })
}

export function usePostHrEosProvision() {
  const qc = useQueryClient()
  const { $api } = useApi()
  return useMutation({ mutationFn: (month: string) => postHrEosProvision($api, qc, month) })
}
