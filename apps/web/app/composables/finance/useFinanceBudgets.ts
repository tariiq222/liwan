import type { MaybeRefOrGetter } from 'vue'
import { computed, toValue } from 'vue'
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/vue-query'
import {
  FinanceBudgetDetailSchema,
  FinanceBudgetLineListSchema,
  FinanceBudgetLineSchema,
  FinanceBudgetListSchema,
  FinanceBudgetVsActualSchema,
  type FinanceBudgetCreate,
  type FinanceBudgetDistribute,
  type FinanceBudgetLineCreate,
} from '@webvue/contracts'
import type { BudgetListParams } from '@/components/finance/budgets/budgetListParams'

export const financeBudgetKeys = {
  all: ['finance', 'budgets'] as const,
  list: (params: BudgetListParams) => ['finance', 'budgets', 'list', params] as const,
  record: (id: number) => ['finance', 'budgets', 'record', id] as const,
  actual: (id: number) => ['finance', 'budgets', 'actual', id] as const,
}

/** One page of budgets; the KPI counts ask for the same list with `limit=1` and read only its total. */
export function useFinanceBudgetList(params: MaybeRefOrGetter<BudgetListParams>, enabled: MaybeRefOrGetter<boolean> = true) {
  const { $api } = useApi()
  return useQuery({
    queryKey: computed(() => financeBudgetKeys.list(toValue(params))),
    enabled: computed(() => toValue(enabled)),
    placeholderData: keepPreviousData,
    queryFn: () => $api('/api/v1/finance/budgets', { query: { ...toValue(params) }, schema: FinanceBudgetListSchema }),
  })
}

export function useFinanceBudget(id: MaybeRefOrGetter<number | null>) {
  const { $api } = useApi()
  return useQuery({
    queryKey: computed(() => financeBudgetKeys.record(toValue(id) ?? 0)),
    enabled: computed(() => !!toValue(id)),
    queryFn: () => $api(`/api/v1/finance/budgets/${toValue(id)}`, { schema: FinanceBudgetDetailSchema }),
  })
}

/** The budget against the posted actuals, to the end of its period. */
export function useFinanceBudgetVsActual(id: MaybeRefOrGetter<number | null>) {
  const { $api } = useApi()
  return useQuery({
    queryKey: computed(() => financeBudgetKeys.actual(toValue(id) ?? 0)),
    enabled: computed(() => !!toValue(id)),
    queryFn: () => $api('/api/v1/finance/reports/budget-vs-actual', { query: { budget_id: toValue(id) }, schema: FinanceBudgetVsActualSchema }),
  })
}

function useBudgetWrite<T, R>(request: (input: T) => Promise<R>) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: request,
    // A write waits for the server: every list, KPI count, record and comparison refreshes from the answer.
    onSuccess: () => qc.invalidateQueries({ queryKey: financeBudgetKeys.all }),
  })
}

export function useCreateFinanceBudget() {
  const { $api } = useApi()
  return useBudgetWrite((body: FinanceBudgetCreate) => $api('/api/v1/finance/budgets', { method: 'POST', body, schema: FinanceBudgetDetailSchema }))
}

export type FinanceBudgetTransition = 'confirm' | 'reset-to-draft' | 'cancel'

export function useFinanceBudgetTransition() {
  const { $api } = useApi()
  return useBudgetWrite(({ id, action }: { id: number; action: FinanceBudgetTransition }) =>
    $api(`/api/v1/finance/budgets/${id}/${action}`, { method: 'POST', body: {}, schema: FinanceBudgetDetailSchema }))
}

export function useCreateFinanceBudgetLine() {
  const { $api } = useApi()
  return useBudgetWrite(({ id, body }: { id: number; body: FinanceBudgetLineCreate }) =>
    $api(`/api/v1/finance/budgets/${id}/lines`, { method: 'POST', body, schema: FinanceBudgetLineSchema }))
}

/** One account's budget split between cost centers, as one line each; the answer is the new lines. */
export function useDistributeFinanceBudget() {
  const { $api } = useApi()
  return useBudgetWrite(({ id, body }: { id: number; body: FinanceBudgetDistribute }) =>
    $api(`/api/v1/finance/budgets/${id}/lines/distribute`, { method: 'POST', body, schema: FinanceBudgetLineListSchema }))
}
