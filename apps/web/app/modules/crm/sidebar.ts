import { CrmImportBatchListSchema, CrmOpportunityListSchema } from '@liwan/contracts'
import { normalizedPath } from '../../utils/routePath'
import type { AppSearchApi, AppSidebarMenu, AppSidebarRoute } from '../types'

const onPath = (route: AppSidebarRoute, path: string) => normalizedPath(route.path) === path
const insidePath = (route: AppSidebarRoute, path: string) => onPath(route, path) || normalizedPath(route.path).startsWith(`${path}/`)

// The package sub-feature the server also requires for imports (`controllers/imports.py`), on top of `crm.leads.import`.
// The create command carries no key of its own: the palette gates it by its target route's rule.
export const IMPORT_FEATURE = 'crm.import'

/**
 * The CRM sidebar: pinned create action (`new-opportunity`), flat rows for dashboard, opportunities and imports,
 * and live server counts loaded with `limit: 1` under the `crm` query-key root.
 */
export const crmSidebar: AppSidebarMenu = {
  create: 'new-opportunity',
  rows: [
    {
      id: 'crm-dashboard', labelKey: 'crm.nav.dashboard', icon: 'i-lucide-layout-dashboard', to: { path: '/crm' },
      capability: 'crm.leads.read',
      active: route => onPath(route, '/crm'),
    },
    {
      id: 'crm-opportunities', labelKey: 'crm.nav.opportunities', icon: 'i-lucide-handshake', to: { path: '/crm/opportunities' }, keep: ['view'],
      capability: 'crm.leads.read',
      active: route => insidePath(route, '/crm/opportunities'),
    },
    {
      id: 'crm-imports', labelKey: 'crm.nav.imports', icon: 'i-lucide-file-up', to: { path: '/crm/imports' },
      capability: 'crm.leads.import',
      active: route => insidePath(route, '/crm/imports'),
    },
  ],
  counts: [
    {
      capability: 'crm.leads.read',
      queryKey: ['crm', 'opportunities', 'list', 'sidebar'],
      async load(api: AppSearchApi) {
        const result = await api('/api/v1/crm/opportunities', { query: { limit: 1 }, schema: CrmOpportunityListSchema })
        return { 'crm-opportunities': result.total }
      },
    },
    {
      capability: 'crm.leads.import',
      feature: IMPORT_FEATURE,
      queryKey: ['crm', 'imports', 'batches', 'sidebar'],
      async load(api: AppSearchApi) {
        const result = await api('/api/v1/crm/imports', { query: { limit: 1 }, schema: CrmImportBatchListSchema })
        return { 'crm-imports': result.total }
      },
    },
  ],
}
