import type { MeetingOccurrenceCreate } from '@liwan/contracts'
import { buildMeetingSchedulePayload, validateMeetingSchedule, type MeetingScheduleErrors } from './meetingDateTime'

export type OccurrenceFormInput = { name: string; date: string; start: string; end: string }

/** Everything is optional, but a date and times only make sense together: any of them asks for all three. */
export function occurrenceFormErrors(input: OccurrenceFormInput): MeetingScheduleErrors {
  if (!input.date && !input.start && !input.end) return {}
  const errors = validateMeetingSchedule({ date: input.date, start: input.start, end: input.end })
  if (!input.start) errors.start = 'required'
  if (!input.end) errors.end = 'required'
  return errors
}

export function buildOccurrencePayload(input: OccurrenceFormInput): MeetingOccurrenceCreate {
  const name = input.name.trim()
  if (!input.date) return name ? { name } : {}
  const { start_datetime, end_datetime } = buildMeetingSchedulePayload({ date: input.date, start: input.start, end: input.end })
  return { ...(name ? { name } : {}), start_datetime, end_datetime }
}
