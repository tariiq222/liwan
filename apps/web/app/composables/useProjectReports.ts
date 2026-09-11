import { computed, toValue, type MaybeRefOrGetter } from 'vue'
import { useQuery } from '@tanstack/vue-query'
import {
  ProjectReportListSchema,
  type ProjectDashboardSummary,
  type ProjectReportList,
} from '@nasq/contracts'
import { reportListQuery, type ProjectReportStatusFilter } from '../utils/projectFinance'

export type { ProjectDashboardSummary, ProjectReportList }

export type ProjectReportListFilters = {
  q?: string
  status?: ProjectReportStatusFilter
  limit?: number
  offset?: number
}

export type ProjectReportSummaryFilters = Pick<ProjectReportListFilters, 'q' | 'status'>

export const reportKeys = {
  all: ['project-reports'] as const,
  list: (query: ReturnType<typeof reportListQuery>) => ['project-reports', 'list', query] as const,
  summary: (query: ReturnType<typeof reportSummaryQuery>) => ['project-reports', 'summary', query] as const,
}

export function reportSummaryQuery(filters: ProjectReportSummaryFilters = {}) {
  return {
    q: filters.q?.trim() || undefined,
    status: filters.status && filters.status !== 'all' ? filters.status : undefined,
  }
}

export function useProjectReports(filters: MaybeRefOrGetter<ProjectReportListFilters> = {}) {
  const { $api } = useApi()
  return useQuery({
    queryKey: computed(() => reportKeys.list(reportListQuery(toValue(filters)))),
    queryFn: () => $api('/api/v1/reports/projects', {
      query: reportListQuery(toValue(filters)),
      schema: ProjectReportListSchema,
    }),
  })
}

export { reportListQuery }
