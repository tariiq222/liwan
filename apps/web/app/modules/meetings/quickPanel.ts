import { MeetingListSchema } from '@liwan/contracts'
import { localIsoDay } from '@liwan/ui/app/utils/formatDate'
import type { AppQuickPanel } from '../types'

/** My upcoming meetings in the top bar; the badge counts the confirmed ones from today on. */
export const meetingsQuickPanel: AppQuickPanel = {
  id: 'meetings',
  labelKey: 'nav.meetings',
  icon: 'i-lucide-calendar-days',
  capability: 'meetings.read',
  to: '/meetings',
  queryKey: ['meetings', 'quick-panel', 'upcoming'],
  count: async api => (await api('/api/v1/meetings', { query: { mine: 1, state: 'confirmed', date_from: localIsoDay(new Date()), limit: 1 }, schema: MeetingListSchema })).total,
  load: () => import('../../components/meetings/MeetingsQuickPanel.vue'),
}
