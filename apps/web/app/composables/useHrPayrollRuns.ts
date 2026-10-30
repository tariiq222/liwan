import type { MaybeRefOrGetter } from 'vue'
import { computed, toValue } from 'vue'
import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/vue-query'
import {
  HrPayrollRunListSchema,
  HrPayrollRunSchema,
  HrPayslipRowListSchema,
  HrPayslipRowSchema,
  HrPayslipSchema,
  type HrPayrollRun,
  type HrPayrollRunCreate,
  type HrPayrollRunState,
  type HrPayslipInputsPatch,
  type HrPayslipRow,
  type HrPayslipRowList,
} from '@liwan/contracts'
import { hrPayrollKeys } from './useHrPayrollCompensation'

type Api = ReturnType<typeof useApi>['$api']

/** The page size the run and payslip lists ask for; the server caps it. */
export const HR_PAYROLL_PAGE_SIZE = 25
/** The register shows (and prints) up to this many payslips of a run at once; the server caps it at 100. */
export const HR_PAYSLIP_PAGE_SIZE = 100
const MAX_LIMIT = 100
const RUNS_PATH = '/api/v1/hr/payroll/runs'

export type HrPayrollRunStateFilter = 'all' | HrPayrollRunState
export type HrPayrollRunTransition = 'compute' | 'approve' | 'cancel'

export interface HrPayrollRunsQuery {
  year?: number
  state?: HrPayrollRunState
  limit: number
  offset: number
}

export interface HrPayslipsQuery {
  q?: string
  limit: number
  offset: number
}

function page(input: { limit?: number; offset?: number }, fallback = HR_PAYROLL_PAGE_SIZE) {
  const asked = input.limit
  const limit = Number.isFinite(asked) && (asked as number) > 0 ? Math.min(Math.trunc(asked as number), MAX_LIMIT) : fallback
  const offset = Number.isInteger(input.offset) && (input.offset as number) > 0 ? (input.offset as number) : 0
  return { limit, offset }
}

export function hrPayrollRunsQuery(input: { year?: number | null; state?: HrPayrollRunStateFilter; limit?: number; offset?: number }): HrPayrollRunsQuery {
  return {
    year: input.year ?? undefined,
    state: input.state && input.state !== 'all' ? input.state : undefined,
    ...page(input),
  }
}

export function hrPayslipsQuery(input: { q?: string; limit?: number; offset?: number }): HrPayslipsQuery {
  return { q: input.q?.trim() || undefined, ...page(input, HR_PAYSLIP_PAGE_SIZE) }
}

/** A run write answers with the full run: replace it in the cache, then refresh what it totals. */
export function replaceRun(qc: QueryClient, run: HrPayrollRun) {
  qc.setQueryData(hrPayrollKeys.run(run.id), run)
  void qc.invalidateQueries({ queryKey: hrPayrollKeys.runLists })
  void qc.invalidateQueries({ queryKey: hrPayrollKeys.payslipsOf(run.id) })
}

export async function createHrPayrollRun($api: Api, qc: QueryClient, body: HrPayrollRunCreate) {
  const run = await $api(RUNS_PATH, { method: 'POST', body, schema: HrPayrollRunSchema })
  replaceRun(qc, run)
  return run
}

/** Compute and approve answer with the run; cancel deletes it. None touches the cache before the server answers. */
export async function transitionHrPayrollRun($api: Api, qc: QueryClient, runId: number, action: HrPayrollRunTransition) {
  if (action === 'cancel') {
    await $api(`${RUNS_PATH}/${runId}`, { method: 'DELETE' })
    qc.removeQueries({ queryKey: hrPayrollKeys.run(runId) })
    qc.removeQueries({ queryKey: hrPayrollKeys.payslipsOf(runId) })
    void qc.invalidateQueries({ queryKey: hrPayrollKeys.runLists })
    return undefined
  }
  const run = await $api(`${RUNS_PATH}/${runId}/${action}`, { method: 'POST', body: {}, schema: HrPayrollRunSchema })
  replaceRun(qc, run)
  return run
}

/** The server row replaces the edited row in every cached page of the run; the run's totals are refetched. */
export async function patchHrPayslipInputs($api: Api, qc: QueryClient, runId: number, payslipId: number, body: HrPayslipInputsPatch) {
  const row = await $api(`${RUNS_PATH}/${runId}/payslips/${payslipId}/inputs`, { method: 'PATCH', body, schema: HrPayslipRowSchema })
  qc.setQueriesData<HrPayslipRowList>({ queryKey: hrPayrollKeys.payslipsOf(runId) }, current => current && {
    ...current,
    items: current.items.map(item => item.id === row.id ? row : item),
  })
  void qc.invalidateQueries({ queryKey: hrPayrollKeys.run(runId) })
  return row
}

