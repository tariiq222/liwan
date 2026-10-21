import type { MaybeRefOrGetter } from 'vue'
import { computed, toValue } from 'vue'
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/vue-query'
import type { z } from 'zod'
import {
  FinanceAssetProfileListSchema,
  FinanceAssetProfileSchema,
  FinanceAccountListSchema,
  FinanceAccountSchema,
  FinanceJournalListSchema,
  FinanceJournalSchema,
  FinancePaymentTermListSchema,
  FinancePaymentTermSchema,
  FinanceTaxListSchema,
  FinanceTaxSchema,
  type FinanceAssetProfileCreate,
  type FinanceAssetProfilePatch,
  type FinanceAccountCreate,
  type FinanceAccountPatch,
  type FinanceJournalCreate,
  type FinanceJournalPatch,
  type FinancePaymentTermCreate,
  type FinancePaymentTermPatch,
  type FinanceTaxCreate,
  type FinanceTaxPatch,
} from '@webvue/contracts'
import type { RecordParams } from '@/components/finance/records/recordParams'

// The setup records of a company: accounts, journals, taxes, payment terms and asset profiles. Each has a list (with an archived switch), a create,
// a patch and an archive/unarchive; a write waits for the server and the lists refresh from the answer.
export type SetupResource = 'accounts' | 'journals' | 'taxes' | 'payment-terms' | 'asset-profiles'

const PATHS: Record<SetupResource, string> = {
  accounts: '/api/v1/finance/accounts',
  journals: '/api/v1/finance/journals',
  taxes: '/api/v1/finance/taxes',
  'payment-terms': '/api/v1/finance/payment-terms',
  'asset-profiles': '/api/v1/finance/asset-profiles',
}

export const financeRecordKeys = {
  list: (resource: SetupResource, params: RecordParams) => ['finance', 'records', resource, params] as const,
  resource: (resource: SetupResource) => ['finance', 'records', resource] as const,
}

function useList<T>(resource: SetupResource, schema: z.ZodType<T>, params: MaybeRefOrGetter<RecordParams>, enabled: MaybeRefOrGetter<boolean>) {
  const { $api } = useApi()
  return useQuery({
    queryKey: computed(() => financeRecordKeys.list(resource, toValue(params))),
    enabled: computed(() => toValue(enabled)),
    placeholderData: keepPreviousData,
    queryFn: () => $api(PATHS[resource], { query: { ...toValue(params) }, schema }),
  })
}

function useWrite<T, I>(resource: SetupResource, request: (input: I) => (path: string) => { method: 'POST' | 'PATCH'; path: string; body?: unknown }, schema: z.ZodType<T>) {
  const { $api } = useApi()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: I) => {
      const { method, path, body } = request(input)(PATHS[resource])
      return $api(path, { method, ...(body === undefined ? {} : { body }), schema })
    },
    // Pickers elsewhere read the same lists (accounts, journals, taxes), so every finance query that names the resource refreshes.
    onSuccess: () => Promise.all([
      qc.invalidateQueries({ queryKey: financeRecordKeys.resource(resource) }),
      qc.invalidateQueries({ queryKey: ['finance', resource === 'payment-terms' ? 'paymentTerms' : resource] }),
    ]),
  })
}

const create = <B>() => (body: B) => (base: string) => ({ method: 'POST' as const, path: base, body })
const patch = <B>() => ({ id, patch: body }: { id: number; patch: B }) => (base: string) => ({ method: 'PATCH' as const, path: `${base}/${id}`, body })
const archive = () => ({ id, archive: on }: { id: number; archive: boolean }) => (base: string) => ({ method: 'POST' as const, path: `${base}/${id}/${on ? 'archive' : 'unarchive'}` })

export const useSetupAccounts = (params: MaybeRefOrGetter<RecordParams>, enabled: MaybeRefOrGetter<boolean> = true) => useList('accounts', FinanceAccountListSchema, params, enabled)
export const useCreateSetupAccount = () => useWrite('accounts', create<FinanceAccountCreate>(), FinanceAccountSchema)
export const usePatchSetupAccount = () => useWrite('accounts', patch<FinanceAccountPatch>(), FinanceAccountSchema)
export const useArchiveSetupAccount = () => useWrite('accounts', archive(), FinanceAccountSchema)

export const useSetupJournals = (params: MaybeRefOrGetter<RecordParams>, enabled: MaybeRefOrGetter<boolean> = true) => useList('journals', FinanceJournalListSchema, params, enabled)
export const useCreateSetupJournal = () => useWrite('journals', create<FinanceJournalCreate>(), FinanceJournalSchema)
export const usePatchSetupJournal = () => useWrite('journals', patch<FinanceJournalPatch>(), FinanceJournalSchema)
export const useArchiveSetupJournal = () => useWrite('journals', archive(), FinanceJournalSchema)

export const useSetupTaxes = (params: MaybeRefOrGetter<RecordParams>, enabled: MaybeRefOrGetter<boolean> = true) => useList('taxes', FinanceTaxListSchema, params, enabled)
export const useCreateSetupTax = () => useWrite('taxes', create<FinanceTaxCreate>(), FinanceTaxSchema)
export const usePatchSetupTax = () => useWrite('taxes', patch<FinanceTaxPatch>(), FinanceTaxSchema)
export const useArchiveSetupTax = () => useWrite('taxes', archive(), FinanceTaxSchema)

export const useSetupPaymentTerms = (params: MaybeRefOrGetter<RecordParams>, enabled: MaybeRefOrGetter<boolean> = true) => useList('payment-terms', FinancePaymentTermListSchema, params, enabled)
export const useCreateSetupPaymentTerm = () => useWrite('payment-terms', create<FinancePaymentTermCreate>(), FinancePaymentTermSchema)
export const usePatchSetupPaymentTerm = () => useWrite('payment-terms', patch<FinancePaymentTermPatch>(), FinancePaymentTermSchema)
export const useArchiveSetupPaymentTerm = () => useWrite('payment-terms', archive(), FinancePaymentTermSchema)

export const useSetupAssetProfiles = (params: MaybeRefOrGetter<RecordParams>, enabled: MaybeRefOrGetter<boolean> = true) => useList('asset-profiles', FinanceAssetProfileListSchema, params, enabled)
export const useCreateSetupAssetProfile = () => useWrite('asset-profiles', create<FinanceAssetProfileCreate>(), FinanceAssetProfileSchema)
export const usePatchSetupAssetProfile = () => useWrite('asset-profiles', patch<FinanceAssetProfilePatch>(), FinanceAssetProfileSchema)
export const useArchiveSetupAssetProfile = () => useWrite('asset-profiles', archive(), FinanceAssetProfileSchema)
