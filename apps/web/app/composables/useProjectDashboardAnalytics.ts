import { computed, toValue, type MaybeRefOrGetter } from 'vue'
import { useQuery } from '@tanstack/vue-query'
import {
  ProjectDashboardAnalyticsSchema,
  type ProjectDashboardAnalytics,
} from '@liwan/contracts'
import { type ProjectReportStatusFilter } from '../utils/projectFinance'
import { projectKeys } from './projectKeys'

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

export function useProjectDashboardAnalytics(filters: MaybeRefOrGetter<ProjectDashboardAnalyticsFilters> = {}) {
  const { $api } = useApi()
  return useQuery({
    queryKey: computed(() => projectKeys.analytics(projectDashboardAnalyticsQuery(toValue(filters)))),
    queryFn: () => $api('/api/v1/reports/projects/analytics', {
      query: projectDashboardAnalyticsQuery(toValue(filters)),
      schema: ProjectDashboardAnalyticsSchema,
    }),
  })
}
