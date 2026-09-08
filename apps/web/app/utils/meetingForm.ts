import { fromUtcDateTimeInput, toUtcDateTime, validateMeetingSchedule } from './meetingDateTime'

export type RecurrenceEndMode = 'count' | 'date'

export type MeetingFormErrors = Partial<Record<'name' | 'date' | 'start' | 'end' | 'endDate' | 'meetingUrl' | 'untilCount' | 'untilDate', 'required' | 'invalid' | 'unsafe_url' | 'before_start' | 'before_date'>>

export function isSafeMeetingUrl(value: string) {
  if (!value.trim()) return true
  try {
    const url = new URL(value.trim())
    return (url.protocol === 'https:' || url.protocol === 'http:') && Boolean(url.hostname)
  } catch {
    return false
  }
}

function validDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const parsed = new Date(`${value}T00:00:00Z`)
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value
}

function timePart(value: string) {
  return /^\d{4}-\d{2}-\d{2}T/.test(value) ? value.slice(11, 16) : value
}

function datePart(value: string) {
  return /^\d{4}-\d{2}-\d{2}T/.test(value) ? value.slice(0, 10) : ''
}

export function getMeetingFormErrors(input: {
  name: string
  date?: string
  start: string
  end: string
  endDate?: string
  meetingUrl: string
  recurrence?: 'none' | 'weekly' | 'biweekly' | 'monthly'
  untilMode?: RecurrenceEndMode
  untilCount?: string
  untilDate?: string
}): MeetingFormErrors {
  const errors: MeetingFormErrors = {}
  const startTime = timePart(input.start)
  const endTime = timePart(input.end)
  const startDate = datePart(input.start)
  const recurrenceStartDate = input.start ? (toUtcDateTime(input.start)?.slice(0, 10) || startDate) : startDate
  const scheduleDate = input.date ?? startDate
  const scheduleEndDate = input.endDate || datePart(input.end) || scheduleDate
  if (!input.name.trim()) errors.name = 'required'
  if (input.date !== undefined || input.start || input.end) {
    Object.assign(errors, validateMeetingSchedule({
      date: scheduleDate,
      start: startTime,
      end: endTime,
      endDate: scheduleEndDate,
    }))
  }
  if (input.start.includes('T') && !parseLocal(input.start)) errors.start = 'invalid'
  if (input.end.includes('T') && !parseLocal(input.end)) errors.end = 'invalid'
  if (!isSafeMeetingUrl(input.meetingUrl)) errors.meetingUrl = 'unsafe_url'
  if (input.recurrence && input.recurrence !== 'none') {
    if (!input.start) errors.start = 'required'
    if (!input.end) errors.end = 'required'
    if (input.untilMode === 'count') {
      const count = Number(input.untilCount)
      if (!Number.isInteger(count) || count < 1 || count > 60) errors.untilCount = 'required'
    } else if (input.untilMode === 'date' && (!input.untilDate || !validDate(input.untilDate))) {
      errors.untilDate = 'required'
    } else if (input.untilMode === 'date' && input.untilDate && input.start && input.untilDate < (recurrenceStartDate || input.start.slice(0, 10))) {
      errors.untilDate = 'before_date'
    } else if (input.untilMode === 'date' && input.untilDate && input.start && input.end
      && recurrencePreviewLimitExceeded({
        recurrence: input.recurrence,
        start: input.start,
        end: input.end,
        untilDate: input.untilDate,
      })) {
      errors.untilDate = 'invalid'
    }
  }
  return errors
}

export function normalizeRecurrenceEnd(input: {
  mode: RecurrenceEndMode
  count: string
  date: string
}): { until_count: number | undefined; until_date: string | undefined } {
  if (input.mode === 'count') {
    const count = Number(input.count)
    return { until_count: Number.isInteger(count) && count >= 1 && count <= 60 ? count : undefined, until_date: undefined }
  }
  const validDate = /^\d{4}-\d{2}-\d{2}$/.test(input.date) ? input.date : undefined
  return { until_count: undefined, until_date: validDate }
}

export type RecurrencePreview = { start: string; end: string }

function parseLocal(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value)
  if (!match) return undefined
  const instant = toUtcDateTime(value)
  if (!instant) return undefined
  const parsed = new Date(instant)
  if (Number.isNaN(parsed.getTime()) || fromUtcDateTimeInput(instant) !== value) return undefined
  return parsed
}

function formatLocal(value: Date) {
  return fromUtcDateTimeInput(value.toISOString())
}

function addOccurrence(value: Date, recurrence: Exclude<NonNullable<RecurrencePreviewInput['recurrence']>, 'none'>, index: number, day: number) {
  if (recurrence !== 'monthly') {
    const next = new Date(value)
    next.setUTCDate(next.getUTCDate() + index * (recurrence === 'biweekly' ? 14 : 7))
    return next
  }
  const month = new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth() + index, 1, value.getUTCHours(), value.getUTCMinutes()))
  const lastDay = new Date(Date.UTC(month.getUTCFullYear(), month.getUTCMonth() + 1, 0)).getUTCDate()
  return lastDay >= day ? new Date(Date.UTC(month.getUTCFullYear(), month.getUTCMonth(), day, value.getUTCHours(), value.getUTCMinutes())) : undefined
}

type RecurrencePreviewInput = {
  recurrence: 'none' | 'weekly' | 'biweekly' | 'monthly'
  start: string
  end: string
  untilCount?: number
  untilDate?: string
}

export function buildRecurrencePreview(input: RecurrencePreviewInput): RecurrencePreview[] {
  const results = buildRecurrencePreviewInternal(input, 61)
  return results.length > 60 ? [] : results
}

export function recurrencePreviewLimitExceeded(input: RecurrencePreviewInput) {
  return buildRecurrencePreviewInternal(input, 61).length > 60
}

function buildRecurrencePreviewInternal(input: RecurrencePreviewInput, maxResults: number): RecurrencePreview[] {
  if (input.recurrence === 'none') return []
  const firstStart = parseLocal(input.start)
  const firstEnd = parseLocal(input.end)
  if (!firstStart || !firstEnd || firstEnd <= firstStart) return []
  const count = Number.isInteger(input.untilCount) && (input.untilCount ?? 0) > 0 ? input.untilCount : undefined
  const untilDate = input.untilDate && validDate(input.untilDate) ? input.untilDate : undefined
  const duration = firstEnd.getTime() - firstStart.getTime()
  const results: RecurrencePreview[] = []
  let monthOffset = 0
  for (let index = 0; index < 120 && results.length < maxResults && (!count || results.length < count); index += 1) {
    let occurrence = addOccurrence(firstStart, input.recurrence, input.recurrence === 'monthly' ? monthOffset : index, firstStart.getUTCDate())
    while (!occurrence && input.recurrence === 'monthly' && monthOffset < 120) {
      monthOffset += 1
      occurrence = addOccurrence(firstStart, input.recurrence, monthOffset, firstStart.getUTCDate())
    }
    if (!occurrence) break
    if (input.recurrence === 'monthly') monthOffset += 1
    if (untilDate && occurrence.toISOString().slice(0, 10) > untilDate) break
    results.push({ start: formatLocal(occurrence), end: formatLocal(new Date(occurrence.getTime() + duration)) })
  }
  return results
}
