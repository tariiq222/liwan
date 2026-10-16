type MeetingMinutesTopic = {
  key: string
  title: string
  discussion: string
  project_id: number | null
  resolution_ids: number[]
}

export type MeetingMinutesFormValue = {
  opening: string
  closing: string
  chairperson: string
  approver_name: string
  approver_title: string
  topics: MeetingMinutesTopic[]
}

export type MeetingMinutesRecommendation = {
  id: number
  name: string
  result?: string | null
  responsible?: { name: string } | null
  deadline?: string | null
  execution_period?: string | null
  project?: { id: number; name: string } | null
  state?: string
}

export type MeetingMinutesSnapshotLike = {
  name?: string
  reference?: string | null
  meeting_date?: string | null
  start_datetime?: string | null
  end_datetime?: string | null
  location?: string | null
  organizer?: { id?: number; name: string } | null
  secretary?: { id?: number; name: string } | null
  attendees?: Array<{ id: number; name: string }>
  agenda?: string | null
  minutes?: string | null
  minutes_form?: MeetingMinutesFormValue | null
  resolutions?: MeetingMinutesRecommendation[]
}

export function selectMeetingMinutesSource(meeting: { state?: string | null; minutes_form?: MeetingMinutesFormValue | null; minutes_snapshot?: MeetingMinutesSnapshotLike | null }, version?: MeetingMinutesSnapshotLike | null) {
  if (version) return { kind: 'version' as const, snapshot: version, form: version.minutes_form ?? null, resolutions: version.resolutions ?? [], agenda: version.agenda ?? '', minutes: version.minutes ?? '' }
  if (meeting.state === 'done' && meeting.minutes_snapshot) {
    const snapshot = meeting.minutes_snapshot
    return { kind: 'finalized' as const, snapshot, form: snapshot.minutes_form ?? null, resolutions: snapshot.resolutions ?? [], agenda: snapshot.agenda ?? '', minutes: snapshot.minutes ?? '' }
  }
  if (meeting.state === 'done') {
    return { kind: 'finalized' as const, snapshot: null, form: null, resolutions: [], agenda: '', minutes: '' }
  }
  return { kind: 'current' as const, snapshot: null, form: meeting.minutes_form ?? null, resolutions: [], agenda: '', minutes: '' }
}

export function newMeetingMinutesTopic(): MeetingMinutesTopic {
  const randomUuid = typeof globalThis.crypto?.randomUUID === 'function'
    ? globalThis.crypto.randomUUID()
    : `topic-${Date.now()}-${Math.random().toString(36).slice(2)}`
  return { key: randomUuid, title: '', discussion: '', project_id: null, resolution_ids: [] }
}

export function createMeetingMinutesForm(value?: Partial<MeetingMinutesFormValue> | null): MeetingMinutesFormValue {
  return {
    opening: value?.opening ?? '',
    closing: value?.closing ?? '',
    chairperson: value?.chairperson ?? '',
    approver_name: value?.approver_name ?? '',
    approver_title: value?.approver_title ?? '',
    topics: (value?.topics ?? []).map(topic => ({
      key: topic.key || newMeetingMinutesTopic().key,
      title: topic.title ?? '',
      discussion: topic.discussion ?? '',
      project_id: topic.project_id ?? null,
      resolution_ids: [...new Set(topic.resolution_ids ?? [])],
    })),
  }
}

export function plainTextFromHtml(value: string | null | undefined) {
  if (!value) return ''
  return value
    .replace(/<br\s*\/?>(\n)?/gi, '\n')
    .replace(/<\/p\s*>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

export function normalizeMeetingMinutesText(value: string, maxLength = 50000) {
  return value.replace(/\r\n?/g, '\n').slice(0, maxLength)
}

import { formatNasqDate, formatNasqTime } from '@nasq/ui/app/composables/calendarDate'

export function formatMeetingDate(value: string | null | undefined, locale: string) {
  if (!value) return '—'
  return formatNasqDate(`${value.slice(0, 10)}T00:00:00`, locale)
}

export function formatMeetingTime(value: string | null | undefined, locale: string) {
  return formatNasqTime(value, locale)
}

export function validateMeetingMinutesForm(value: MeetingMinutesFormValue, recommendations: MeetingMinutesRecommendation[] = []) {
  const errors: string[] = []
  if (value.opening.length > 50000 || value.closing.length > 50000) errors.push('text_too_long')
  if (value.chairperson.length > 500 || value.approver_name.length > 500 || value.approver_title.length > 500) errors.push('name_too_long')
  if (value.topics.length > 100) errors.push('too_many_topics')
  const assigned = new Set<number>()
  const keys = new Set<string>()
  for (const topic of value.topics) {
    if (keys.has(topic.key)) errors.push('duplicate_topic_key')
    keys.add(topic.key)
    if (topic.title.length > 500) errors.push('title_too_long')
    if (topic.discussion.length > 50000) errors.push('text_too_long')
    for (const resolutionId of topic.resolution_ids) {
      if (assigned.has(resolutionId)) errors.push('duplicate_recommendation')
      assigned.add(resolutionId)
      const recommendation = recommendations.find(item => item.id === resolutionId)
      if (recommendations.length && !recommendation) errors.push('unknown_recommendation')
    }
    if (topic.resolution_ids.length > 200) errors.push('too_many_recommendations')
  }
  return [...new Set(errors)]
}
