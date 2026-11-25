import type { AppManifest, AppSearchApi } from '../types'
import { helpdeskAppCard, searchTickets } from './appCard'
import { helpdeskSidebar } from './sidebar'

// The Support Desk: the team's queue, the ticket and its thread, and the policy a tenant shapes in Settings.
// `helpdesk.tickets.read` opens the whole application for an agent; `helpdesk.requests.read` lets every employee
// follow the requests they opened themselves, so the rail item and the list are open to either capability.
const READ = 'helpdesk.tickets.read'
const WRITE = 'helpdesk.tickets.write'
const REQUESTS_READ = 'helpdesk.requests.read'
const REQUESTS_CREATE = 'helpdesk.requests.create'
const REPORTS = 'helpdesk.reports.read'

const manifest: AppManifest = {
  id: 'helpdesk',
  feature: 'helpdesk.enabled',
  routePrefixes: ['/helpdesk'],
  rail: [{ id: 'helpdesk', labelKey: 'nav.helpdesk', icon: 'i-lucide-life-buoy', to: '/helpdesk', order: 100 }],
  nav: [
    {
      to: '/helpdesk', labelKey: 'helpdesk.nav.tickets', icon: 'i-lucide-life-buoy', shortcut: '',
      capability: REQUESTS_READ, anyCapabilities: [READ],
    },
    {
      to: '/helpdesk/reports', labelKey: 'helpdesk.nav.reports', icon: 'i-lucide-chart-column', shortcut: '',
      capability: REPORTS, feature: 'helpdesk.reports',
    },
  ],
  settings: {
    id: 'helpdesk', labelKey: 'nav.helpdesk', icon: 'i-lucide-life-buoy', to: '/settings/apps/helpdesk',
    parts: [
      { id: 'policy', labelKey: 'helpdesk.settings.policy', icon: 'i-lucide-sliders-horizontal', capability: 'helpdesk.settings.read' },
    ],
  },
  contextLinks: () => [
    { id: 'helpdesk-new', labelKey: 'helpdesk.new', icon: 'i-lucide-plus', to: '/helpdesk/new', capability: REQUESTS_CREATE, anyCapabilities: [WRITE], pinned: true },
    { id: 'helpdesk-tickets', labelKey: 'helpdesk.nav.tickets', icon: 'i-lucide-life-buoy', to: '/helpdesk', capability: REQUESTS_READ, anyCapabilities: [READ] },
    { id: 'helpdesk-reports', labelKey: 'helpdesk.nav.reports', icon: 'i-lucide-chart-column', to: '/helpdesk/reports', capability: REPORTS, feature: 'helpdesk.reports' },
  ],
  sidebar: helpdeskSidebar,
  // The queue is the landing of an agent and of an employee following their own requests.
  landing: [{ path: '/helpdesk', capability: REQUESTS_READ, anyCapabilities: [READ] }],
  // Merging needs both its capability and the merge sub-feature the server checks on the same route.
  subFeatures: {
    'helpdesk.tickets.merge': 'helpdesk.merge', 'helpdesk.tickets.merge.': 'helpdesk.merge',
    'helpdesk.reports.': 'helpdesk.reports',
  },
  routeCapabilities: [
    // The reports have their own capability and sub-feature, matched before the generic helpdesk rule.
    { pattern: /^\/helpdesk\/reports(?:\/|$)/, capability: REPORTS, feature: 'helpdesk.reports' },
    // The server opens a ticket with `match='any'` on the write or the requests-create key, so the form follows it.
    { pattern: /^\/helpdesk\/new$/, capability: REQUESTS_CREATE, anyCapabilities: [WRITE], match: 'any' },
    // Editing a ticket is `liwan.helpdesk.service._liwan_update`, which requires the write key alone.
    { pattern: /^\/helpdesk\/[^/]+\/edit$/, capability: WRITE },
    // The queue and the ticket: `requires_capability(READ, REQUESTS_READ, match='any')` on the routes.
    { pattern: /^\/helpdesk(?:\/|$)/, capability: READ, anyCapabilities: [REQUESTS_READ], match: 'any' },
    { pattern: /^\/settings\/apps\/helpdesk(?:\/|$)/, capability: 'helpdesk.settings.read' },
  ],
  commands: [
    { id: 'helpdesk.new', labelKey: 'helpdesk.new', icon: 'i-lucide-plus', to: '/helpdesk/new', capability: REQUESTS_CREATE },
  ],
  // The tickets item is not lit on the reports page, which has its own entry.
  isNavActive: (path, target) => (target === '/helpdesk' && /^\/helpdesk\/reports(?:\/|$)/.test(path) ? false : undefined),
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
