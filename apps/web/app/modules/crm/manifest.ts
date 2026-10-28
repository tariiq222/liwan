import type { AppManifest } from '../types'

const manifest: AppManifest = {
  id: 'crm',
  feature: 'crm.enabled',
  routePrefixes: ['/crm'],
  rail: [{ id: 'crm', labelKey: 'crm.title', icon: 'i-lucide-handshake', to: '/crm', order: 80 }],
  nav: [
    { to: '/crm', labelKey: 'crm.nav.leads', icon: 'i-lucide-handshake', shortcut: 'd', capability: 'crm.leads.read' },
  ],
  contextLinks: () => [
    { id: 'crm-leads', labelKey: 'crm.nav.leads', icon: 'i-lucide-handshake', to: '/crm', capability: 'crm.leads.read' },
  ],
  landing: [{ path: '/crm', capability: 'crm.leads.read' }],
  routeCapabilities: [{ pattern: /^\/crm(?:\/|$)/, capability: 'crm.leads.read' }],
}
export default manifest
