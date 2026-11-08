import { MeetingFollowupListSchema, MeetingListSchema } from '@liwan/contracts'
import { localIsoDay } from '@liwan/ui/app/utils/formatDate'
import type { AppCard } from '../types'

const CAPABILITY = 'meetings.read'

/** My confirmed meetings from today on, and my recommendations that are still open. */
export const meetingsAppCard: AppCard = {
  category: 'team',
  plan: 'included',
  surface: 'sand',
  figures: [
    {
      labelKey: 'launcher.figures.meetings.upcoming', capability: CAPABILITY, queryKey: ['meetings', 'app-card', 'upcoming'],
      load: async api => (await api('/api/v1/meetings', { query: { mine: 1, state: 'confirmed', date_from: localIsoDay(new Date()), limit: 1 }, schema: MeetingListSchema })).total,
    },
    {
      labelKey: 'launcher.figures.meetings.followup', capability: CAPABILITY, queryKey: ['meetings', 'app-card', 'followup'],
      load: async api => (await api('/api/v1/meetings/resolutions', { query: { mine: true, state: 'active', limit: 1 }, schema: MeetingFollowupListSchema })).total,
    },
  ],
}
