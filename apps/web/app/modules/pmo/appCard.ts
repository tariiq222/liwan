import { ProjectDashboardSummarySchema } from '@liwan/contracts'
import type { AppCard, AppSearchApi } from '../types'

const CAPABILITY = 'pmo.projects.read'
const summary = (api: AppSearchApi) => api('/api/v1/reports/projects/summary', { schema: ProjectDashboardSummarySchema })

/** The headline counts of the projects dashboard: every project, and those that need attention. */
export const projectsAppCard: AppCard = {
  category: 'team',
  plan: 'addon',
  surface: 'indigo',
  figures: [
    { labelKey: 'launcher.figures.projects.count', capability: CAPABILITY, queryKey: ['projects', 'summary', 'app-card', 'count'], load: async api => (await summary(api)).project_count },
    { labelKey: 'launcher.figures.projects.attention', capability: CAPABILITY, queryKey: ['projects', 'summary', 'app-card', 'attention'], load: async api => (await summary(api)).attention_project_count },
  ],
}
