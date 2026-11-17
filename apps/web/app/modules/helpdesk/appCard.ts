import { HelpdeskSummarySchema, HelpdeskTicketPageSchema } from '@liwan/contracts'
import type { AppCard, AppSearchApi } from '../types'

const READ = 'helpdesk.tickets.read'
const summary = (api: AppSearchApi) => api('/api/v1/helpdesk/summary', { schema: HelpdeskSummarySchema })

/** The agent's queue at a glance: what is open and what is unassigned. */
export const helpdeskAppCard: AppCard = {
  category: 'team',
  plan: 'addon',
  surface: 'coral',
  figures: [
    { labelKey: 'launcher.figures.helpdesk.open', capability: READ, queryKey: ['helpdesk', 'summary', 'app-card', 'open'], load: async api => (await summary(api)).open },
    { labelKey: 'launcher.figures.helpdesk.unassigned', capability: READ, queryKey: ['helpdesk', 'summary', 'app-card', 'unassigned'], load: async api => (await summary(api)).unassigned },
  ],
}

/** The palette finds a ticket by its number or subject. */
export async function searchTickets(api: AppSearchApi, q: string, offset = 0): Promise<{ rows: { id: number; label: string; to: string; caption?: string }[] }> {
  const page = await api('/api/v1/helpdesk/tickets', {
    query: { q, state: 'all', limit: 10, offset }, schema: HelpdeskTicketPageSchema,
  })
  return {
    rows: page.items.map(ticket => ({
      id: ticket.id, label: `${ticket.number} · ${ticket.subject}`, to: `/helpdesk/${ticket.id}`, caption: ticket.stage.name,
    })),
  }
}
