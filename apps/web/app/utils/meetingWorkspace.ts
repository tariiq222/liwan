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

function meetingTime(meeting: MeetingWorkspaceMeeting) {
  if (meeting.start_datetime) {
    const timestamp = Date.parse(meeting.start_datetime)
    if (Number.isFinite(timestamp)) return timestamp
  }
  if (meeting.meeting_date) {
    const timestamp = Date.parse(`${meeting.meeting_date}T00:00:00`)
    if (Number.isFinite(timestamp)) return timestamp
  }
  return Number.POSITIVE_INFINITY
}

export function selectNextMeeting<T extends MeetingWorkspaceMeeting>(meetings: T[], now = new Date()) {
  const nowTime = now.getTime()
  return meetings
    .filter(meeting => !terminalMeetingStates.has(String(meeting.state)) && meetingTime(meeting) >= nowTime)
    .sort((a, b) => meetingTime(a) - meetingTime(b) || a.id - b.id)[0]
}

export function selectPreviousMeeting<T extends MeetingWorkspaceMeeting>(meetings: T[], now = new Date()) {
  const nowTime = now.getTime()
  return meetings
    .filter(meeting => !terminalMeetingStates.has(String(meeting.state)) && meetingTime(meeting) < nowTime)
    .sort((a, b) => meetingTime(b) - meetingTime(a) || b.id - a.id)[0]
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
