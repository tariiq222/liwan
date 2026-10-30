import type { MaybeRefOrGetter } from 'vue'
import { computed, toValue } from 'vue'
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/vue-query'
import {
  FinanceAnalyticAccountListSchema,
  FinanceAnalyticAccountSchema,
  FinanceAnalyticPlanListSchema,
  FinanceAnalyticPlanSchema,
  FinanceAnalyticReportLineListSchema,
  type FinanceAnalyticAccountCreate,
  type FinanceAnalyticAccountPatch,
  type FinanceAnalyticPlanCreate,
  type FinanceAnalyticPlanPatch,
} from '@liwan/contracts'
import type { AnalyticAccountParams, AnalyticLineParams } from '@/components/finance/analytic/analyticParams'

const PLAN_LIMIT = 100

export const financeAnalyticKeys = {
  all: ['finance', 'analytic'] as const,
  plans: ['finance', 'analytic', 'plans'] as const,
  costCenterOptions: ['finance', 'analytic', 'cost-center-options'] as const,
  accounts: (params: AnalyticAccountParams) => ['finance', 'analytic', 'accounts', params] as const,
  lines: (params: AnalyticLineParams) => ['finance', 'reports', 'analytic', 'lines', params] as const,
}

/** Every plan: the settings list, the plan choice of a cost center and the report filter read the same answer. */
export function useFinanceAnalyticPlans(enabled: MaybeRefOrGetter<boolean> = true) {
  const { $api } = useApi()
  return useQuery({
    queryKey: financeAnalyticKeys.plans,
    enabled: computed(() => toValue(enabled)),
    queryFn: () => $api('/api/v1/finance/analytic-plans', { query: { limit: PLAN_LIMIT }, schema: FinanceAnalyticPlanListSchema }),
  })
}

export function useFinanceAnalyticAccounts(params: MaybeRefOrGetter<AnalyticAccountParams>, enabled: MaybeRefOrGetter<boolean> = true) {
  const { $api } = useApi()
  return useQuery({
    queryKey: computed(() => financeAnalyticKeys.accounts(toValue(params))),
    enabled: computed(() => toValue(enabled)),
    placeholderData: keepPreviousData,
    queryFn: () => $api('/api/v1/finance/analytic-accounts', { query: { ...toValue(params) }, schema: FinanceAnalyticAccountListSchema }),
  })
}

/** The analytic items behind one row of the cost center report, one page at a time. */
export function useFinanceAnalyticLines(params: MaybeRefOrGetter<AnalyticLineParams>, enabled: MaybeRefOrGetter<boolean> = true) {
  const { $api } = useApi()
  return useQuery({
    queryKey: computed(() => financeAnalyticKeys.lines(toValue(params))),
    enabled: computed(() => toValue(enabled)),
    // Another page of the same cost center keeps the last answer on screen; another cost center never shows its items.
    placeholderData: (previous, previousQuery) => previousQuery?.queryKey[4]?.account_id === toValue(params).account_id ? previous : undefined,
    queryFn: () => $api('/api/v1/finance/reports/analytic/lines', { query: { ...toValue(params) }, schema: FinanceAnalyticReportLineListSchema }),
  })
}

function useAnalyticWrite<T, R>(request: (input: T) => Promise<R>) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: request,
    // A write waits for the server: the plans, the cost centers and the report refresh from the answer.
    onSuccess: () => Promise.all([
      qc.invalidateQueries({ queryKey: financeAnalyticKeys.all }),
      qc.invalidateQueries({ queryKey: ['finance', 'reports', 'analytic'] }),
    ]),
  })
}

export function useCreateAnalyticPlan() {
  const { $api } = useApi()
  return useAnalyticWrite((body: FinanceAnalyticPlanCreate) => $api('/api/v1/finance/analytic-plans', { method: 'POST', body, schema: FinanceAnalyticPlanSchema }))
}

export function useRenameAnalyticPlan() {
  const { $api } = useApi()
  return useAnalyticWrite(({ id, patch }: { id: number; patch: FinanceAnalyticPlanPatch }) =>
    $api(`/api/v1/finance/analytic-plans/${id}`, { method: 'PATCH', body: patch, schema: FinanceAnalyticPlanSchema }))
}

export function useCreateAnalyticAccount() {
  const { $api } = useApi()
  return useAnalyticWrite((body: FinanceAnalyticAccountCreate) => $api('/api/v1/finance/analytic-accounts', { method: 'POST', body, schema: FinanceAnalyticAccountSchema }))
}

export function usePatchAnalyticAccount() {
  const { $api } = useApi()
  return useAnalyticWrite(({ id, patch }: { id: number; patch: FinanceAnalyticAccountPatch }) =>
    $api(`/api/v1/finance/analytic-accounts/${id}`, { method: 'PATCH', body: patch, schema: FinanceAnalyticAccountSchema }))
}
