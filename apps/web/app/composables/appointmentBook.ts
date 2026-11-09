import type { AppointmentPublicBooking, AppointmentSlot, AppointmentSlotList } from '@liwan/contracts'

/** The booking and access token a booking-page address names. */
export interface BookingLink {
  id: number
  token: string
}

/** How many days of slots the picker asks for at a time. */
export const BOOK_WINDOW_DAYS = 7

const BOOKING_ID = /^[1-9]\d{0,11}$/
const ACCESS_TOKEN = /^[\w-]{1,128}$/
const DAY = /^(\d{4})-(\d{2})-(\d{2})$/

/** The booking and token of a booking-page address, or null when either is missing or not of the shape the server issues. */
export function bookingLinkOf(id: unknown, token: unknown): BookingLink | null {
  if (typeof id !== 'string' || !BOOKING_ID.test(id)) return null
  if (typeof token !== 'string' || !ACCESS_TOKEN.test(token)) return null
  return { id: Number(id), token }
}

/** The HTTP status a failed call carries, or null for any other failure. */
export function refusalStatus(error: unknown): number | null {
  return typeof error === 'object' && error !== null && 'status' in error && typeof error.status === 'number' ? error.status : null
}

/** Whether a failed read says the link names no booking: a wrong token, a wrong id, a canceled booking and an expired link all answer 404. */
export const isInvalidBookingLink = (error: unknown): boolean => refusalStatus(error) === 404

/** Whether the booking still lets the requester act: neither canceled nor past its change deadline. */
export function canChange(booking: AppointmentPublicBooking): boolean {
  return booking.state !== 'canceled' && booking.is_modifiable
}

/** A calendar day as `YYYY-MM-DD`, from the browser's own clock and time zone. */
export function localDay(moment: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${moment.getFullYear()}-${pad(moment.getMonth() + 1)}-${pad(moment.getDate())}`
}

/** The day `count` days after (or before, when negative) a `YYYY-MM-DD` day. */
export function addDays(day: string, count: number): string {
  const [, year, month, date] = DAY.exec(day)!.map(Number)
  return new Date(Date.UTC(year!, month! - 1, date! + count)).toISOString().slice(0, 10)
}

/** The days a picker window shows: from `from` for a week, never past the last day the server accepts. */
export function windowDays(from: string, last: string): string[] {
  return Array.from({ length: BOOK_WINDOW_DAYS }, (_, index) => addDays(from, index)).filter(day => day <= last)
}

/** The free slots grouped by the browser's own calendar day, in order. */
export function slotsByDay<Slot extends { start: string }>(slots: readonly Slot[]): Map<string, Slot[]> {
  const days = new Map<string, Slot[]>()
  for (const slot of slots) {
    const day = localDay(new Date(slot.start))
    days.set(day, [...(days.get(day) ?? []), slot])
  }
  return days
}

/**
 * Every free slot from `from` to `to`: the dense grid of an always-open calendar fills the server's per-answer limit
 * before the last day, so an answer names `next_date` (the first whole day it left out) and the read continues there.
 * A day is never listed in part, so no day is read as unavailable only because an answer ended early.
 *
 * A `429` on a later page keeps the pages already read: the answer carries them and names the day it stopped at, which
 * the caller shows with its retry. A refusal with nothing to show still fails the read — no slot read yet, or any
 * refusal that is not the server being busy — because there would be nothing to keep.
 */
export async function collectSlots(
  readPage: (from: string, to: string) => Promise<AppointmentSlotList>,
  from: string,
  to: string,
): Promise<AppointmentSlotList> {
  const items: AppointmentSlot[] = []
  let day: string | undefined = from
  while (day !== undefined) {
    let page: AppointmentSlotList
    try {
      page = await readPage(day, to)
    } catch (error) {
      if (!items.length || refusalStatus(error) !== 429) throw error
      return { items, total: items.length, next_date: day }
    }
    items.push(...page.items)
    // A next date that does not move forward would repeat the same request: the window is complete then.
    day = page.next_date !== null && page.next_date > day ? page.next_date : undefined
  }
  return { items, total: items.length, next_date: null }
}

const latin = { calendar: 'gregory', numberingSystem: 'latn' } as const

/** A `YYYY-MM-DD` day as a weekday and date, in full or short. It is a calendar day, so no time zone applies. */
export function formatDay(day: string, locale: string, style: 'long' | 'short' = 'long'): string {
  return new Intl.DateTimeFormat(locale, { ...latin, weekday: style, day: 'numeric', month: style, timeZone: 'UTC' }).format(new Date(`${day}T00:00:00Z`))
}

/** A UTC timestamp as a time of day in the requester's own time zone. */
export function formatSlotTime(value: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, { ...latin, timeStyle: 'short' }).format(new Date(value))
}

/** A slot as its time range in the requester's own time zone. */
export function formatSlot(slot: { start: string; stop: string }, locale: string): string {
  return `${formatSlotTime(slot.start, locale)} – ${formatSlotTime(slot.stop, locale)}`
}

/** A UTC timestamp as a long date with the time of day in the requester's own time zone. */
export function formatMoment(value: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, { ...latin, dateStyle: 'long', timeStyle: 'short' }).format(new Date(value))
}
