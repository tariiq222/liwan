import { MeetingFollowupListSchema, MeetingListSchema } from '@liwan/contracts'
import { formatTime, localIsoDay } from '@liwan/ui/app/utils/formatDate'
import { ATTENTION_ROWS_PER_PROVIDER } from '../../composables/nav/attentionModel'
import type { AppAttentionProvider } from '../types'

/** One day holds a handful of meetings; this only bounds the request. */
const TODAY_PAGE = 50

/** Meetings of mine today that are still to be held, earliest first. */
export const todayMeetingsAttention: AppAttentionProvider = {
  id: 'meetings-today',
  module: 'meetings',
  work: 'follow',
  capability: 'meetings.read',
  queryKey: ['meetings', 'attention', 'today'],
  async load(api) {
    const now = new Date()
    const today = localIsoDay(now)
    const page = await api('/api/v1/meetings', { query: { mine: 1, date_from: today, date_to: today, limit: TODAY_PAGE }, schema: MeetingListSchema })
    return page.items
      .filter(meeting => meeting.state === 'confirmed' || meeting.state === 'draft')
      .filter(meeting => !meeting.end_datetime || new Date(meeting.end_datetime) >= now)
      .sort((a, b) => (a.start_datetime ?? '').localeCompare(b.start_datetime ?? ''))
      .slice(0, ATTENTION_ROWS_PER_PROVIDER)
      .map(meeting => ({
        id: `meeting-${meeting.id}`,
        label: meeting.name,
        to: `/meetings/${meeting.id}`,
        caption: meeting.start_datetime ? formatTime(meeting.start_datetime) : undefined,
        tone: 'normal' as const,
      }))
  },
}

/** Follow-up resolutions of mine whose deadline has passed. */
export const overdueFollowupAttention: AppAttentionProvider = {
  id: 'meetings-followup-overdue',
  module: 'meetings',
  work: 'execute',
  capability: 'meetings.read',
  queryKey: ['meetings', 'attention', 'followup-overdue'],
  async load(api, t) {
    const page = await api('/api/v1/meetings/resolutions', { query: { mine: true, state: 'overdue', limit: ATTENTION_ROWS_PER_PROVIDER }, schema: MeetingFollowupListSchema })
    const rows = page.items.slice(0, ATTENTION_ROWS_PER_PROVIDER).map(resolution => ({
      id: `resolution-${resolution.id}`,
      label: resolution.name,
      to: `/meetings/${resolution.meeting_id}?tab=resolutions`,
      caption: resolution.meeting_name,
      tone: 'urgent' as const,
    }))
    const first = rows[0]
    return first ? [{ ...first, suggestion: t('meetingsUi.attention.reviewOverdue') }, ...rows.slice(1)] : rows
  },
}
