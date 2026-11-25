import { AppointmentBookingListSchema } from '@liwan/contracts'
import { localIsoDay } from '@liwan/ui/app/utils/formatDate'
import { normalizedPath } from '../../utils/routePath'
import type { AppSearchApi, AppSidebarMenu, AppSidebarRoute } from '../types'

const onPath = (route: AppSidebarRoute, path: string) => normalizedPath(route.path) === path

/**
 * The appointments sidebar: pinned create action, the bookings list with today's booking total (limit=1), and
 * recently opened bookings. A standalone appointment-types page does not exist yet, so only real destinations are listed.
 */
export const appointmentsSidebar: AppSidebarMenu = {
  create: 'appointments-new',
  rows: [
    {
      id: 'appointments-bookings',
      labelKey: 'appointments.nav.bookings',
      icon: 'i-lucide-calendar-clock',
      to: { path: '/appointments' },
      capability: 'appointments.bookings.read',
      active: route => onPath(route, '/appointments') || onPath(route, '/appointments/new'),
    },
  ],
  counts: [
    {
      capability: 'appointments.bookings.read',
      queryKey: ['appointments', 'bookings', 'sidebar', 'counts'],
      async load(api: AppSearchApi) {
        const today = localIsoDay()
        const result = await api('/api/v1/appointments/bookings', {
          query: { from: today, to: today, limit: 1 },
          schema: AppointmentBookingListSchema,
        })
        return { 'appointments-bookings': result.total }
      },
    },
  ],
  recent: {
    kind: 'appointment',
    titleKey: 'appointments.nav.recent',
    icon: 'i-lucide-calendar-clock',
    capability: 'appointments.bookings.read',
    to: id => `/appointments/${id}`,
  },
}
