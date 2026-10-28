import type { AppManifest } from '../types'

const manifest: AppManifest = {
  id: 'appointments',
  feature: 'appointments.enabled',
  routePrefixes: ['/appointments'],
  rail: [{ id: 'appointments', labelKey: 'appointments.title', icon: 'i-lucide-layout-grid', to: '/appointments', order: 80 }],
  nav: [
    { to: '/appointments', labelKey: 'appointments.nav.records', icon: 'i-lucide-layout-grid', shortcut: 'd', capability: 'appointments.records.read' },
  ],
  contextLinks: () => [
    { id: 'appointments-records', labelKey: 'appointments.nav.records', icon: 'i-lucide-layout-grid', to: '/appointments', capability: 'appointments.records.read' },
  ],
  landing: [{ path: '/appointments', capability: 'appointments.records.read' }],
  routeCapabilities: [{ pattern: /^\/appointments(?:\/|$)/, capability: 'appointments.records.read' }],
}
export default manifest
