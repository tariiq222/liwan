import type { MaybeRefOrGetter } from 'vue'
import { computed, toValue } from 'vue'
import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/vue-query'
import {
  FinanceAccountListSchema,
  FinanceAnalyticAccountListSchema,
  FinanceJournalListSchema,
  HrPayrollCostCenterListSchema,
  HrPayrollCostCenterSchema,
  HrPayrollFinanceSettingsSchema,
  HrPayrollPostingPreviewSchema,
  HrPayrollRunSchema,
  type HrPayrollFinanceSettingsPatch,
  type HrPayrollPaymentCreate,
} from '@webvue/contracts'
import { hrPayrollKeys } from './useHrPayrollCompensation'
import { replaceRun } from './useHrPayrollRuns'

type Api = ReturnType<typeof useApi>['$api']

const PAYROLL_PATH = '/api/v1/hr/payroll'
const SETTINGS_PATH = `${PAYROLL_PATH}/finance-settings`
const CENTERS_PATH = `${PAYROLL_PATH}/cost-centers`
/** The most a lookup list asks for (the server's page cap). */
const LOOKUP_LIMIT = 200

export function fetchHrPayrollPostingPreview($api: Api, runId: number) {
  return $api(`${PAYROLL_PATH}/runs/${runId}/posting-preview`, { schema: HrPayrollPostingPreviewSchema })
}

/** Post and payment answer with the full run; nothing changes in the cache before the server answers. */
export async function postHrPayrollRun($api: Api, qc: QueryClient, runId: number) {
  const run = await $api(`${PAYROLL_PATH}/runs/${runId}/post`, { method: 'POST', body: {}, schema: HrPayrollRunSchema })
  replaceRun(qc, run)
  return run
}

export async function recordHrPayrollPayment($api: Api, qc: QueryClient, runId: number, body: HrPayrollPaymentCreate) {
  const run = await $api(`${PAYROLL_PATH}/runs/${runId}/payment`, { method: 'POST', body, schema: HrPayrollRunSchema })
  replaceRun(qc, run)
  return run
}

export async function patchHrPayrollFinanceSettings($api: Api, qc: QueryClient, body: HrPayrollFinanceSettingsPatch) {
  const settings = await $api(SETTINGS_PATH, { method: 'PATCH', body, schema: HrPayrollFinanceSettingsSchema })
  qc.setQueryData(hrPayrollKeys.financeSettings, settings)
  return settings
}

export async function setHrPayrollCostCenter($api: Api, qc: QueryClient, departmentId: number, analyticAccountId: number | null) {
  const center = await $api(`${CENTERS_PATH}/${departmentId}`, { method: 'PUT', body: { analytic_account_id: analyticAccountId }, schema: HrPayrollCostCenterSchema })
  void qc.invalidateQueries({ queryKey: hrPayrollKeys.costCenters })
  return center
}

/**
 * The finance mapping of payroll. A 404 or 403 (bridge absent, or no finance access) is the answer the page reads as
 * "no finance section", so it is not retried.
 */
export function useHrPayrollFinanceSettings() {
  const { $api } = useApi()
  const { can } = useAccess()
  return useQuery({
    queryKey: hrPayrollKeys.financeSettings,
    enabled: computed(() => can('hr.payroll.read')),
    retry: false,
    queryFn: () => $api(SETTINGS_PATH, { schema: HrPayrollFinanceSettingsSchema }),
  })
}

export function usePatchHrPayrollFinanceSettings() {
  const qc = useQueryClient()
  const { $api } = useApi()
  return useMutation({ mutationFn: (body: HrPayrollFinanceSettingsPatch) => patchHrPayrollFinanceSettings($api, qc, body) })
}

export function useHrPayrollCostCenters(enabled: MaybeRefOrGetter<boolean>) {
  const { $api } = useApi()
  return useQuery({
    queryKey: hrPayrollKeys.costCenters,
    enabled: computed(() => toValue(enabled)),
    retry: false,
    queryFn: () => $api(CENTERS_PATH, { schema: HrPayrollCostCenterListSchema }),
  })
}

