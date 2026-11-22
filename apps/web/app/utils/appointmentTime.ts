/**
 * A local day and time as the wire form the booking routes accept: `YYYY-MM-DDTHH:mm:ssZ`, in UTC, with no fractional
 * seconds. `Date.prototype.toISOString` appends `.000`, and the server validates with
 * `\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z` under `fullmatch` — so every request made through `toISOString` was refused
 * with 422 before it reached a booking.
 *
 * The input is read in the browser's own zone (the day and time a receptionist typed) and written in UTC.
 */
export function bookingTimestamp(day: string, time: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !/^\d{2}:\d{2}$/.test(time)) return null
  const local = new Date(`${day}T${time}:00`)
  if (Number.isNaN(local.getTime())) return null
  return `${local.toISOString().slice(0, 19)}Z`
}

/** The day and time a stored timestamp shows in the browser's zone, for the two edit inputs. */
export function bookingParts(value: string | null | undefined): { day: string, time: string } {
  if (!value) return { day: '', time: '' }
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return { day: '', time: '' }
  const pad = (part: number) => String(part).padStart(2, '0')
  return {
    day: `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`,
    time: `${pad(date.getHours())}:${pad(date.getMinutes())}`,
  }
}
