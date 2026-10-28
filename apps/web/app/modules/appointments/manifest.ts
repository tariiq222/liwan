import type { AppManifest } from '../types'

const manifest: AppManifest = {
  id: 'appointments',
  feature: 'appointments.enabled',
  routePrefixes: ['/appointments'],
  rail: [{ id: 'appointments', labelKey: 'appointments.title', icon: 'i-lucide-calendar-clock', to: '/appointments', order: 80 }],
  nav: [
    { to: '/appointments', labelKey: 'appointments.nav.types', icon: 'i-lucide-calendar-clock', shortcut: 'd', capability: 'appointments.view' },
  ],
  contextLinks: () => [
    { id: 'appointments-types', labelKey: 'appointments.nav.types', icon: 'i-lucide-calendar-clock', to: '/appointments', capability: 'appointments.view' },
  ],
  landing: [{ path: '/appointments', capability: 'appointments.view' }],
  routeCapabilities: [{ pattern: /^\/appointments(?:\/|$)/, capability: 'appointments.view' }],
}
export default manifest