/** Every row of a list route, read in the server's page size until its `total` is reached; `total` stays the server's, so a short read shows as `items.length < total`. */
export async function fetchAllPages<T>(
  fetchPage: (offset: number) => Promise<{ items: T[]; total: number }>,
): Promise<{ items: T[]; total: number }> {
  const items: T[] = []
  for (;;) {
    const page = await fetchPage(items.length)
    items.push(...page.items)
    if (page.items.length === 0 || items.length >= page.total) return { items, total: page.total }
  }
}

/** Every payslip row of a run, in the server's page size and ignoring any search: what the printed register lists. */
export async function fetchAllHrPayslips($api: Api, runId: number): Promise<HrPayslipRow[]> {
  const { items } = await fetchAllPages(offset => $api(`${RUNS_PATH}/${runId}/payslips`, { query: { limit: HR_PAYSLIP_PAGE_SIZE, offset }, schema: HrPayslipRowListSchema }))
  return items
}

export function useHrPayrollRuns(query: MaybeRefOrGetter<HrPayrollRunsQuery>, enabled: MaybeRefOrGetter<boolean> = true) {
  const { $api } = useApi()
  const { can } = useAccess()
  return useQuery({
    queryKey: computed(() => hrPayrollKeys.runList(toValue(query))),
    enabled: computed(() => can('hr.payroll.read') && toValue(enabled)),
    placeholderData: previous => previous,
    queryFn: () => $api(RUNS_PATH, { query: { ...toValue(query) }, schema: HrPayrollRunListSchema }),
  })
}

export function useHrPayrollRun(runId: MaybeRefOrGetter<number | null>) {
  const { $api } = useApi()
  const { can } = useAccess()
  return useQuery({
    queryKey: computed(() => hrPayrollKeys.run(toValue(runId) ?? 0)),
    enabled: computed(() => can('hr.payroll.read') && toValue(runId) !== null),
    queryFn: () => $api(`${RUNS_PATH}/${toValue(runId)}`, { schema: HrPayrollRunSchema }),
  })
}

export function useCreateHrPayrollRun() {
  const qc = useQueryClient()
  const { $api } = useApi()
  return useMutation({ mutationFn: (body: HrPayrollRunCreate) => createHrPayrollRun($api, qc, body) })
}

/** One mutation per action, each pending until the server confirms. */
export function useHrPayrollRunTransition(runId: MaybeRefOrGetter<number>) {
  const qc = useQueryClient()
  const { $api } = useApi()
  const mutation = (action: HrPayrollRunTransition) => useMutation({ mutationFn: () => transitionHrPayrollRun($api, qc, toValue(runId), action) })
  return { compute: mutation('compute'), approve: mutation('approve'), cancel: mutation('cancel') }
}

export function useHrPayrollRunPayslips(runId: MaybeRefOrGetter<number | null>, query: MaybeRefOrGetter<HrPayslipsQuery>) {
  const { $api } = useApi()
  const { can } = useAccess()
  return useQuery({
    queryKey: computed(() => hrPayrollKeys.payslips(toValue(runId) ?? 0, toValue(query))),
    enabled: computed(() => can('hr.payroll.read') && toValue(runId) !== null),
    placeholderData: previous => previous,
    queryFn: () => $api(`${RUNS_PATH}/${toValue(runId)}/payslips`, { query: { ...toValue(query) }, schema: HrPayslipRowListSchema }),
  })
}

export function usePatchHrPayslipInputs(runId: MaybeRefOrGetter<number>) {
  const qc = useQueryClient()
  const { $api } = useApi()
  return useMutation({
    mutationFn: ({ payslipId, body }: { payslipId: number; body: HrPayslipInputsPatch }): Promise<HrPayslipRow> =>
      patchHrPayslipInputs($api, qc, toValue(runId), payslipId, body),
  })
}

/** One payslip of a run: the document the printable payslip page shows. */
export function useHrPayslip(runId: MaybeRefOrGetter<number | null>, payslipId: MaybeRefOrGetter<number | null>) {
  const { $api } = useApi()
  const { can } = useAccess()
  return useQuery({
    queryKey: computed(() => hrPayrollKeys.payslip(toValue(runId) ?? 0, toValue(payslipId) ?? 0)),
    enabled: computed(() => can('hr.payroll.read') && toValue(runId) !== null && toValue(payslipId) !== null),
    queryFn: () => $api(`${RUNS_PATH}/${toValue(runId)}/payslips/${toValue(payslipId)}`, { schema: HrPayslipSchema }),
  })
}
