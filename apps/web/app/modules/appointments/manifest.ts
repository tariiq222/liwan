import type { AppManifest } from '../types'

const manifest: AppManifest = {
  id: 'appointments',
  feature: 'appointments.enabled',
  routePrefixes: ['/appointments'],
  rail: [{ id: 'appointments', labelKey: 'appointments.title', icon: 'i-lucide-calendar-clock', to: '/appointments', order: 80 }],
  nav: [
    { to: '/appointments', labelKey: 'appointments.nav.types', icon: 'i-lucide-calendar-clock', shortcut: 'd', capability: 'appointments.bookings.read' },
  ],
  contextLinks: () => [
    { id: 'appointments-types', labelKey: 'appointments.nav.types', icon: 'i-lucide-calendar-clock', to: '/appointments', capability: 'appointments.bookings.read' },
  ],
  landing: [{ path: '/appointments', capability: 'appointments.bookings.read' }],
  settings: {
    id: 'appointments', labelKey: 'appointments.settings.title', icon: 'i-lucide-calendar-cog', to: '/settings/apps/appointments',
    parts: [
      { id: 'preset', labelKey: 'appointments.settings.preset.title', icon: 'i-lucide-wand-sparkles', capability: 'appointments.bookings.manage' },
      { id: 'booking', labelKey: 'appointments.settings.booking.title', icon: 'i-lucide-clock', capability: 'appointments.bookings.manage' },
      { id: 'requester', labelKey: 'appointments.settings.requester.title', icon: 'i-lucide-user-round-check', capability: 'appointments.bookings.manage' },
    ],
  },
  routeCapabilities: [{ pattern: /^\/appointments(?:\/|$)/, capability: 'appointments.bookings.read' }],
}
export default manifest
