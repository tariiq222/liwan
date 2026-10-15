export type MeetingWorkspaceMeeting = {
  id: number
  meeting_date?: string | null
  start_datetime?: string | null
  state?: string | null
  [key: string]: unknown
}

export type MeetingWorkspaceResolution = {
  id: number
  name?: string | null
  result?: string | null
  state?: string | null
  execution_state?: string | null
  responsible?: { name?: string | null } | null
  allowed_actions?: string[] | null
  can_update_execution?: boolean
  can_edit_decision?: boolean
  task_id?: number | null
  task_linked?: boolean
  [key: string]: unknown
}

export type ResolutionAction = 'start' | 'complete' | 'cancel' | 'reopen' | 'edit_result'

const terminalMeetingStates = new Set(['cancelled', 'done'])
const resolutionActionsInOrder: ResolutionAction[] = ['start', 'complete', 'cancel', 'reopen', 'edit_result']

const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/

function localDayStart(date: string) {
  const match = DATE_ONLY.exec(date)
  if (!match) return null
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])]
  const parsed = new Date(year, month - 1, day)
  const valid = parsed.getFullYear() === year && parsed.getMonth() === month - 1 && parsed.getDate() === day
  return valid ? parsed : null
}

function meetingTime(meeting: MeetingWorkspaceMeeting) {
  if (meeting.start_datetime) {
    const timestamp = Date.parse(meeting.start_datetime)
    if (Number.isFinite(timestamp)) return timestamp
  }
  if (meeting.meeting_date) return localDayStart(meeting.meeting_date)?.getTime() ?? null
  return null
}

// A meeting without a start time stays upcoming until its local calendar day ends.
function isUpcoming(meeting: MeetingWorkspaceMeeting, timestamp: number, nowTime: number) {
  if (meeting.start_datetime && Number.isFinite(Date.parse(meeting.start_datetime))) return timestamp >= nowTime
  const day = new Date(timestamp)
  return new Date(day.getFullYear(), day.getMonth(), day.getDate() + 1).getTime() > nowTime
}

function monthStart(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), 1).getTime()
}

export function meetingTimestamp(meeting: MeetingWorkspaceMeeting) {
  return meetingTime(meeting)
}

export type MeetingTimelinePhase = 'upcoming' | 'completed' | 'overdue' | 'cancelled' | 'unknown'

export function meetingTimelinePhase(meeting: MeetingWorkspaceMeeting, now = new Date()): MeetingTimelinePhase {
  const timestamp = meetingTime(meeting)
  if (String(meeting.state) === 'cancelled') return 'cancelled'
  if (timestamp === null) return 'unknown'
  if (String(meeting.state) === 'done') return 'completed'
  return isUpcoming(meeting, timestamp, now.getTime()) ? 'upcoming' : 'overdue'
}

export function selectNextMeeting<T extends MeetingWorkspaceMeeting>(meetings: T[], now = new Date()) {
  const nowTime = now.getTime()
  return meetings
    .map(meeting => ({ meeting, timestamp: meetingTime(meeting) }))
    .filter(({ meeting, timestamp }) => !terminalMeetingStates.has(String(meeting.state)) && timestamp !== null && isUpcoming(meeting, timestamp, nowTime))
    .sort((a, b) => a.timestamp! - b.timestamp! || a.meeting.id - b.meeting.id)
    .map(({ meeting }) => meeting)[0]
}

export function selectPreviousMeeting<T extends MeetingWorkspaceMeeting>(meetings: T[], now = new Date()) {
  const nowTime = now.getTime()
  return meetings
    .map(meeting => ({ meeting, timestamp: meetingTime(meeting) }))
    .filter(({ meeting, timestamp }) => meeting.state === 'done' && timestamp !== null && !isUpcoming(meeting, timestamp, nowTime))
    .sort((a, b) => b.timestamp! - a.timestamp! || b.meeting.id - a.meeting.id)
    .map(({ meeting }) => meeting)[0]
}

export type MeetingTimelineGroup<T extends MeetingWorkspaceMeeting> = {
  key: string
  label: string
  meetings: T[]
  past: boolean
}

