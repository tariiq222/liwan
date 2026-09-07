import { computed, toValue, type MaybeRefOrGetter } from 'vue'
import { useQuery } from '@tanstack/vue-query'
import { ProjectReportListSchema, type ProjectReportList } from '@nasq/contracts'
import { reportListQuery, type ProjectReportStatusFilter } from '@/utils/projectFinance'

export type { ProjectReportList }

export type ProjectReportListFilters = {
  q?: string
  status?: ProjectReportStatusFilter
  limit?: number
  offset?: number
}

export const reportKeys = {
  all: ['project-reports'] as const,
  list: (query: ReturnType<typeof reportListQuery>) => ['project-reports', 'list', query] as const,
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
