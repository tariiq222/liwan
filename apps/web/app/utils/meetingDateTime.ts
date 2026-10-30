import { formatDateTime } from '@liwan/ui/app/utils/formatDate'

/** Convert a datetime-local input (in the browser's local timezone) to the UTC wire format. */
export function toUtcDateTime(value: string | null | undefined): string | undefined {
  if (!value?.trim()) return undefined
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? undefined : parsed.toISOString()
}

/** Convert a UTC API instant to the local, minute-precision input value. */
export function fromUtcDateTimeInput(value: string | null | undefined): string {
  if (!value) return ''
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return ''
  const pad = (part: number) => String(part).padStart(2, '0')
  return `${parsed.getFullYear()}-${pad(parsed.getMonth() + 1)}-${pad(parsed.getDate())}T${pad(parsed.getHours())}:${pad(parsed.getMinutes())}`
}

export function formatLocalDateTime(value: string | null | undefined): string {
  return formatDateTime(value)
}

/** Preserve the browser's calendar day and explicit offset for the API. */
export function toLocalWireDateTime(value: string | null | undefined): string | undefined {
  if (!value?.trim()) return undefined
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return undefined
  const offset = -parsed.getTimezoneOffset()
  const sign = offset >= 0 ? '+' : '-'
  const absolute = Math.abs(offset)
  const pad = (part: number) => String(part).padStart(2, '0')
  return `${value}:00${sign}${pad(Math.floor(absolute / 60))}:${pad(absolute % 60)}`
}

export type MeetingScheduleMode = 'create' | 'patch'

export type MeetingScheduleErrors = Partial<Record<'date' | 'start' | 'end' | 'endDate', 'required' | 'invalid' | 'before_start' | 'before_date'>>

function validDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const parsed = new Date(`${value}T00:00:00Z`)
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value
}

function validTime(value: string) {
  return /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value)
}

export function validateMeetingSchedule(input: {
  date: string
  start: string
  end: string
  endDate?: string
}): MeetingScheduleErrors {
  const errors: MeetingScheduleErrors = {}
  if (!input.date) errors.date = 'required'
  else if (!validDate(input.date)) errors.date = 'invalid'
  if (input.start && !validTime(input.start)) errors.start = 'invalid'
  if (input.end && !validTime(input.end)) errors.end = 'invalid'
  if (input.endDate && !validDate(input.endDate)) errors.endDate = 'invalid'
  if (input.endDate && validDate(input.date) && validDate(input.endDate) && input.endDate < input.date) errors.endDate = 'before_date'
  const effectiveEndDate = input.endDate || input.date
  if (input.start && input.end && validTime(input.start) && validTime(input.end)
    && ((!input.endDate && !input.date)
      || (validDate(input.date) && validDate(effectiveEndDate) && effectiveEndDate === input.date))
    && input.end <= input.start) {
    errors.end = 'before_start'
  }
  return errors
}

function localDateTime(date: string, time: string, fallbackDate = date) {
  if (!validDate(fallbackDate) || !validTime(time)) return undefined
  return toLocalWireDateTime(`${fallbackDate}T${time}`)
}

type MeetingScheduleInput = {
  date: string
  start: string
  end: string
  endDate?: string
}

export function buildMeetingSchedulePayload(input: MeetingScheduleInput & { mode?: 'create' }): {
  meeting_date: string | undefined
  start_datetime: string | undefined
  end_datetime: string | undefined
}
export function buildMeetingSchedulePayload(input: MeetingScheduleInput & { mode: 'patch' }): {
  meeting_date: string | undefined
  start_datetime: string | undefined | null
  end_datetime: string | undefined | null
}
export function buildMeetingSchedulePayload(input: MeetingScheduleInput & { mode?: MeetingScheduleMode }) {
  const mode = input.mode ?? 'create'
  const endDate = input.endDate || input.date
  return {
    meeting_date: input.date || undefined,
    start_datetime: input.start ? localDateTime(input.date, input.start) : mode === 'patch' ? null : undefined,
    end_datetime: input.end ? localDateTime(endDate, input.end) : mode === 'patch' ? null : undefined,
  }
}

export function localDateFromUtc(value: string | null | undefined) {
  return fromUtcDateTimeInput(value).slice(0, 10)
}

export function localTimeFromUtc(value: string | null | undefined) {
  return fromUtcDateTimeInput(value).slice(11, 16)
}