export function useSetHrPayrollCostCenter() {
  const qc = useQueryClient()
  const { $api } = useApi()
  return useMutation({
    mutationFn: ({ departmentId, analyticAccountId }: { departmentId: number; analyticAccountId: number | null }) =>
      setHrPayrollCostCenter($api, qc, departmentId, analyticAccountId),
  })
}

/** The posting preview of an approved run; asked for only while `enabled` holds (the page shows it). */
export function useHrPayrollPostingPreview(runId: MaybeRefOrGetter<number>, enabled: MaybeRefOrGetter<boolean>) {
  const { $api } = useApi()
  return useQuery({
    queryKey: computed(() => hrPayrollKeys.postingPreview(toValue(runId))),
    enabled: computed(() => toValue(enabled)),
    gcTime: 0,
    retry: false,
    queryFn: () => fetchHrPayrollPostingPreview($api, toValue(runId)),
  })
}

export function usePostHrPayrollRun(runId: MaybeRefOrGetter<number>) {
  const qc = useQueryClient()
  const { $api } = useApi()
  return useMutation({ mutationFn: () => postHrPayrollRun($api, qc, toValue(runId)) })
}

export function useRecordHrPayrollPayment(runId: MaybeRefOrGetter<number>) {
  const qc = useQueryClient()
  const { $api } = useApi()
  return useMutation({ mutationFn: (body: HrPayrollPaymentCreate) => recordHrPayrollPayment($api, qc, toValue(runId), body) })
}

/** A finance list for the mapping pickers: asked for only when `enabled` holds and the finance read capability is granted. */
function useFinanceLookup<T>(kind: string, capability: string, enabled: MaybeRefOrGetter<boolean>, fetchList: () => Promise<T>) {
  const { can } = useAccess()
  return useQuery({
    queryKey: hrPayrollKeys.financeLookup(kind),
    enabled: computed(() => toValue(enabled) && can(capability)),
    retry: false,
    queryFn: fetchList,
  })
}

const lookupQuery = { limit: LOOKUP_LIMIT }

function useAccountsLookup(enabled: MaybeRefOrGetter<boolean>) {
  const { $api } = useApi()
  return useFinanceLookup('accounts', 'finance.accounts.read', enabled, () => $api('/api/v1/finance/accounts', { query: lookupQuery, schema: FinanceAccountListSchema }))
}

/** The journals of one type; the server filters by a single type, so each type is its own list. */
function useJournalsLookup(type: 'general' | 'bank' | 'cash', enabled: MaybeRefOrGetter<boolean>) {
  const { $api } = useApi()
  return useFinanceLookup(`journals-${type}`, 'finance.journals.read', enabled, () => $api('/api/v1/finance/journals', { query: { ...lookupQuery, type }, schema: FinanceJournalListSchema }))
}

function useAnalyticAccountsLookup(enabled: MaybeRefOrGetter<boolean>) {
  const { $api } = useApi()
  return useFinanceLookup('analytic-accounts', 'finance.analytic.read', enabled, () => $api('/api/v1/finance/analytic-accounts', { query: lookupQuery, schema: FinanceAnalyticAccountListSchema }))
}

/**
 * The accounts and general journals the mapping form picks from, and the analytic accounts both forms pick from, read
 * through the generic finance lookup routes (one page each: a list with more records than the page is flagged by the
 * callers through its `total`). Without the read capability a list stays unasked and the form shows the current value
 * read-only.
 */
export function useHrPayrollFinanceLookups(wanted: { mapping: MaybeRefOrGetter<boolean>; analytic: MaybeRefOrGetter<boolean> }) {
  return {
    accounts: useAccountsLookup(wanted.mapping),
    journals: useJournalsLookup('general', wanted.mapping),
    analyticAccounts: useAnalyticAccountsLookup(wanted.analytic),
  }
}

/** The bank and cash journals the payment is made from. */
export function usePaymentJournals(enabled: MaybeRefOrGetter<boolean>) {
  const banks = useJournalsLookup('bank', enabled)
  const cash = useJournalsLookup('cash', enabled)
  return computed(() => [...(banks.data.value?.items ?? []), ...(cash.data.value?.items ?? [])])
}
