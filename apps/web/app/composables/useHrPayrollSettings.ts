import { computed } from 'vue'
import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/vue-query'
import {
  HrGosiRateListSchema,
  HrGosiRateSchema,
  HrPayrollSettingsSchema,
  type HrGosiRateWrite,
  type HrPayrollSettingsPatch,
} from '@webvue/contracts'
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

/** Without an id the rate is created (every field), with one it is patched (the changed fields). */
export async function saveHrGosiRate($api: Api, qc: QueryClient, { id, body }: { id?: number; body: Partial<HrGosiRateWrite> }) {
  const rate = id === undefined
    ? await $api(RATES_PATH, { method: 'POST', body, schema: HrGosiRateSchema })
    : await $api(`${RATES_PATH}/${id}`, { method: 'PATCH', body, schema: HrGosiRateSchema })
  void qc.invalidateQueries({ queryKey: hrPayrollKeys.gosiRates })
  return rate
}

export async function deleteHrGosiRate($api: Api, qc: QueryClient, id: number) {
  await $api(`${RATES_PATH}/${id}`, { method: 'DELETE' })
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
  return useMutation({ mutationFn: (input: { id?: number; body: Partial<HrGosiRateWrite> }) => saveHrGosiRate($api, qc, input) })
}

export function useDeleteHrGosiRate() {
  const qc = useQueryClient()
  const { $api } = useApi()
  return useMutation({ mutationFn: (id: number) => deleteHrGosiRate($api, qc, id) })
}
