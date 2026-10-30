import type { MaybeRefOrGetter } from 'vue'
import { computed, toValue } from 'vue'
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/vue-query'
import {
  FinanceBankAutoReconcileSchema,
  FinanceBankImportColumnsSchema,
  FinanceBankImportPreviewSchema,
  FinanceBankLineSchema,
  FinanceBankStatementDetailSchema,
  FinanceBankStatementListSchema,
  FinanceJournalListSchema,
  FinanceReconcileProposalListSchema,
  type FinanceBankImport,
  type FinanceBankReconcile,
  type FinanceBankStatementPatch,
  type FinanceBankStatementCreate,
} from '@liwan/contracts'
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

/** Reads the file and writes nothing: without a mapping the answer is the columns, with one the lines the import would create. */
export function useFinanceBankImportColumns() {
  const { $api } = useApi()
  return useMutation({ mutationFn: (body: Record<string, unknown>) => $api('/api/v1/finance/bank-statements/import/preview', { method: 'POST', body, schema: FinanceBankImportColumnsSchema }) })
}

export function useFinanceBankImportPreview() {
  const { $api } = useApi()
  return useMutation({ mutationFn: (body: Record<string, unknown>) => $api('/api/v1/finance/bank-statements/import/preview', { method: 'POST', body, schema: FinanceBankImportPreviewSchema }) })
}

/** The key stays with the form instance: saving again after a lost answer replays the first import instead of doubling it. */
export function useImportFinanceBankStatement() {
  const { $api } = useApi()
  const key = crypto.randomUUID()
  return useBankWrite((body: FinanceBankImport) =>
    $api('/api/v1/finance/bank-statements/import', { method: 'POST', body, headers: { 'Idempotency-Key': key }, schema: FinanceBankStatementDetailSchema }))
}

export function useUnreconcileFinanceBankLine() {
  const { $api } = useApi()
  return useBankWrite((lineId: number) => $api(`/api/v1/finance/bank-statement-lines/${lineId}/unreconcile`, { method: 'POST', body: {}, schema: FinanceBankLineSchema }))
}

/** Without `apply` the answer is only what would be matched; with it the certain matches are written. */
export function useAutoReconcileFinanceBankStatement() {
  const { $api } = useApi()
  return useBankWrite(({ id, apply }: { id: number; apply: boolean }) =>
    $api(`/api/v1/finance/bank-statements/${id}/auto-reconcile`, { method: 'POST', body: { apply }, schema: FinanceBankAutoReconcileSchema }))
}

/** Corrects the name and the balances of a statement; the lines are not edited here. */
export function usePatchFinanceBankStatement() {
  const { $api } = useApi()
  return useBankWrite(({ id, body }: { id: number; body: FinanceBankStatementPatch }) =>
    $api(`/api/v1/finance/bank-statements/${id}`, { method: 'PATCH', body, schema: FinanceBankStatementDetailSchema }))
}

/** Removes a statement none of whose lines is reconciled. */
export function useDeleteFinanceBankStatement() {
  const { $api } = useApi()
  return useBankWrite((id: number) => $api(`/api/v1/finance/bank-statements/${id}`, { method: 'DELETE' }))
}
