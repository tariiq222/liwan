import { CrmDashboardSchema } from '@liwan/contracts'
import type { AppCard, AppSearchApi } from '../types'

const CAPABILITY = 'crm.leads.read'
const dashboard = (api: AppSearchApi) => api('/api/v1/crm/dashboard', { schema: CrmDashboardSchema })

/** The agent block of the CRM dashboard: follow-ups due now and opportunities that arrived today. */
export const crmAppCard: AppCard = {
  category: 'sales',
  plan: 'addon',
  surface: 'navy',
  figures: [
    { labelKey: 'launcher.figures.crm.due', capability: CAPABILITY, queryKey: ['crm', 'dashboard', 'app-card', 'due'], load: async api => (await dashboard(api)).agent.due_now },
    { labelKey: 'launcher.figures.crm.today', capability: CAPABILITY, queryKey: ['crm', 'dashboard', 'app-card', 'today'], load: async api => (await dashboard(api)).agent.new_today },
  ],
}
