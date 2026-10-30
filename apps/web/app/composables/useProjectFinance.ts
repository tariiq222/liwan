import { computed, toValue, type MaybeRefOrGetter } from 'vue'
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/vue-query'
import {
  ActualLineListSchema,
  FinanceDeletedSchema,
  FinanceEntryListSchema,
  FinanceEntrySchema,
  FinanceSummarySchema,
  type ActualAccountPatch,
  type FinanceEntry,
  type FinanceEntryCreate,
  type FinanceEntryList,
  type FinanceEntryPatch,
  type FinanceKind,
  type FinanceSummary,
} from '@liwan/contracts'
import { actualLinesQuery, financeListQuery, type FinanceKindFilter } from '@/utils/projectFinance'
import { parsePositiveId } from '@/utils/routeParams'

export type { FinanceEntry, FinanceEntryList, FinanceSummary }

export type ProjectFinanceListFilters = {
  kind?: FinanceKind | FinanceKindFilter
  q?: string
  limit?: number
  offset?: number
}

export const financeKeys = {
  all: ['project-finance'] as const,
  list: (projectId: number, query: ReturnType<typeof financeListQuery>) =>
    ['project-finance', 'list', projectId, query] as const,
  summary: (projectId: number) => ['project-finance', 'summary', projectId] as const,
  actualLines: (projectId: number, query: ReturnType<typeof actualLinesQuery>) =>
    ['project-finance', 'actual-lines', projectId, query] as const,
  detail: (projectId: number, entryId: number) => ['project-finance', 'detail', projectId, entryId] as const,
}

function invalidateFinanceAndReports(qc: ReturnType<typeof useQueryClient>, projectId: number) {
  void qc.invalidateQueries({ queryKey: ['project-finance', 'list', projectId] })
  void qc.invalidateQueries({ queryKey: financeKeys.summary(projectId) })
  void qc.invalidateQueries({ queryKey: ['project-finance', 'detail', projectId] })
  void qc.invalidateQueries({ queryKey: ['project-finance', 'actual-lines', projectId] })
  void qc.invalidateQueries({ queryKey: ['project-reports'] })
}

export function useProjectFinanceList(
  projectId: MaybeRefOrGetter<number | null>,
  filters: MaybeRefOrGetter<ProjectFinanceListFilters> = {},
) {
  const { $api } = useApi()
  return useQuery({
    queryKey: computed(() => financeKeys.list(toValue(projectId) ?? 0, financeListQuery(toValue(filters)))),
    enabled: computed(() => parsePositiveId(toValue(projectId)) != null),
    queryFn: () => {
      const id = toValue(projectId)
      if (id == null) throw new Error('invalid_id')
      return $api(`/api/v1/projects/${id}/finance`, {
        query: financeListQuery(toValue(filters)),
        schema: FinanceEntryListSchema,
      })
    },
  })
}

/** The posted lines behind an external actual, one page at a time; a caller mounts it only when the summary says the user may read them. */
export function useProjectActualLines(
  projectId: MaybeRefOrGetter<number | null>,
  filters: MaybeRefOrGetter<{ limit?: number; offset?: number }>,
) {
  const { $api } = useApi()
  return useQuery({
    queryKey: computed(() => financeKeys.actualLines(toValue(projectId) ?? 0, actualLinesQuery(toValue(filters)))),
    enabled: computed(() => parsePositiveId(toValue(projectId)) != null),
    placeholderData: keepPreviousData,
    queryFn: () => {
      const id = toValue(projectId)
      if (id == null) throw new Error('invalid_id')
      return $api(`/api/v1/projects/${id}/finance/actual-lines`, { query: actualLinesQuery(toValue(filters)), schema: ActualLineListSchema })
    },
  })
}

export function useProjectFinanceEntry(
  projectId: MaybeRefOrGetter<number | null>,
  entryId: MaybeRefOrGetter<number | null>,
) {
  const { $api } = useApi()
  return useQuery({
    queryKey: computed(() => financeKeys.detail(toValue(projectId) ?? 0, toValue(entryId) ?? 0)),
    enabled: computed(() => parsePositiveId(toValue(projectId)) != null && parsePositiveId(toValue(entryId)) != null),
    queryFn: () => {
      const id = toValue(projectId)
      const entry = toValue(entryId)
      if (id == null || entry == null) throw new Error('invalid_id')
      return $api(`/api/v1/projects/${id}/finance/${entry}`, { schema: FinanceEntrySchema })
    },
  })
}

export function useCreateFinanceEntry() {
  const qc = useQueryClient()
  const { $api } = useApi()
  return useMutation({
    mutationFn: ({ projectId, body }: { projectId: number; body: FinanceEntryCreate }) =>
      $api(`/api/v1/projects/${projectId}/finance`, { method: 'POST', body, schema: FinanceEntrySchema }),
    onSuccess: (entry, { projectId }) => {
      qc.setQueryData(financeKeys.detail(projectId, entry.id), entry)
      invalidateFinanceAndReports(qc, projectId)
    },
  })
}

export function useUpdateFinanceEntry() {
  const qc = useQueryClient()
  const { $api } = useApi()
  return useMutation({
    mutationFn: ({ projectId, entryId, patch }: { projectId: number; entryId: number; patch: FinanceEntryPatch }) =>
      $api(`/api/v1/projects/${projectId}/finance/${entryId}`, { method: 'PATCH', body: patch, schema: FinanceEntrySchema }),
    onSuccess: (entry, { projectId, entryId }) => {
      qc.setQueryData(financeKeys.detail(projectId, entryId), entry)
      invalidateFinanceAndReports(qc, projectId)
    },
  })
}

export function useDeleteFinanceEntry() {
  const qc = useQueryClient()
  const { $api } = useApi()
  return useMutation({
    mutationFn: ({ projectId, entryId, expected_updated_at }: { projectId: number; entryId: number; expected_updated_at: string }) =>
      $api(`/api/v1/projects/${projectId}/finance/${entryId}`, {
        method: 'DELETE',
        body: { expected_updated_at },
        schema: FinanceDeletedSchema,
      }),
    onSuccess: (_result, { projectId, entryId }) => {
      qc.removeQueries({ queryKey: financeKeys.detail(projectId, entryId) })
      invalidateFinanceAndReports(qc, projectId)
    },
  })
}

/** Links the project to the cost center its actual comes from, or clears the link with `accountId: null`. */
export function useSetActualAccount() {
  const qc = useQueryClient()
  const { $api } = useApi()
  return useMutation({
    mutationFn: ({ projectId, accountId }: { projectId: number; accountId: number | null }) =>
      $api(`/api/v1/projects/${projectId}/finance/actual-account`, {
        method: 'PATCH',
        body: { account_id: accountId } satisfies ActualAccountPatch,
        schema: FinanceSummarySchema,
      }),
    onSuccess: (_summary, { projectId }) => invalidateFinanceAndReports(qc, projectId),
  })
}
