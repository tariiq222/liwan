import type { MaybeRefOrGetter } from 'vue'
import { computed, toValue } from 'vue'
import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/vue-query'
import {
  HrBankProfileListSchema,
  HrBankProfileSchema,
  HrGosiStatementSchema,
  HrPayrollRevisionSchema,
  type HrBankProfilePatch,
  type HrBankProfileWrite,
} from '@webvue/contracts'
import { hrPayrollKeys } from './useHrPayrollCompensation'

type Api = ReturnType<typeof useApi>['$api']

const PAYROLL_PATH = '/api/v1/hr/payroll'
const PROFILES_PATH = `${PAYROLL_PATH}/bank-profiles`
const FILE_ROUTES = { bank: 'bank-file', wps: 'wps-file' } as const

/** The route of the bank or WPS file of a fixed run; the value date is the bank file's only. */
export function hrPayrollFileUrl(runId: number, kind: 'bank' | 'wps', params: { profileId: number; valueDate?: string }): string {
  const query = new URLSearchParams({ profile_id: String(params.profileId) })
  if (params.valueDate) query.set('value_date', params.valueDate)
  return `${PAYROLL_PATH}/runs/${runId}/${FILE_ROUTES[kind]}?${query}`
}

export type HrBankProfileSave = { id?: undefined; body: HrBankProfileWrite } | { id: number; body: HrBankProfilePatch }

/** Without an id the profile is created (every field), with one it is patched (the fields sent and the revision read). */
export async function saveHrBankProfile($api: Api, qc: QueryClient, { id, body }: HrBankProfileSave) {
  const profile = id === undefined
    ? await $api(PROFILES_PATH, { method: 'POST', body, schema: HrBankProfileSchema })
    : await $api(`${PROFILES_PATH}/${id}`, { method: 'PATCH', body, schema: HrBankProfileSchema })
  void qc.invalidateQueries({ queryKey: hrPayrollKeys.bankProfiles })
  return profile
}

/** The DELETE carries the revision the caller read: a profile changed since answers 409. */
export async function deleteHrBankProfile($api: Api, qc: QueryClient, { id, revision }: { id: number; revision: number }) {
  await $api(`${PROFILES_PATH}/${id}`, { method: 'DELETE', body: HrPayrollRevisionSchema.parse({ revision }) })
  void qc.invalidateQueries({ queryKey: hrPayrollKeys.bankProfiles })
}

export function useHrGosiStatement(runId: MaybeRefOrGetter<number | null>) {
  const { $api } = useApi()
  const { can } = useAccess()
  return useQuery({
    queryKey: computed(() => hrPayrollKeys.gosiStatement(toValue(runId) ?? 0)),
    enabled: computed(() => toValue(runId) !== null && can('hr.payroll.read')),
    retry: false,
    queryFn: () => $api(`${PAYROLL_PATH}/runs/${toValue(runId)}/gosi-statement`, { schema: HrGosiStatementSchema }),
  })
}

/** The bank and WPS profiles; asked for only while `enabled` holds (the page shows a place that offers them). */
export function useHrBankProfiles(enabled: MaybeRefOrGetter<boolean> = true) {
  const { $api } = useApi()
  const { can } = useAccess()
  return useQuery({
    queryKey: hrPayrollKeys.bankProfiles,
    enabled: computed(() => toValue(enabled) && can('hr.payroll.read')),
    queryFn: () => $api(PROFILES_PATH, { schema: HrBankProfileListSchema }),
  })
}

export function useSaveHrBankProfile() {
  const qc = useQueryClient()
  const { $api } = useApi()
  return useMutation({ mutationFn: (input: HrBankProfileSave) => saveHrBankProfile($api, qc, input) })
}

export function useDeleteHrBankProfile() {
  const qc = useQueryClient()
  const { $api } = useApi()
  return useMutation({ mutationFn: (input: { id: number; revision: number }) => deleteHrBankProfile($api, qc, input) })
}
