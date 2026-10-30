import { computed } from 'vue'
import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/vue-query'
import {
  HrGosiRateListSchema,
  HrGosiRateSchema,
  HrPayrollRevisionSchema,
  HrPayrollSettingsSchema,
  type HrGosiRatePatch,
  type HrGosiRateWrite,
  type HrPayrollSettingsPatch,
} from '@liwan/contracts'
import { hrPayrollKeys } from './useHrPayrollCompensation'

type Api = ReturnType<typeof useApi>['$api']

const SETTINGS_PATH = '/api/v1/hr/payroll/settings'
const RATES_PATH = '/api/v1/hr/payroll/gosi-rates'

/** The PATCH answers with the full settings: they replace the cached ones. */
export async function patchHrPayrollSettings($api: Api, qc: QueryClient, body: HrPayrollSettingsPatch) {
  const settings = await $api(SETTINGS_PATH, { method: 'PATCH', body, schema: HrPayrollSettingsSchema })
  qc.setQueryData(hrPayrollKeys.settings, settings)
  return settings
}

export type HrGosiRateSave = { id?: undefined; body: HrGosiRateWrite } | { id: number; body: HrGosiRatePatch }

/** Without an id the rate is created (every field), with one it is patched (the changed fields and the revision read). */
export async function saveHrGosiRate($api: Api, qc: QueryClient, { id, body }: HrGosiRateSave) {
  const rate = id === undefined
    ? await $api(RATES_PATH, { method: 'POST', body, schema: HrGosiRateSchema })
    : await $api(`${RATES_PATH}/${id}`, { method: 'PATCH', body, schema: HrGosiRateSchema })
  void qc.invalidateQueries({ queryKey: hrPayrollKeys.gosiRates })
  return rate
}

/** The DELETE carries the revision the caller read: a rate changed since answers 409. */
export async function deleteHrGosiRate($api: Api, qc: QueryClient, { id, revision }: { id: number; revision: number }) {
  await $api(`${RATES_PATH}/${id}`, { method: 'DELETE', body: HrPayrollRevisionSchema.parse({ revision }) })
  void qc.invalidateQueries({ queryKey: hrPayrollKeys.gosiRates })
}

export function useHrPayrollSettings() {
  const { $api } = useApi()
  const { can } = useAccess()
  return useQuery({
    queryKey: hrPayrollKeys.settings,
    enabled: computed(() => can('hr.payroll.read')),
    queryFn: () => $api(SETTINGS_PATH, { schema: HrPayrollSettingsSchema }),
  })
}

export function usePatchHrPayrollSettings() {
  const qc = useQueryClient()
  const { $api } = useApi()
  return useMutation({ mutationFn: (body: HrPayrollSettingsPatch) => patchHrPayrollSettings($api, qc, body) })
}

export function useHrGosiRates() {
  const { $api } = useApi()
  const { can } = useAccess()
  return useQuery({
    queryKey: hrPayrollKeys.gosiRates,
    enabled: computed(() => can('hr.payroll.read')),
    queryFn: () => $api(RATES_PATH, { schema: HrGosiRateListSchema }),
  })
}

export function useSaveHrGosiRate() {
  const qc = useQueryClient()
  const { $api } = useApi()
  return useMutation({ mutationFn: (input: HrGosiRateSave) => saveHrGosiRate($api, qc, input) })
}

export function useDeleteHrGosiRate() {
  const qc = useQueryClient()
  const { $api } = useApi()
  return useMutation({ mutationFn: (input: { id: number; revision: number }) => deleteHrGosiRate($api, qc, input) })
}