export function groupMeetingsByMonth<T extends MeetingWorkspaceMeeting>(meetings: T[], locale = 'en', now = new Date(), unknownLabel = '—', preserveOrder = false): MeetingTimelineGroup<T>[] {
  const monthFormatter = new Intl.DateTimeFormat(locale, { month: 'long', year: 'numeric', calendar: 'gregory' })
  type TimelineBucket = { baseKey: string; timestamp: number | null; meetings: T[] }
  const buckets = new Map<string, TimelineBucket>()
  const orderedBuckets: TimelineBucket[] = []
  for (const meeting of meetings) {
    const timestamp = meetingTime(meeting)
    const date = timestamp === null ? null : new Date(timestamp)
    const baseKey = date ? `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}` : 'unknown'
    const timestampForBucket = date ? monthStart(date) : null
    const bucket = preserveOrder
      ? orderedBuckets.at(-1)?.baseKey === baseKey
        ? orderedBuckets[orderedBuckets.length - 1]!
        : (() => {
            const next = { baseKey, timestamp: timestampForBucket, meetings: [] as T[] }
            orderedBuckets.push(next)
            return next
          })()
      : buckets.get(baseKey) ?? { baseKey, timestamp: timestampForBucket, meetings: [] }
    bucket.meetings.push(meeting)
    if (!preserveOrder) buckets.set(baseKey, bucket)
  }
  const entries = preserveOrder
    ? orderedBuckets.map((bucket, index) => [`${bucket.baseKey}-${index}`, bucket] as const)
    : [...buckets.entries()]
  return entries
    .sort(([, left], [, right]) => {
      if (preserveOrder) return 0
      if (left.timestamp === null) return 1
      if (right.timestamp === null) return -1
      const currentMonth = monthStart(now)
      if (left.timestamp === currentMonth && right.timestamp !== currentMonth) return -1
      if (right.timestamp === currentMonth && left.timestamp !== currentMonth) return 1
      const leftPast = left.timestamp < currentMonth
      const rightPast = right.timestamp < currentMonth
      if (leftPast !== rightPast) return leftPast ? -1 : 1
      return leftPast ? right.timestamp - left.timestamp : left.timestamp - right.timestamp
    })
    .map(([key, bucket]) => {
      const isPast = bucket.timestamp !== null && bucket.timestamp < monthStart(now)
      if (!preserveOrder) bucket.meetings.sort((left, right) => {
        const leftTime = meetingTime(left)
        const rightTime = meetingTime(right)
        if (leftTime === null) return 1
        if (rightTime === null) return -1
        return (isPast ? rightTime - leftTime : leftTime - rightTime) || left.id - right.id
      })
      return {
        key,
        label: bucket.timestamp === null ? unknownLabel : monthFormatter.format(new Date(bucket.timestamp)),
        meetings: bucket.meetings,
        past: isPast,
      }
    })
}

export function prioritizeTimelinePage<T extends MeetingWorkspaceMeeting>(meetings: T[], now = new Date(), limit = 25): T[] {
  if (limit <= 0) return []
  const byId = new Map(meetings.map(meeting => [meeting.id, meeting]))
  const selected: T[] = []
  for (const candidate of [selectPreviousMeeting(meetings, now), selectNextMeeting(meetings, now)]) {
    if (candidate && byId.has(candidate.id) && !selected.some(meeting => meeting.id === candidate.id)) selected.push(candidate)
  }
  const remainder = meetings
    .filter(meeting => !selected.some(selectedMeeting => selectedMeeting.id === meeting.id))
    .sort((left, right) => {
      const leftTime = meetingTime(left)
      const rightTime = meetingTime(right)
      if (leftTime === null) return 1
      if (rightTime === null) return -1
      const leftPast = !isUpcoming(left, leftTime, now.getTime())
      const rightPast = !isUpcoming(right, rightTime, now.getTime())
      if (leftPast !== rightPast) return leftPast ? -1 : 1
      return leftPast ? rightTime - leftTime : leftTime - rightTime
    })
  return [...selected, ...remainder].slice(0, limit)
}

export function filterMeetingResolutions<T extends MeetingWorkspaceResolution>(
  resolutions: T[],
  filters: { q?: string; state?: string },
) {
  const query = filters.q?.trim().toLocaleLowerCase() ?? ''
  const state = filters.state?.trim() ?? ''
  return resolutions.filter((resolution) => {
    if (state && (resolution.execution_state ?? resolution.state) !== state) return false
    if (!query) return true
    const haystack = [resolution.name, resolution.result, resolution.responsible?.name]
      .filter(Boolean)
      .join(' ')
      .toLocaleLowerCase()
    return haystack.includes(query)
  })
}

function fallbackResolutionActions(resolution: MeetingWorkspaceResolution) {
  if (resolution.task_id || resolution.task_linked) return []
  const actions: ResolutionAction[] = []
  const state = resolution.execution_state ?? resolution.state
  if (resolution.can_update_execution) {
    if (state === 'open') actions.push('start', 'complete')
    else if (state === 'in_progress') actions.push('complete')
  }
  if (resolution.can_update_execution && !['done', 'cancelled'].includes(String(state))) actions.push('edit_result')
  return actions
}

export function resolutionActions(resolution: MeetingWorkspaceResolution): ResolutionAction[] {
  if (Array.isArray(resolution.allowed_actions)) {
    return resolutionActionsInOrder.filter(action => resolution.allowed_actions?.includes(action))
  }
  return fallbackResolutionActions(resolution)
}

export function calendarCoverage(total: number | null | undefined, limit: number) {
  if (total === null || total === undefined || !Number.isFinite(total)) return { status: 'unknown' as const, total: null }
  return { status: total > limit ? 'truncated' as const : 'complete' as const, total }
}
