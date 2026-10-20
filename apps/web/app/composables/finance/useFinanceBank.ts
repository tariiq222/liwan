import type { MaybeRefOrGetter } from 'vue'
import { computed, toValue } from 'vue'
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/vue-query'
import {
  FinanceBankLineSchema,
  FinanceBankStatementDetailSchema,
  FinanceBankStatementListSchema,
  FinanceJournalListSchema,
  FinanceReconcileProposalListSchema,
  type FinanceBankReconcile,
  type FinanceBankStatementCreate,
} from '@webvue/contracts'
import type { BankListParams } from '@/components/finance/bank/bankListParams'
import { financeInvoiceKeys } from './useFinanceInvoices'

export const financeBankKeys = {
  all: ['finance', 'bank'] as const,
  list: (params: BankListParams) => ['finance', 'bank', 'list', params] as const,
  record: (id: number) => ['finance', 'bank', 'record', id] as const,
  proposals: (lineId: number) => ['finance', 'bank', 'proposals', lineId] as const,
  journals: ['finance', 'bank', 'journals'] as const,
}

const PROPOSALS_LIMIT = 100

/** One page of statements; the KPI tiles ask for the same list with `limit=1` and read only its total. */
export function useFinanceBankStatements(params: MaybeRefOrGetter<BankListParams>, enabled: MaybeRefOrGetter<boolean> = true) {
  const { $api } = useApi()
  return useQuery({
    queryKey: computed(() => financeBankKeys.list(toValue(params))),
    enabled: computed(() => toValue(enabled)),
    placeholderData: keepPreviousData,
    queryFn: () => $api('/api/v1/finance/bank-statements', { query: { ...toValue(params) }, schema: FinanceBankStatementListSchema }),
  })
}

export function useFinanceBankStatement(id: MaybeRefOrGetter<number | null>) {
  const { $api } = useApi()
  return useQuery({
    queryKey: computed(() => financeBankKeys.record(toValue(id) ?? 0)),
    enabled: computed(() => !!toValue(id)),
    queryFn: () => $api(`/api/v1/finance/bank-statements/${toValue(id)}`, { schema: FinanceBankStatementDetailSchema }),
  })
}

/** The open items a statement line could be matched with, exact matches first. */
export function useFinanceReconcileProposals(lineId: MaybeRefOrGetter<number | null>, enabled: MaybeRefOrGetter<boolean> = true) {
  const { $api } = useApi()
  return useQuery({
    queryKey: computed(() => financeBankKeys.proposals(toValue(lineId) ?? 0)),
    enabled: computed(() => !!toValue(lineId) && toValue(enabled)),
    queryFn: () => $api(`/api/v1/finance/bank-statement-lines/${toValue(lineId)}/reconcile-proposals`, { query: { limit: PROPOSALS_LIMIT }, schema: FinanceReconcileProposalListSchema }),
  })
}

/** Bank journals: the only ones a statement can be recorded in. */
export function useFinanceBankJournals(enabled: MaybeRefOrGetter<boolean> = true) {
  const { $api } = useApi()
  return useQuery({
    queryKey: financeBankKeys.journals,
    enabled: computed(() => toValue(enabled)),
    queryFn: () => $api('/api/v1/finance/journals', { query: { type: 'bank', limit: 200 }, schema: FinanceJournalListSchema }),
  })
}


function useBankWrite<T, R>(request: (input: T) => Promise<R>) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: request,
    // A write waits for the server: every statement, proposal list and the open items of the documents refresh from the answer.
    onSuccess: () => Promise.all([
      qc.invalidateQueries({ queryKey: financeBankKeys.all }),
      qc.invalidateQueries({ queryKey: financeInvoiceKeys.all }),
    ]),
  })
}

export function useCreateFinanceBankStatement() {
  const { $api } = useApi()
  return useBankWrite((body: FinanceBankStatementCreate) => $api('/api/v1/finance/bank-statements', { method: 'POST', body, schema: FinanceBankStatementDetailSchema }))
}

export function useReconcileFinanceBankLine() {
  const { $api } = useApi()
  return useBankWrite(({ lineId, body }: { lineId: number; body: FinanceBankReconcile }) =>
    $api(`/api/v1/finance/bank-statement-lines/${lineId}/reconcile`, { method: 'POST', body, schema: FinanceBankLineSchema }))
}
