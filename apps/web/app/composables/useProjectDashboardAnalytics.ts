import { computed, toValue, type MaybeRefOrGetter } from 'vue'
import { useQuery } from '@tanstack/vue-query'
import {
  ProjectDashboardAnalyticsSchema,
  type ProjectDashboardAnalytics,
} from '@liwan/contracts'
import { type ProjectReportStatusFilter } from '../utils/projectFinance'

export type { ProjectDashboardAnalytics }

type ProjectDashboardAnalyticsFilters = Pick<{
  q?: string
  status?: ProjectReportStatusFilter
}, 'q' | 'status'>

function projectDashboardAnalyticsQuery(filters: ProjectDashboardAnalyticsFilters = {}) {
  return {
    q: filters.q?.trim() || undefined,
    status: filters.status && filters.status !== 'all' ? filters.status : undefined,
  }
}

const projectDashboardAnalyticsKeys = {
  all: ['project-dashboard-analytics'] as const,
  detail: (query: ReturnType<typeof projectDashboardAnalyticsQuery>) => ['project-dashboard-analytics', query] as const,
}

export function useProjectDashboardAnalytics(filters: MaybeRefOrGetter<ProjectDashboardAnalyticsFilters> = {}) {
  const { $api } = useApi()
  return useQuery({
    queryKey: computed(() => projectDashboardAnalyticsKeys.detail(projectDashboardAnalyticsQuery(toValue(filters)))),
    queryFn: () => $api('/api/v1/reports/projects/analytics', {
      query: projectDashboardAnalyticsQuery(toValue(filters)),
      schema: ProjectDashboardAnalyticsSchema,
    }),
  })
}
