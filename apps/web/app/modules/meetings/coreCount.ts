import { MeetingListSchema } from '@liwan/contracts'
import { localIsoDay } from '@liwan/ui/app/utils/formatDate'
import type { AppCoreCount } from '../types'

/** The badge of «الاجتماعات» in the core-app row: the confirmed meetings from today on. */
export const meetingsCoreCount: AppCoreCount = {
  id: 'meetings',
  capability: 'meetings.read',
  to: '/meetings',
  queryKey: ['meetings', 'core-count', 'upcoming'],
  count: async api => (await api('/api/v1/meetings', { query: { mine: 1, state: 'confirmed', date_from: localIsoDay(new Date()), limit: 1 }, schema: MeetingListSchema })).total,
}
