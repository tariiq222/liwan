import { CrmOpportunityListSchema } from '@liwan/contracts'
import type { AppSearchProvider } from '../types'

const PAGE = 20

/** Opportunities of any status whose contact name, phone or email match `q`, twenty at a time. */
export const opportunitiesSearch: AppSearchProvider = {
  id: 'crm-opportunities',
  labelKey: 'crm.searchGroup',
  capability: 'crm.leads.read',
  icon: 'i-lucide-handshake',
  serverSearch: true,
  queryKey: q => ['search', 'crm-opportunities', q],
  async search(api, q, offset) {
    const page = await api('/api/v1/crm/opportunities', { query: { q, status: 'all', limit: PAGE, offset }, schema: CrmOpportunityListSchema })
    return {
      rows: page.items.map(opportunity => ({
        id: opportunity.id,
        label: opportunity.contact_name,
        to: `/crm/opportunities/${opportunity.id}`,
        caption: [opportunity.phone, opportunity.stage?.name].filter(Boolean).join(' · ') || undefined,
      })),
      total: page.total,
    }
  },
}
