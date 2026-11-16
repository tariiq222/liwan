import type { AppManifest, AppSearchApi } from '../types'
import { helpdeskAppCard, searchTickets } from './appCard'

// The Support Desk: the team's queue, the ticket and its thread, and the policy a tenant shapes in Settings.
// `helpdesk.tickets.read` opens the whole application for an agent; `helpdesk.requests.read` lets every employee
// follow the requests they opened themselves, so the rail item and the list are open to either capability.
const READ = 'helpdesk.tickets.read'
const WRITE = 'helpdesk.tickets.write'
const REQUESTS_READ = 'helpdesk.requests.read'
const REQUESTS_CREATE = 'helpdesk.requests.create'

const manifest: AppManifest = {
  id: 'helpdesk',
  feature: 'helpdesk.enabled',
  routePrefixes: ['/helpdesk'],
  rail: [{ id: 'helpdesk', labelKey: 'nav.helpdesk', icon: 'i-lucide-life-buoy', to: '/helpdesk', order: 100 }],
  nav: [
    {
      to: '/helpdesk', labelKey: 'helpdesk.nav.tickets', icon: 'i-lucide-life-buoy', shortcut: '',
      capability: READ, anyCapabilities: [REQUESTS_READ],
    },
  ],
  settings: {
    id: 'helpdesk', labelKey: 'nav.helpdesk', icon: 'i-lucide-life-buoy', to: '/settings/apps/helpdesk',
    parts: [
      { id: 'policy', labelKey: 'helpdesk.settings.policy', icon: 'i-lucide-sliders-horizontal', capability: 'helpdesk.settings.read' },
    ],
  },
  contextLinks: () => [
    { id: 'helpdesk-tickets', labelKey: 'helpdesk.nav.tickets', icon: 'i-lucide-life-buoy', to: '/helpdesk', capability: READ, anyCapabilities: [REQUESTS_READ] },
  ],
  landing: [{ path: '/helpdesk', capability: READ }],
  // Merging needs both its capability and the merge sub-feature the server checks on the same route.
  subFeatures: { 'helpdesk.tickets.merge': 'helpdesk.merge', 'helpdesk.tickets.merge.': 'helpdesk.merge' },
  routeCapabilities: [
    // The panel's form and the server both open a ticket for whoever may answer or ask.
    { pattern: /^\/helpdesk\/new$/, capability: REQUESTS_CREATE, anyCapabilities: [WRITE] },
    { pattern: /^\/helpdesk\/[^/]+\/edit$/, capability: WRITE },
    { pattern: /^\/helpdesk(?:\/|$)/, capability: READ, anyCapabilities: [REQUESTS_READ] },
    { pattern: /^\/settings\/apps\/helpdesk(?:\/|$)/, capability: 'helpdesk.settings.read' },
  ],
  commands: [
    { id: 'helpdesk.new', labelKey: 'helpdesk.new', icon: 'i-lucide-plus', to: '/helpdesk/new', capability: REQUESTS_CREATE },
  ],
  appCard: helpdeskAppCard,
  search: [
    {
      id: 'helpdesk.tickets', labelKey: 'helpdesk.searchProviders.tickets', capability: READ, icon: 'i-lucide-life-buoy',
      serverSearch: true,
      queryKey: (q: string) => ['helpdesk', 'search', q],
      search: (api: AppSearchApi, q: string, offset: number) => searchTickets(api, q, offset).then(page => ({ rows: page.rows })),
    },
  ],
  bell: {
    capabilities: [READ],
    kinds: [
      { kind: 'helpdesk.assigned', href: row => (typeof row.ticket_id === 'number' ? `/helpdesk/${row.ticket_id}` : null) },
    ],
  },
}
export default manifest
